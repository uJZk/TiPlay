// SPDX-License-Identifier: GPL-3.0-only
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

  test(`${mode}: an expired nonzero recovery tail remains rejected by the unchanged 300ms deadline`, () => {
    const player = signal(mode, type, rate), output = new Float32Array(128 * 2);
    let context = 0;
    try {
      for (let block = 0; block < 20; block++, context += quantumMs(128))
        player.render(block ? player.rawCursorMs : 100, context, clock, 128, output);
      player.render(null, context, { ...clock, generation: 2 }, 128, output);
      context += quantumMs(128);
      assert.ok(output.some(value => Math.abs(value) > 0.01));
      const source = player.rawCursorMs;
      player.render(source, context, { ...clock, generation: 2 }, 128, output, 1,
        { outputAt: source + 301, limitMs: 300, uncertaintyMs: 0 });
      assert.equal(player.sourceDeadlineState, 'violated');
      assert.equal(player.sourceDeadlineRejectedFrames, 128);
      assert.ok(output.every(value => value === 0), 'neither the old envelope nor fresh PCM may leak past the source deadline');
      assert.ok(player.recoveryTail.every(value => value === 0));
    } finally { player.clear(); }
  });
}

for (const [mode, type, rate] of [['carplay', 0, 48000], ['airplay-mirror', 6, 44100]]) {
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

  test(`${mode}: legal fresh PCM cannot disguise an expired source in its recovery mix`, () => {
    const player = signal(mode, type, rate), freshOnly = signal(mode, type, rate);
    const output = new Float32Array(128 * 2), fresh = new Float32Array(128 * 2);
    try {
      for (let block = 0; block < 50; block++) {
        const context = quantumMs(128) * block, target = 100 + context;
        const deadline = { outputAt: target + 269, limitMs: 300, uncertaintyMs: 1 };
        player.render(target, context, clock, 128, output, 1, deadline);
        freshOnly.render(target, context, clock, 128, fresh, 1, deadline);
      }
      const previousCursor = player.rawCursorMs, oldValue = player.last[0];
      assert.ok(Math.abs(oldValue) > 0.05);
      // Remove only the reference player's old component. Its actual fresh PCM
      // independently proves that this is an old-tail violation, not late input.
      const recover = freshOnly.recover.bind(freshOnly);
      freshOnly.recover = reason => { recover(reason); freshOnly.recoveryTail.fill(0); freshOnly.recoveryRemaining = 0; };
      const context = 50 * quantumMs(128), target = 100 + context + 40;
      const deadline = { outputAt: target + 269, limitMs: 300, uncertaintyMs: 1 };
      assert.ok(deadline.outputAt - previousCursor > 300, 'even the prior end cursor is already too old');
      player.render(target, context, clock, 128, output, 1, deadline);
      freshOnly.render(target, context, clock, 128, fresh, 1, deadline);
      assert.equal(freshOnly.sourceDeadlineState, 'within-bound');
      assert.ok(fresh.some(value => Math.abs(value) > 0.01));
      assert.equal(player.sourceDeadlineState, 'violated');
      assert.equal(player.sourceDeadlineRejectedFrames, 128);
      assert.ok(output.every(value => value === 0), 'a fresh target cannot relabel the old source as fresh');
      assert.equal(player.deadlineSourceMs, null);
    } finally { player.clear(); freshOnly.clear(); }
  });

  test(`${mode}: a legal last-sample tail does not inherit a 1024-frame quantum's extra age`, () => {
    const player = signal(mode, type, rate), output = new Float32Array(1024 * 2);
    try {
      for (let block = 0; block < 20; block++)
        player.render(block ? player.rawCursorMs : 100, quantumMs(1024) * block, clock, 1024, output);
      // The independently encoded PCM marker recovers the last emitted source
      // coordinate rather than trusting the implementation's deadline snapshot.
      const markerSourceMs = output.at(-1) * 32768 * 2 * 1000 / rate;
      assert.ok(Math.abs(markerSourceMs - player.deadlineSourceMs) < 1);
      const observation = {};
      const accepted = sourceDeadlineAt({ outputAt: markerSourceMs + 293, limitMs: 300, uncertaintyMs: 1 },
        clock, player.deadlineSourceMs, player.fadeFrames / 48, 0, observation);
      assert.equal(accepted, true);
      assert.equal(observation.sourceDeadlineState, 'within-bound');
    } finally { player.clear(); }
  });

  test(`${mode}: a 1024-frame recovery checks its actual old-tail span on both sides of the deadline`, () => {
    for (const [ageMs, accepted] of [[293, true], [295, false]]) {
      const player = signal(mode, type, rate), output = new Float32Array(1024 * 2);
      try {
        for (let block = 0; block < 20; block++)
          player.render(block ? player.rawCursorMs : 100, quantumMs(1024) * block, clock, 1024, output);
        const markerSourceMs = output.at(-1) * 32768 * 2 * 1000 / rate;
        const oldTailUpperMs = ageMs + 5 + 1;
        assert.equal(oldTailUpperMs <= 300, accepted, 'independent PCM marker and existing 5ms envelope decide legality');
        const produced = player.render(player.rawCursorMs + 24, quantumMs(1024) * 20,
          { ...clock, generation: 2 }, 1024, output, 1,
          { outputAt: markerSourceMs + ageMs, limitMs: 300, uncertaintyMs: 1 });
        assert.equal(player.sourceDeadlineState, accepted ? 'within-bound' : 'violated');
        assert.equal(produced, accepted ? 1024 : 0);
        assert.equal(output.every(value => value === 0), !accepted);
        assert.equal(player.sourceDeadlineRejectedFrames, accepted ? 0 : 1024);
      } finally { player.clear(); }
    }
  });

  test(`${mode}: a short missing-output tail excludes a large block's zero padding and still rejects expired PCM`, () => {
    for (const [ageMs, accepted] of [[296, true], [297, false]]) {
      const player = signal(mode, type, rate), output = new Float32Array(1024 * 2);
      try {
        for (let block = 0; block < 20; block++)
          player.render(block ? player.rawCursorMs : 100, quantumMs(1024) * block, clock, 1024, output);
        const markerSourceMs = output.at(-1) * 32768 * 2 * 1000 / rate;
        const newer = { ...clock, generation: 2 };
        // The first missing output pair consumes 128 of the original 240 fade
        // samples. The next 1024-frame request contains only 112 tail samples.
        player.render(null, quantumMs(1024) * 20, newer, 128, output.subarray(0, 128 * 2));
        const tailFrames = 240 - 128;
        const expectedUpperMs = ageMs + tailFrames / 48 + 1;
        assert.equal(expectedUpperMs <= 300, accepted);
        player.render(null, quantumMs(1024) * 20 + quantumMs(128), newer, 1024, output, 1,
          { outputAt: markerSourceMs + ageMs, limitMs: 300, uncertaintyMs: 1 });
        assert.equal(player.sourceDeadlineState, accepted ? 'within-bound' : 'violated');
        assert.equal(output.subarray(0, (tailFrames - 1) * 2).some(value => Math.abs(value) > 0.01), accepted);
        assert.ok(output.subarray(tailFrames * 2).every(value => value === 0));
        assert.equal(player.sourceDeadlineRejectedFrames, accepted ? 0 : 1024);
        if (accepted) {
          // Reacquisition after an exhausted old tail emits new PCM normally.
          assert.equal(player.render(player.rawCursorMs, quantumMs(1024) * 21, newer, 1024, output), 1024);
          assert.ok(output.some(value => Math.abs(value) > 0.01));
        }
      } finally { player.clear(); }
    }
  });

  test(`${mode}: a real partial 1024-frame underrun bounds only emitted PCM and its held tail`, () => {
    for (const [ageMs, accepted] of [[293, true], [295, false]]) {
      const player = signal(mode, type, rate, 2, 5), reference = signal(mode, type, rate, 2, 5);
      const output = new Float32Array(1024 * 2), measured = new Float32Array(1024 * 2);
      let found = false;
      try {
        for (let block = 0; block < 10 && !found; block++) {
          const context = quantumMs(1024) * block;
          const produced = reference.render(context, context, clock, 1024, measured);
          if (produced <= 0 || produced >= 736) {
            player.render(context, context, clock, 1024, output);
            continue;
          }
          const firstMarkerMs = measured[1] * 32768 * 2 * 1000 / rate;
          const lastMarkerMs = measured[(produced - 1) * 2 + 1] * 32768 * 2 * 1000 / rate;
          const tailFrames = Math.min(240, 1024 - produced);
          const independentHeldUpperMs = firstMarkerMs + ageMs - lastMarkerMs + (produced + tailFrames) / 48 + 1;
          assert.equal(independentHeldUpperMs <= 300, accepted);
          const actualProduced = player.render(context, context, clock, 1024, output, 1,
            { outputAt: firstMarkerMs + ageMs, limitMs: 300, uncertaintyMs: 1 });
          assert.equal(player.sourceDeadlineState, accepted ? 'within-bound' : 'violated');
          assert.equal(actualProduced, accepted ? produced : 0);
          assert.equal(output.every(value => value === 0), !accepted);
          assert.ok(output.subarray((produced + tailFrames) * 2).every(value => value === 0));
          assert.equal(player.sourceDeadlineRejectedFrames, accepted ? 0 : 1024);
          if (accepted) assert.deepEqual(output, measured, 'deadline validation preserves every original PCM/tail sample');
          found = true;
        }
        assert.equal(found, true, 'the real resampler must exhaust its five-packet source within a large render block');
      } finally { player.clear(); reference.clear(); }
    }
  });
}

test('the shared source deadline keeps unsupported timing unknown instead of manufacturing a zero anchor', () => {
  const result = { sourceDeadlineState: 'violated', sourceDeltaMs: 900, sourceDeltaUpperMs: 901 };
  assert.equal(sourceDeadlineAt({ unknownReason: 'output-clock-unavailable' }, clock, null, 5, 0, result), true);
  assert.equal(result.sourceDeadlineState, 'unknown');
  assert.equal(result.sourceDeltaMs, null); assert.equal(result.sourceDeltaUpperMs, null);
  assert.equal(result.sourceDeadlineReason, 'output-clock-unavailable');
});
