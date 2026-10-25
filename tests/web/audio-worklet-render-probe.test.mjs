// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ContinuousAudio } from '../../site/play/continuous-audio.js';

let Processor;
globalThis.AudioWorkletProcessor = class {
  constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(value) }; }
};
globalThis.registerProcessor = (_, value) => { Processor = value; };
globalThis.sampleRate = 48000;
globalThis.currentTime = 0; globalThis.currentFrame = 0;
await import('../../site/play/audio-worklet.js');

function harness() {
  const processor = new Processor();
  let next = 0;
  const post = data => processor.port.onmessage({ data });
  const replies = () => processor.messages.filter(message => message.renderProbe).map(message => message.renderProbe);
  function render(frames = 128, frame = next, hardwareFrame = frame) {
    globalThis.currentTime = frame / sampleRate; globalThis.currentFrame = hardwareFrame;
    const output = [new Float32Array(frames), new Float32Array(frames)];
    processor.process([], [output]); next = frame + frames;
    return output;
  }
  return { processor, post, render, replies };
}

test('render probes certify only a processed block, once, without Debug or active streams', () => {
  const h = harness();
  h.post({ renderProbe: 1 });
  assert.deepEqual(h.replies(), [], 'port delivery alone cannot certify an unchecked sample domain');
  h.render();
  assert.deepEqual(h.replies(), [{ token: 1, generation: 0, startFrame: 0, endFrame: 128, renderQuantumFrames: 128 }]);
  for (let index = 0; index < 20; index++) h.render();
  assert.equal(h.replies().length, 1, 'processing alone must not create per-quantum protocol traffic');
  assert.equal(h.processor.diagnostics, null);
  assert.equal(h.processor.timelines.size, 0);
});

test('render probes retain only the newest positive safe token and never acknowledge it twice', () => {
  const h = harness();
  h.post({ renderProbe: 1 }); h.post({ renderProbe: 3 }); h.post({ renderProbe: 2 });
  h.render(64);
  assert.deepEqual(h.replies(), [{ token: 3, generation: 0, startFrame: 0, endFrame: 64, renderQuantumFrames: 64 }]);
  for (const token of [3, 2, 0, -1, 3.5, NaN, Infinity, 2 ** 53, '4']) h.post({ renderProbe: token });
  h.render(256);
  assert.equal(h.replies().length, 1);
  h.post({ renderProbe: 4 }); h.render(128);
  assert.deepEqual(h.replies().at(-1), { token: 4, generation: 0, startFrame: 0, endFrame: 448, renderQuantumFrames: 128 });
});

test('sample-domain probes detect exact one-block jumps and use the previous variable block length', () => {
  const h = harness();
  h.render(64);
  h.post({ renderProbe: 1 }); h.render(128);
  assert.deepEqual(h.replies().at(-1), { token: 1, generation: 0, startFrame: 0, endFrame: 192, renderQuantumFrames: 128 });
  // Expected=192; the 128-frame gap is smaller than this new 256-frame block.
  h.post({ renderProbe: 2 }); h.render(256, 320);
  assert.deepEqual(h.replies().at(-1), { token: 2, generation: 1, startFrame: 320, endFrame: 576, renderQuantumFrames: 256 });
  h.post({ renderProbe: 3 }); h.render(64);
  assert.deepEqual(h.replies().at(-1), { token: 3, generation: 1, startFrame: 320, endFrame: 640, renderQuantumFrames: 64 });
  // Reusing a prior frame range must never revive its old generation.
  h.post({ renderProbe: 4 }); h.render(128, 512);
  assert.deepEqual(h.replies().at(-1), { token: 4, generation: 2, startFrame: 512, endFrame: 640, renderQuantumFrames: 128 });
  h.post({ renderProbe: 5 }); h.render(128, 768);
  assert.deepEqual(h.replies().at(-1), { token: 5, generation: 3, startFrame: 768, endFrame: 896, renderQuantumFrames: 128 });
});

test('a sample-counter jump beyond the DSP allowance recovers before acknowledging its new generation', () => {
  const h = harness();
  const timeline = new ContinuousAudio({ filterDelay: () => 0 }, 48000, 1, 48000, () => {}, 1000);
  timeline.render = (_target, _context, _clock, _frames, output) => { output.fill(0); return 0; };
  h.processor.timelines.set(0, timeline);
  h.render();
  const actualPost = h.processor.port.postMessage;
  h.processor.port.postMessage = value => {
    if (value.renderProbe) assert.equal(timeline.recoveryCounts['device-clock-jump'], 1,
      'a token must not certify a domain before its counter jump is handled');
    actualPost(value);
  };
  h.post({ renderProbe: 1 }); h.render(128, 384);
  assert.equal(timeline.recoveryCounts['device-clock-jump'], 1);
  assert.deepEqual(h.replies().at(-1), { token: 1, generation: 1, startFrame: 384, endFrame: 512, renderQuantumFrames: 128 });
});

