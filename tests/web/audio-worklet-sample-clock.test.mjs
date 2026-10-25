// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SoxrRuntime } from '../../site/play/streaming-resampler.js';

let Processor;
globalThis.AudioWorkletProcessor = class {
  constructor() { this.messages = []; this.port = { postMessage: message => this.messages.push(message) }; }
};
globalThis.registerProcessor = (_, implementation) => { Processor = implementation; };
globalThis.sampleRate = 48000;
globalThis.currentFrame = 480000; globalThis.currentTime = 10;
await import('../../site/play/audio-worklet.js');
const calibration = { rate: 48000, outputRate: 48000, delayMs: new SoxrRuntime().filterDelay(48000, 48000) };

function harness(getter) {
  let frame = 480000, sourceFrame = 0, sequence = 0, physicalMs = 0, deviceRate = 1;
  const activate = () => {
    globalThis.currentFrame = frame;
    Object.defineProperty(globalThis, 'currentTime', { configurable: true, get: () => getter(frame / 48000) });
  };
  activate();
  const processor = new Processor();
  const post = data => { activate(); processor.port.onmessage({ data }); };
  post({ calibration, debug: true, diagnosticRevision: 1, clock: { version: 2, generation: 1, rate: 1,
    serverOriginMs: 800000, localOriginMs: 0, state: 'locked', uncertaintyMs: 0 } });
  processor.evidence.now = () => frame / 48; // Compare media behavior under the same independent diagnostic clock.
  return {
    processor, post,
    rate(value) {
      const before = processor.arrivalTime(processor.renderContextMs());
      post({ deviceClock: { rate: value } }); deviceRate = value;
      assert.ok(Math.abs(processor.arrivalTime(processor.renderContextMs()) - before) < 1e-10,
        'a rate update must integrate at the actual sample cursor without moving its phase');
    },
    feed() {
      while (sourceFrame / 48 < physicalMs + 300) {
        const first = sourceFrame, pcm = new Int16Array(960 * 2);
        for (let i = 0; i < 960; i++) {
          pcm[i * 2] = Math.round(8000 * Math.sin((first + i) * 2 * Math.PI * 173 / 48000));
          pcm[i * 2 + 1] = 6000 + Math.round((first + i) / 48);
        }
        post({ type: 255, semanticType: 1, mode: 'carplay', epoch: 1, generation: 3,
          rate: 48000, channels: 2, flags: 0, sequence: sequence++, arrivalLocalTimeMs: physicalMs, pcm: pcm.buffer });
        sourceFrame += 960;
      }
    },
    render() {
      activate(); const output = [new Float32Array(128), new Float32Array(128)];
      assert.equal(processor.process([], [output]), true);
      frame += 128; physicalMs += 128 / 48 / deviceRate;
      return output;
    },
    get contextMs() { return frame / 48; },
    dispose() { post({ dispose: true }); },
  };
}

test('real sample progress preserves untimed voice through stalled, biased and wrongly sloped currentTime getters', () => {
  for (const getter of [() => 0, () => NaN, seconds => seconds + 5000,
    seconds => seconds * .98, seconds => seconds * 1.02,
    seconds => seconds + (Math.floor(seconds * 10) % 2 ? 5 : -5),
    () => { throw new Error('The time getter is unusable.'); }]) {
    const ordinary = harness(seconds => seconds), perturbed = harness(getter);
    let audible = 0;
    try {
      for (let quantum = 0; quantum < 1200; quantum++) {
        if (quantum % 200 === 0) {
          const rate = [1, .996, .998, 1.002, 1.004, 1][quantum / 200];
          ordinary.rate(rate); perturbed.rate(rate);
        }
        ordinary.feed(); perturbed.feed();
        const expected = ordinary.render(), actual = perturbed.render();
        assert.deepEqual(actual, expected, `actual PCM at quantum ${quantum}`);
        if (actual[1].some(value => value > .1)) audible++;
      }
      const expected = ordinary.processor.timelines.get(255), actual = perturbed.processor.timelines.get(255);
      assert.ok(audible > 1150, 'the actual voice signal continues through bounded rate refinements');
      assert.deepEqual(actual.recoveryCounts, {}, 'an inaccurate getter must not create clock-step or underrun recovery');
      assert.equal(actual.backend !== null, true); assert.equal(actual.rawCursorMs, expected.rawCursorMs);
      assert.equal(actual.sourceDeadlineState, 'unknown', 'arrival-anchored PCM cannot claim a physical sender deadline');
      assert.deepEqual(perturbed.processor.messages, ordinary.processor.messages,
        'source observations, diagnostics and playout references use the same real sample domain');
      const reports = perturbed.processor.messages.filter(message => message.diagnostics);
      assert.ok(reports.length >= 6, 'diagnostics cadence follows emitted samples even when currentTime stops');
      assert.ok(reports.at(-1).diagnostics.renderTimeMs > 13000);
      perturbed.post({ type: 255, semanticType: 1, mode: 'carplay', epoch: 1, generation: 3,
        flags: 2, ended: true, pcm: new ArrayBuffer(0) });
      assert.equal(perturbed.processor.messages.filter(message => message.playout).at(-1).playout.contextTimeMs,
        perturbed.contextMs, 'end feedback reports the completed sample boundary');
    } finally { ordinary.dispose(); perturbed.dispose(); }
  }
});

test('counterless compatibility integrates block sizes once initialized and never certifies a physical render probe', () => {
  delete globalThis.currentFrame;
  Object.defineProperty(globalThis, 'currentTime', { configurable: true, writable: true, value: 4 });
  const processor = new Processor();
  const post = data => processor.port.onmessage({ data });
  post({ contextAnchor: { contextTimeMs: 0, localTimeMs: 5000 }, outputUncertaintyMs: 0,
    clock: { version: 2, generation: 1, rate: 1, localOriginMs: 0, serverOriginMs: 0, state: 'locked', uncertaintyMs: 0 } });
  post({ renderProbe: 1 });
  for (let block = 0; block < 12; block++) {
    if (block) globalThis.currentTime = block % 2 ? 10000 : NaN;
    const output = [new Float32Array(128), new Float32Array(128)];
    assert.equal(processor.process([], [output]), true);
    assert.ok(Math.abs(processor.renderContextMs() - (block + 1) * 128 / 48) < 1e-9);
    const before = processor.arrivalTime(processor.renderContextMs());
    post({ deviceClock: { rate: block % 2 ? .996 : 1.004 } });
    assert.equal(processor.arrivalTime(processor.renderContextMs()), before);
    assert.equal(processor.deadline({ synchronized: true, mode: 'carplay', filterUncertaintyMs: 0 },
      processor.renderContextMs()).unknownReason, 'output-clock-unavailable',
      'an unverified compatibility coordinate cannot certify or reject a physical source deadline');
  }
  assert.equal(processor.messages.some(message => message.renderProbe), false);
  assert.equal(processor.renderDomainNextFrame, null);
  post({ dispose: true });
});
