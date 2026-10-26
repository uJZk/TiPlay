// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
let Processor;
globalThis.AudioWorkletProcessor = class { constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(value) }; } };
globalThis.registerProcessor = (_, value) => { Processor = value; };
globalThis.sampleRate = 48000; globalThis.currentFrame = 0;
await import('../../site/play/audio-worklet.js');
function harness() {
  const p = new Processor(); let frame = 0;
  const post = data => p.port.onmessage({ data });
  const render = (frames = 128, observed = frame) => {
    globalThis.currentFrame = observed;
    const output = [new Float32Array(frames), new Float32Array(frames)]; p.process([], [output]); frame += frames; return output;
  };
  const feed = (type = 0, epoch = 1) => post({ type, semanticType: type, epoch, generation: 1, rate: 48000, channels: 1,
    arrivalLocalTimeMs: 0, pcm: Int16Array.from({ length: 19200 }, (_, i) => Math.sin(i * .13) * 10000).buffer });
  return { p, post, render, feed };
}

test('probes acknowledge only new positive tokens on an actual render quantum', () => {
  const h = harness(); h.post({ renderProbe: 1 }); h.post({ renderProbe: 3 }); h.post({ renderProbe: 2 });
  assert.equal(h.p.messages.length, 0); h.render(64);
  assert.deepEqual(h.p.messages[0].renderProbe, { token: 3, generation: 0, startFrame: 0, endFrame: 64, renderQuantumFrames: 64 });
  for (const token of [3, 2, 0, -1, NaN, Infinity]) h.post({ renderProbe: token });
  h.render(); assert.equal(h.p.messages.filter(x => x.renderProbe).length, 1);
  h.post({ dispose: true });
});

test('counter discontinuities retire measurement domains while NetEq audio remains bit identical', () => {
  const a = harness(), b = harness(); a.feed(); b.feed();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'currentTime');
  Object.defineProperty(globalThis, 'currentTime', { configurable: true, get() { throw new Error('must not read'); } });
  try {
    for (let i = 0; i < 100; i++) {
      b.post({ clock: { rate: .98, generation: i }, plans: { audio: { to: 9000 } } });
      assert.deepEqual(a.render(), b.render(128, i % 3 ? 0 : i * 128 + 256));
    }
    assert.ok(b.p.domain > 0); assert.equal(a.p.renderedFrames, b.p.renderedFrames);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'currentTime', descriptor); else delete globalThis.currentTime;
    a.post({ dispose: true }); b.post({ dispose: true });
  }
});

test('end drains an utterance, epoch reset returns credit and stale data cannot revive it', () => {
  const h = harness(); h.feed(1, 2);
  const stream = h.p.streams.get(1); h.feed(1, 1); assert.equal(h.p.streams.get(1), stream);
  h.post({ type: 1, epoch: 3, generation: 1, flags: 2, pcm: new ArrayBuffer(0), ended: true });
  for (let i = 0; i < 300; i++) h.render();
  assert.equal(h.p.streams.size, 0);
  const bytes = h.p.messages.filter(x => x.consumed).reduce((n, x) => n + x.consumed, 0);
  assert.equal(bytes, 19200 * 2 * 2); // Live input plus rejected stale input.
  h.post({ dispose: true });
});

test('actual WASM mixer ducks both media streams smoothly and diagnostics remain opt in', () => {
  const h = harness(); h.feed(0); h.feed(6); h.render(); const before = h.p.mediaGain;
  h.feed(1); const output = h.render(8192);
  assert.ok(h.p.mediaGain < before); assert.ok(Math.abs(h.p.mediaGain - .2) < .0001);
  assert.deepEqual(output[0], output[1]); assert.equal(h.p.diagnostics, null);
  h.post({ debug: true, diagnosticRevision: 7, generation: 1 });
  for (let i = 0; i < 190; i++) h.render();
  const message = h.p.messages.find(x => x.diagnostics);
  assert.equal(message.diagnosticRevision, 7); assert.equal(message.diagnostics.stream0.backend, 'neteq');
  assert.ok(Number.isFinite(message.diagnostics.stream0.targetDelayMs));
  h.post({ debug: false }); h.post({ dispose: true });
});
