// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ContinuousAudio, sourceDeadlineAt } from '../../site/play/continuous-audio.js';
import { SoxrRuntime } from '../../site/play/streaming-resampler.js';

const runtime = new SoxrRuntime();
// Sequential Float32 envelope rounding stays below one quarter of a PCM16 quantum.
const ENVELOPE_TOLERANCE = 0.25 / 32768;
const quantumMs = frames => frames / 48;
const clock = { generation: 1, rate: 1, state: 'fresh', localOriginMs: 0, serverOriginMs: 0, uncertaintyMs: 0 };

function signal(mode, type, rate, channels = 2, packetCount = null) {
  const player = new ContinuousAudio(runtime, rate, channels, 48000, () => {}, 2000, { buffered: true, mode, type });
  const totalFrames = packetCount === null ? rate : packetCount * 480;
  for (let first = 0, sequence = 0; first < totalFrames; first += 480, sequence++) {
    const frames = Math.min(480, totalFrames - first);
    const pcm = Int16Array.from({ length: frames * channels }, (_, index) => {
      const frame = first + Math.floor(index / channels), channel = index % channels;
      // Nonzero multitone sound and an independent monotonic source marker.
      return channel === 0 ? Math.round(32768 * (0.2 + 0.4 * Math.sin(frame * 2 * Math.PI * 997 / rate))) : frame / 2;
    });
    player.push({ pcm: pcm.buffer, presentationMs: first * 1000 / rate, decodeTimestampUs: first * 1e6 / rate,
      sequence, generation: 1 }, 1, first * 1000 / rate);
  }
  return player;
}