test('an exact one-block discrepancy retires rate evidence without restarting the live DSP timeline', () => {
  const h = harness();
  const timeline = new ContinuousAudio({ filterDelay: () => 0 }, 48000, 1, 48000, () => {}, 1000);
  timeline.render = (_target, _context, _clock, _frames, output) => { output.fill(0); return 0; };
  h.processor.timelines.set(0, timeline);
  h.render();
  h.post({ renderProbe: 1 }); h.render(128, 256);
  assert.deepEqual(h.replies().at(-1), { token: 1, generation: 1, startFrame: 256, endFrame: 384, renderQuantumFrames: 128 });
  assert.equal(timeline.recoveryCounts['device-clock-jump'], undefined);
  assert.equal(h.processor.nextContextFrame, 256, 'the established DSP cursor keeps its one-block allowance');
  h.post({ renderProbe: 2 }); h.render();
  assert.deepEqual(h.replies().at(-1), { token: 2, generation: 1, startFrame: 256, endFrame: 512, renderQuantumFrames: 128 });
  assert.equal(timeline.recoveryCounts['device-clock-jump'], undefined);
});

test('unsafe counters cannot certify probes or bridge the prior sample-domain run', () => {
  const h = harness(); h.render();
  h.post({ renderProbe: 1 }); h.render(128, 128, NaN);
  assert.deepEqual(h.replies(), []);
  h.render(128, 256, Infinity);
  assert.deepEqual(h.replies(), []);
  h.post({ renderProbe: 2 }); h.render(128, 384);
  assert.deepEqual(h.replies(), [{ token: 2, generation: 1, startFrame: 384, endFrame: 512, renderQuantumFrames: 128 }]);
  h.post({ renderProbe: 3 }); h.render(128, 512, Number.MAX_SAFE_INTEGER);
  assert.equal(h.replies().length, 1, 'an unsafe block-end sum is not proof even when the start itself is safe');
});

test('Debug, PCM reset and node replacement have separate sample-domain lifetimes', () => {
  const h = harness(); h.render(); h.render(128, 256);
  h.post({ debug: true }); h.post({ debug: false }); h.post({ reset: true, generation: 30 });
  h.post({ renderProbe: 1 }); h.render();
  assert.deepEqual(h.replies().at(-1), { token: 1, generation: 1, startFrame: 256, endFrame: 512, renderQuantumFrames: 128 });
  h.post({ dispose: true }); h.post({ renderProbe: 2 }); h.render();
  assert.equal(h.replies().length, 1);
  const replacement = harness(); replacement.post({ renderProbe: 1 }); replacement.render(128, 4096);
  assert.deepEqual(replacement.replies(), [{ token: 1, generation: 0, startFrame: 4096, endFrame: 4224, renderQuantumFrames: 128 }]);
});

test('Debug preserves exact counter recovery evidence and final samples before ordinary telemetry can overwrite it', () => {
  const h = harness(); h.post({ debug: true, diagnosticRevision: 4, generation: 8 });
  h.processor.evidence.now = () => 0;
  const timeline = new ContinuousAudio({ filterDelay: () => 0 }, 48000, 1, 48000, () => {}, 1000);
  timeline.epoch = 3;
  timeline.render = (_target, _context, _clock, _frames, output) => { output.fill(.125); return 128; };
  h.processor.watchTimeline(timeline); h.processor.timelines.set(0, timeline);
  h.render(); h.render(128, 384); h.render(); h.render();
  const message = h.processor.messages.find(m => m.evidence);
  assert.equal(message.diagnosticRevision, 4); assert.equal(message.playbackGeneration, 8);
  const cause = message.evidence.causes.find(c => c.reason === 'device-clock-jump');
  assert.equal(cause.observedFrame, 384); assert.equal(cause.expectedFrame, 128); assert.equal(cause.deltaFrames, 256);
  assert.equal(cause.epoch, 3); assert.equal(message.evidence.incomplete, false);
  assert.equal(message.evidence.blocks.at(-1).wave[0], .125);
  assert.equal(h.processor.evidence.stats().evidenceFirstJump.deltaFrames, 256);
  h.post({ debug: false }); const count = h.processor.messages.filter(m => m.evidence).length;
  h.render(128, 4096); assert.equal(h.processor.messages.filter(m => m.evidence).length, count);
});
