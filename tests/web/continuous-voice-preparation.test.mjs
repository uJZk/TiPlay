// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ContinuousAudio } from '../../site/play/continuous-audio.js';
import { SoxrRuntime } from '../../site/play/streaming-resampler.js';

const runtime = new SoxrRuntime();
function harness(rate = 48000, frames = 128) {
  const base = 800000, player = new ContinuousAudio(runtime, rate, 1, 48000, () => {}, 6500,
    { mode: 'carplay', type: 1 });
  player.synchronized = true; player.debug(true);
  const clock = { localOriginMs: 0, serverOriginMs: base, rate: 1, generation: 1, state: 'locked' };
  let sequence = 0, input = 0;
  function feed(count, first = input) {
    const pcm = Int16Array.from({ length: count }, (_, i) => Math.round(8000 + 2000 * Math.sin((first + i) * 2 * Math.PI * 73 / rate)));
    player.push({ pcm: pcm.buffer, presentationMs: base + first * 1000 / rate,
      decodeTimestampUs: first * 1000000 / rate, arrivalLocalTimeMs: first * 1000 / rate,
      sequence: sequence++, generation: 1 }, 1);
    input = first + count;
  }
  function step(contextMs, uncertaintyMs = 0, minimumDelayMs = 60) {
    const deadline = { outputAt: contextMs + 200, uncertaintyMs, limitMs: 300 };
    const prepared = player.prepareVoice({ contextMs, frames, clock, deviceRate: 1, deadline,
      minimumDelayMs, admissionReserveMs: player.hasEmitted ? 0 : 30, waitMs: 20 });
    const output = new Float32Array(frames), produced = player.render(prepared.targetMs, contextMs, clock, frames, output, 1, deadline);
    return { prepared, output, produced };
  }
  return { player, clock, feed, step, frames, base, rate };
}

test('real retained priming preserves unplayed coordinates until its first admitted block', () => {
  const h = harness(8000, 64); h.feed(800);
  const first = h.step(0);
  assert.equal(first.produced, 0);
  assert.equal(h.player.rawCursorMs, null);
  assert.equal(h.player.sourceFrame, 0);
  assert.ok(h.player.voicePreparation.inputFrame > 0, 'real filter input is retained while waiting');
  const backend = h.player.backend;
  let emitted = false;
  for (let context = 64 / 48; context < 80; context += 64 / 48) {
    const block = h.step(context);
    if (block.produced) {
      assert.equal(block.produced, 64); assert.ok(block.output.some(value => value > 0));
      assert.equal(h.player.backend, backend); emitted = true; break;
    }
    assert.equal(h.player.rawCursorMs, null);
  }
  assert.ok(emitted, 'a finite native-call budget can complete real low-rate priming across callbacks');
  assert.equal(h.player.recoveryCounts.underrun || 0, 0);
  assert.equal(h.player.hasEmitted, true);
  h.player.clear();
});

test('a finite twenty-ms voice packet can emit after the wall wait without twenty-ms playable reserve', () => {
  const h = harness(); h.feed(960);
  let produced = 0;
  for (let context = 0; context <= 40; context += 128 / 48) produced += h.step(context).produced;
  assert.ok(produced >= 128, 'real first-quantum readiness admits a short utterance');
  assert.ok(h.player.hasEmitted);
  h.player.clear();
});

test('new legal input wakes a deadline-blocked voice without reusing expired staged PCM', () => {
  const h = harness(); h.feed(4800);
  for (let context = 0; context < 100; context += 128 / 48) h.step(context);
  const frontier = h.player.rawCursorMs;
  h.clock.generation++;
  let waiting = false;
  for (let context = 100; context < 400; context += 128 / 48) {
    const block = h.step(context, 80, 250);
    if (h.player.sourceDeadlineState === 'violated') assert.ok(block.output.every(value => value === 0));
    if (h.player.voicePreparationState === 'waiting-deadline') waiting = true;
  }
  assert.ok(waiting, 'the old finite supply really reaches a deadline-blocked state');
  h.feed(24000);
  let resumed = false;
  for (let context = 400; context < 500; context += 128 / 48) {
    const block = h.step(context, 0, 250);
    if (block.produced) {
      assert.ok(h.player.rawCursorMs >= frontier); assert.ok(block.output.some(value => value > 0)); resumed = true; break;
    }
  }
  assert.ok(resumed);
  h.player.clear();
});