for (const [mode, type, rate] of [['carplay', 0, 48000], ['airplay-mirror', 6, 44100]]) {
  test(`${mode}: a partially faded real Soxr tail resumes without applying its envelope twice`, () => {
    for (const [frames, missingBlocks] of [[64, 1], [64, 2], [64, 3], [128, 1], [256, 1], [1024, 1]]) {
      const player = signal(mode, type, rate), incoming = signal(mode, type, rate);
      const output = new Float32Array(frames * 2), fresh = new Float32Array(frames * 2);
      let context = 0;
      try {
        for (let block = 0; block < 20; block++, context += quantumMs(frames)) {
          const target = block ? player.rawCursorMs : 100;
          player.render(target, context, clock, frames, output);
          incoming.render(target, context, clock, frames, fresh);
          assert.deepEqual(output, fresh);
        }
        const last = player.last.slice(), fadeFrames = player.fadeFrames;
        assert.ok(last.some(value => Math.abs(value) > 0.05), 'the oracle must exercise an audible nonzero tail');
        const newer = { ...clock, generation: 2 };
        for (let block = 0; block < missingBlocks; block++, context += quantumMs(frames)) {
          // A new source clock fit arrives while the output pair is unavailable.
          // This goes through the normal render/recovery path, without manual recover().
          player.render(null, context, newer, frames, output);
          incoming.render(null, context, newer, frames, fresh);
        }
        const fadedFrames = frames * missingBlocks, remaining = Math.max(0, fadeFrames - fadedFrames);
        const priorBoundary = player.last.slice();
        for (let channel = 0; channel < 2; channel++)
          assert.ok(Math.abs(priorBoundary[channel] - last[channel] * remaining / fadeFrames) < ENVELOPE_TOLERANCE,
            `${frames}/${missingBlocks} channel ${channel}: last ${last[channel]}, boundary ${priorBoundary[channel]}, remaining ${remaining}, actual remaining ${player.tailRemaining}`);
        // An otherwise identical real resampler isolates newly emitted PCM.
        // The oracle below computes the old tail from its pre-fade sound value,
        // never from the recovery implementation's stored envelope state.
        incoming.recoveryTail.fill(0);
        for (let block = 0; block < Math.ceil(fadeFrames / frames) + 1; block++, context += quantumMs(frames)) {
          const target = player.rawCursorMs;
          player.render(target, context, newer, frames, output);
          incoming.render(target, context, newer, frames, fresh);
          for (let index = 0; index < frames; index++) for (let channel = 0; channel < 2; channel++) {
            const decay = Math.max(0, fadeFrames - fadedFrames - block * frames - index - 1) / fadeFrames;
            const expected = fresh[index * 2 + channel] + last[channel] * decay;
            assert.ok(Math.abs(output[index * 2 + channel] - expected) < ENVELOPE_TOLERANCE,
              `${frames}/${missingBlocks}, frame ${block * frames + index}, channel ${channel}: ${output[index * 2 + channel]} versus ${expected}`);
          }
          assert.equal(player.sourceFrame, incoming.sourceFrame, 'the repaired envelope must not change source sample progress');
          assert.equal(player.inputFrame, incoming.inputFrame);
          assert.equal(player.rawCursorMs, incoming.rawCursorMs);
          assert.ok(output.every(Number.isFinite));
        }
        assert.equal(player.recoveryCounts['clock-generation'], 1);
        assert.equal(player.recoveryCounts['source-deadline'], undefined);
      } finally { player.clear(); incoming.clear(); }
    }
  });

  test(`${mode}: real partial underrun and a missing output pair preserve the same decaying sound edge`, () => {
    const make = () => {
      const player = new ContinuousAudio(runtime, rate, 1, 48000, () => {}, 2000, { buffered: true, mode, type });
      let first = 0, sequence = 0;
      const feed = count => {
        for (let packet = 0; packet < count; packet++) {
          const pcm = Int16Array.from({ length: 480 }, (_, index) =>
            Math.round(22000 * Math.sin((first + index) * 2 * Math.PI * 997 / rate)));
          player.push({ pcm: pcm.buffer, presentationMs: first * 1000 / rate,
            decodeTimestampUs: first * 1e6 / rate, sequence: sequence++, generation: 1 });
          first += 480;
        }
      };
      feed(5); return { player, feed };
    };
    const h = make(), twin = make(), output = new Float32Array(128), fresh = new Float32Array(128);
    let found = false;
    try {
      for (let block = 0; block < 100 && !found; block++) {
        const context = quantumMs(128) * block, before = h.player.recoveryCounts.underrun || 0;
        const produced = h.player.render(context, context, clock, 128, output);
        twin.player.render(context, context, clock, 128, fresh);
        if ((h.player.recoveryCounts.underrun || 0) <= before || produced <= 0 || produced >= 128
          || h.player.tailRemaining <= 128) continue;
        // Packet exhaustion is natural. Only one native output pair is then
        // unavailable; neither player has its DSP or recovery state rewritten.
        h.player.render(null, context + quantumMs(128), clock, 128, output);
        twin.player.render(null, context + quantumMs(128), clock, 128, fresh);
        const last = output.at(-1), remaining = h.player.tailRemaining;
        assert.ok(Math.abs(last) > 0.05 && remaining > 0);
        h.feed(15); twin.feed(15);
        twin.player.recoveryTail.fill(0); // Isolate the otherwise identical new PCM.
        const resume = context + 2 * quantumMs(128);
        assert.equal(h.player.render(resume, resume, clock, 128, output), 128);
        twin.player.render(resume, resume, clock, 128, fresh);
        for (let index = 0; index < 128; index++) {
          const expected = fresh[index] + last * Math.max(0, remaining - index - 1) / remaining;
          assert.ok(Math.abs(output[index] - expected) < ENVELOPE_TOLERANCE,
            `resume frame ${index}: actual ${output[index]}, expected ${expected}`);
        }
        assert.equal(h.player.sourceFrame, twin.player.sourceFrame);
        assert.equal(h.player.inputFrame, twin.player.inputFrame);
        found = true;
      }
      assert.equal(found, true, 'the real resampler must reach a partial packet-shortage boundary');
    } finally { h.player.clear(); twin.player.clear(); }
  });
  test(`${mode}: expired fresh PCM is replaced only by a non-renewable published 5ms edge`, () => {
    for (const frames of [64, 128, 256, 1024]) {
      const player = signal(mode, type, rate), output = new Float32Array(frames * 2);
      try {
        for (let block = 0; block < 20; block++)
          player.render(block ? player.rawCursorMs : 100, quantumMs(frames) * block, clock, frames, output);
        const last = player.last.slice(), total = 240;
        assert.ok(last.some(value => Math.abs(value) > .05));
        const source = player.rawCursorMs;
        assert.equal(player.render(source, quantumMs(frames) * 20, clock, frames, output, 1,
          { outputAt: source + 400, limitMs: 300, uncertaintyMs: 1 }), 0);
        assert.equal(player.sourceDeadlineState, 'violated');
        assert.equal(player.sourceDeadlineRejectedFrames, frames);
        let offset = 0;
        for (let block = 0; block < Math.ceil(total / frames) + 2; block++) {
          if (block) player.render(null, quantumMs(frames) * (20 + block), clock, frames, output, 1,
            { outputAt: source + 10000, limitMs: 300, uncertaintyMs: 1 });
          for (let i = 0; i < frames; i++) for (let c = 0; c < 2; c++) {
            const expected = last[c] * Math.max(0, total - offset - i - 1) / total;
            assert.ok(Math.abs(output[i * 2 + c] - expected) < ENVELOPE_TOLERANCE,
              'only the prior published value may fade; no expired fresh PCM or renewed tail');
          }
          offset += frames;
        }
        assert.equal(player.tailRemaining, 0);
      } finally { player.clear(); }
    }
  });

  test(`${mode}: valid fresh audio fades in immediately while the expired edge fades out`, () => {
    const player = signal(mode, type, rate), reference = signal(mode, type, rate);
    const output = new Float32Array(64 * 2), fresh = new Float32Array(64 * 2);
    try {
      for (let block = 0; block < 20; block++) {
        const target = block ? player.rawCursorMs : 100;
        player.render(target, quantumMs(64) * block, clock, 64, output);
        reference.render(target, quantumMs(64) * block, clock, 64, fresh);
      }
      const source = player.rawCursorMs;
      const deadline = { outputAt: source + 400, limitMs: 300, uncertaintyMs: 1 };
      player.render(source, quantumMs(64) * 20, clock, 64, output, 1, deadline);
      reference.render(source, quantumMs(64) * 20, clock, 64, fresh, 1, deadline);
      const edge = player.last.slice(), remaining = 240 - 64;
      reference.recoveryTail.fill(0);
      reference.last.fill(0);
      let sawFresh = false;
      for (let block = 0; block < 6; block++) {
        const target = player.rawCursorMs, context = quantumMs(64) * (21 + block);
        const nextDeadline = { outputAt: target + 20, limitMs: 300, uncertaintyMs: 1 };
        const produced = player.render(target, context, clock, 64, output, 1, nextDeadline);
        reference.render(target, context, clock, 64, fresh, 1, nextDeadline);
        if (!block) { assert.equal(produced, 64); sawFresh = fresh.some(value => value !== 0); }
        for (let i = 0; i < 64; i++) for (let c = 0; c < 2; c++) {
          const expected = fresh[i * 2 + c] + edge[c] * Math.max(0, remaining - block * 64 - i - 1) / remaining;
          assert.ok(Math.abs(output[i * 2 + c] - expected) < ENVELOPE_TOLERANCE);
        }
        assert.equal(player.sourceDeadlineState, 'within-bound');
      }
      assert.ok(sawFresh, 'new audio starts during the old tail, without a 5ms queue delay');
    } finally { player.clear(); reference.clear(); }
  });

}
test('the shared source deadline keeps unsupported timing unknown instead of manufacturing a zero anchor', () => {
  const result = { sourceDeadlineState: 'violated', sourceDeltaMs: 900, sourceDeltaUpperMs: 901 };
  assert.equal(sourceDeadlineAt({ unknownReason: 'output-clock-unavailable' }, clock, null, 5, 0, result), true);
  assert.equal(result.sourceDeadlineState, 'unknown');
  assert.equal(result.sourceDeltaMs, null); assert.equal(result.sourceDeltaUpperMs, null);
  assert.equal(result.sourceDeadlineReason, 'output-clock-unavailable');
});
