// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ContinuousAudio, sourceDeadlineAt, sourceDeadlineUncertainty } from '../../site/play/continuous-audio.js';
import { SoxrRuntime } from '../../site/play/streaming-resampler.js';

let Processor;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = (_, value) => { Processor = value; };
globalThis.sampleRate = 48000; globalThis.currentTime = 0; globalThis.currentFrame = 0;
await import('../../site/play/audio-worklet.js');

function projection(applied, anchorMs = 0) {
  const processor = new Processor();
  globalThis.currentFrame = 0;
  processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
  processor.contextAnchor = { contextTimeMs: anchorMs, localTimeMs: anchorMs };
  processor.outputUncertaintyMs = 0;
  processor.deviceClock = { rate: applied };
  processor.clock = { generation: 1, rate: 1, state: 'locked', localOriginMs: 0, serverOriginMs: 0, uncertaintyMs: 0 };
  return { processor, timeline: { mode: 'carplay', synchronized: true, filterUncertaintyMs: 0 } };
}

test('worklet output uncertainty covers each physical endpoint at both ends of 64 to 1024 frame quanta', () => {
  for (const frames of [64, 128, 256, 512, 1024]) for (const applied of [.98, .986, 1, 1.014, 1.02]) {
    const h = projection(applied);
    for (const physical of [.98, 1, 1.02]) for (const contextMs of [-200, 0, 648]) {
      const deadline = h.processor.deadline(h.timeline, contextMs);
      for (const position of [contextMs, contextMs + frames / 48]) {
        const projected = position / applied, truth = position / physical;
        assert.ok(Math.abs(projected - truth) <= sourceDeadlineUncertainty(deadline, frames / 48 / applied) + 1e-12);
      }
    }
  }
});

test('rate projection uncertainty rejects physically expired output and still accepts legal source age', () => {
  const h = projection(1.02), contextMs = 648, physical = .98;
  const deadline = h.processor.deadline(h.timeline, contextMs);
  for (const estimatedAge of [240, 290]) {
    const source = deadline.outputAt - estimatedAge, result = {};
    const actualAge = contextMs / physical - source;
    const accepted = sourceDeadlineAt(deadline, h.processor.clock, source, 0, 0, result);
    assert.equal(accepted, actualAge <= 300);
    assert.equal(result.sourceDeadlineState, estimatedAge === 240 ? 'within-bound' : 'violated');
  }
  h.processor.contextAnchor = null;
  const unknown = h.processor.deadline(h.timeline, contextMs), result = {};
  assert.equal(sourceDeadlineAt(unknown, h.processor.clock, 0, 0, 0, result), true);
  assert.equal(result.sourceDeadlineState, 'unknown', 'missing phase evidence cannot turn into a fabricated zero uncertainty');
  h.processor.contextAnchor = { contextTimeMs: 0, localTimeMs: 0 };
  h.processor.outputUncertaintyMs = null;
  assert.equal(h.processor.outputUncertainty(contextMs, 128), null, 'missing native measurement uncertainty remains unknown');
});

test('startup delay reserves output projection uncertainty inside the unchanged source ceiling', () => {
  const h = projection(1.02), contextMs = 648;
  h.processor.delayPlans.audio.to = 300;
  const target = h.processor.targetTime(h.timeline, contextMs, 1024);
  for (const physical of [.98, 1.02]) {
    const actualAge = contextMs / physical - target;
    assert.ok(actualAge + 30 <= 300 + 1e-12, 'the existing recovery window remains inside the physical source-age ceiling');
  }
});

test('uncertainty changes cannot seek an admitted live filter, while actual expired source remains rejected', () => {
  const h = projection(1), recoveries = [];
  h.timeline.backend = {};
  h.timeline.recover = reason => { recoveries.push(reason); h.timeline.backend = null; };
  h.processor.delayPlans.audio.to = 250;
  h.processor.targetTime(h.timeline, 0, 128);
  for (const uncertaintyMs of [15, 35, 0, 35, 15]) {
    h.processor.outputUncertaintyMs = uncertaintyMs;
    h.processor.targetTime(h.timeline, 0, 128);
    assert.equal(h.timeline.networkDelayMs, 250);
    assert.deepEqual(recoveries, [], 'an uncertainty budget is not a changed network plan');
  }
  h.processor.outputUncertaintyMs = 60;
  const deadline = h.processor.deadline(h.timeline, 0), result = {};
  assert.equal(sourceDeadlineAt(deadline, h.processor.clock, -250, 0, 0, result), false);
  assert.equal(result.sourceDeadlineState, 'violated', 'preserving DSP never permits physically expired samples');
});

test('real delay-plan changes retain the existing cumulative 8ms seek boundary', () => {
  const h = projection(1), recoveries = [];
  h.timeline.backend = {};
  h.timeline.recover = reason => { recoveries.push(reason); h.timeline.backend = null; };
  h.processor.delayPlans.audio.to = 250;
  h.processor.targetTime(h.timeline, 0, 128);
  for (const target of [253, 257]) {
    h.processor.delayPlans.audio.to = target; h.processor.targetTime(h.timeline, 0, 128);
    assert.equal(h.timeline.networkDelayMs, 250); assert.deepEqual(recoveries, []);
  }
  h.processor.delayPlans.audio.to = 258; h.processor.targetTime(h.timeline, 0, 128);
  assert.equal(h.timeline.networkDelayMs, 258);
  assert.deepEqual(recoveries, ['network-buffer']);
  h.processor.targetTime(h.timeline, 0, 128);
  assert.deepEqual(recoveries, ['network-buffer'], 'the applied plan is acknowledged once');
});


test('real Soxr held PCM fades for 5ms even when output timing changes beyond the source cutoff', () => {
  const runtime = new SoxrRuntime();
  for (const offset of [-1000, 1000]) {
    const player = new ContinuousAudio(runtime, 48000, 1, 48000, () => {}, 1000, { mode: 'carplay', buffered: true });
    player.synchronized = true;
    const h = projection(1), firstOutput = new Float32Array(128), output = new Float32Array(1024);
    try {
      for (let frame = 0, sequence = 0; frame < 19200; frame += 960) player.push({ presentationMs: frame / 48,
        sequence: sequence++, generation: 1, pcm: new Int16Array(960).fill(16384).buffer });
      player.render(0, 0, h.processor.clock, 128, firstOutput);
      const edge = firstOutput.at(-1);
      assert.ok(edge > 0);
      player.recover('underrun');
      h.processor.contextAnchor = { contextTimeMs: 128 / 48, localTimeMs: offset };
      player.render(null, 128 / 48, h.processor.clock, 1024, output, 1, h.processor.deadline(player, 128 / 48));
      for (let i = 0; i < output.length; i++)
        assert.ok(Math.abs(output[i] - edge * Math.max(0, 239 - i) / 240) < .25 / 32768);
      assert.equal(player.sourceDeadlineState, 'unknown');
      assert.equal(player.sourceDeadlineRejectedFrames, 0);
    } finally { player.clear(); }
  }
});
