// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { constantDelay } from '../../site/play/delay-plan.js';
import { createAudioReferenceTimeline } from '../../site/play/audio-output-clock.js';
import { createAirPlayAudioDecoder } from '../../site/play/airplay-audio-decoder.js';

const module = await WebAssembly.compile(readFileSync(new URL('../../site/play/vendor/soxr/soxr.wasm', import.meta.url)));
let Processor;
globalThis.AudioWorkletProcessor = class { constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(value) }; } };
globalThis.registerProcessor = (_, value) => { Processor = value; };
globalThis.sampleRate = 48000;
globalThis.currentTime = 0; globalThis.currentFrame = 0;
await import('../../site/play/audio-worklet.js');

function harness(bytes = false) {
  const processor = new Processor(), base = 8000000;
  const post = data => processor.port.onmessage({ data });
  post(bytes ? { resamplerBytes: Uint8Array.from(readFileSync(new URL('../../site/play/vendor/soxr/soxr.wasm', import.meta.url))).buffer } : { resamplerModule: module });
  post({ clock: { version: 2, generation: 1, serverOriginMs: base, localOriginMs: 0, rate: 1, state: 'locked' },
    contextAnchor: { contextTimeMs: 0, localTimeMs: 200 }, localTimeOriginMs: 1792159881000,
    outputUncertaintyMs: 1, plans: { audio: constantDelay(60), video: constantDelay(0) } });
  let frame = 0;
  const cursors = new Map();
  function feed(type = 0, mode = 'carplay', epoch = 1, untilMs = frame / 48 + 400, gapMs = 0) {
    const key = `${type}:${epoch}`, cursor = cursors.get(key) || { frame: 0, sequence: 0 };
    while (cursor.frame < untilMs * 48) {
      const pcm = Int16Array.from({ length: 960 }, (_, i) => Math.round(10000 * Math.sin((cursor.frame + i) * 2 * Math.PI * 997 / 48000)));
      post({ type, mode, epoch, rate: 48000, channels: 1, flags: 0, sequence: cursor.sequence++, generation: 3,
        presentationMs: base + cursor.frame / 48 + gapMs, arrivalLocalTimeMs: frame / 48, pcm: pcm.buffer });
      cursor.frame += 960;
    }
    cursors.set(key, cursor);
  }
  function render() {
    globalThis.currentFrame = frame; globalThis.currentTime = frame / 48000;
    const output = [new Float32Array(128), new Float32Array(128)];
    processor.process([], [output]); frame += 128; return output;
  }
  return { processor, post, feed, render, base, get frame() { return frame; }, jump(frames) { frame += frames; } };
}

test('production worklet emits sample-count-driven audible content references without enabling debug', () => {
  const h = harness(); h.feed();
  for (let i = 0; i < 100; i++) { h.feed(); const output = h.render(); if (i > 5) assert.ok(output[0].some(value => Math.abs(value) > 0.1)); }
  const refs = h.processor.messages.filter(value => value.playout).map(value => value.playout);
  assert.ok(refs.length >= 6); assert.ok(refs.every(value => value.state === 'playing'));
  assert.equal(h.processor.diagnostics, null);
  assert.equal(h.processor.renderedFrames, 12800);
  for (const reference of refs) {
    assert.ok(Math.abs(reference.sourceTimeMs - (h.base + reference.contextTimeMs + 140)) < 0.1,
      '200ms device path is scheduled early using the audible context mapping, with filter delay inside source content');
    assert.equal(reference.outputUncertaintyMs, 1);
    assert.ok(reference.filterUncertaintyMs <= 1);
    assert.ok(reference.resampleRatio > 0.99 && reference.resampleRatio < 1.01);
    assert.equal(reference.networkDelayMs, 60);
  }
  h.post({ debug: true }); h.render();
  const stream = h.processor.messages.filter(value => value.diagnostics).at(-1).diagnostics.stream0;
  assert.ok(stream.resampleRatio > 0.99 && stream.resampleRatio < 1.01, 'diagnostics preserve the actual input/output ratio');
  assert.equal(stream.networkDelayMs, 60); assert.equal(stream.delayMs, 60, 'legacy delay telemetry reads the continuous queue target');
});

test('buffer target steps rebuffer once, keep their stable anchor, and never replay emitted media', () => {
  const h = harness(); h.feed();
  for (let i = 0; i < 30; i++) { h.feed(); h.render(); }
  const player = h.processor.timelines.get(0), backend = player.backend;
  h.post({ plans: { audio: constantDelay(90), video: constantDelay(0) } });
  const cursorBefore = player.rawCursorMs;
  for (let i = 0; i < 80; i++) { h.feed(); h.render(); assert.ok(player.rawCursorMs >= cursorBefore); }
  assert.equal(player.recoveryCounts['network-buffer'], 1);
  assert.notEqual(player.backend, backend); assert.equal(player.state, 'playing');
  const cursor = player.rawCursorMs;
  h.post({ plans: { audio: constantDelay(20), video: constantDelay(0) } });
  for (let i = 0; i < 80; i++) { h.feed(); h.render(); assert.ok(player.rawCursorMs >= cursor); }
  assert.equal(player.recoveryCounts['network-buffer'], 2);
  assert.equal(player.recoveryCounts['clock-step'], undefined, 'network adaptation does not pretend to be oscillator drift');
  assert.equal(player.state, 'playing');
});

test('epoch/format replacement and mirror shutdown preserve independent CarPlay filter and credits', () => {
  const h = harness(); h.feed(); h.feed(6, 'airplay-mirror');
  for (let i = 0; i < 20; i++) h.render();
  const carplay = h.processor.timelines.get(0), handle = carplay.backend.handle, outputFrames = carplay.outputFrames;
  h.feed(6, 'airplay-mirror', 2); h.render();
  assert.equal(h.processor.timelines.get(0), carplay); assert.equal(carplay.backend.handle, handle);
  assert.equal(carplay.outputFrames, outputFrames + 128);
  h.post({ type: 6, mode: 'airplay-mirror', epoch: 2, flags: 6, generation: 3, pcm: new ArrayBuffer(0) });
  h.render();
  assert.equal(h.processor.timelines.has(6), false); assert.equal(carplay.backend.handle, handle);
  assert.ok(h.processor.messages.some(value => value.playout?.mode === 'airplay-mirror' && value.playout.state === 'ended'));
  assert.ok(h.processor.messages.filter(value => value.consumed).every(value => value.generation === 3));
});

test('suspend/resume and device sample-counter jumps recover through fades without replay', () => {
  const h = harness(); h.feed();
  for (let i = 0; i < 20; i++) h.render();
  const player = h.processor.timelines.get(0), previous = player.rawCursorMs;
  h.post({ suspended: true });
  for (let i = 0; i < 10; i++) h.render();
  assert.equal(player.rawCursorMs, previous); assert.equal(player.state, 'rebuffering');
  h.post({ suspended: false }); h.feed(); h.render();
  assert.equal(player.state, 'playing'); assert.ok(player.rawCursorMs > previous);
  h.jump(1200); h.render();
  assert.equal(player.recoveryCounts['device-clock-jump'], 1);
});

test('real source-time gaps remain gaps in the new engine even with consecutive sequences', () => {
  for (const gapMs of [0.5, 1]) {
    const h = harness(); h.feed(0, 'carplay', 1, 20);
    h.feed(0, 'carplay', 1, 40, gapMs);
    const player = h.processor.timelines.get(0);
    assert.equal(player.queue[1].first - player.queue[0].end, Math.round(gapMs * 48));
    assert.equal(player.read(900, 128), 60, 'the resampler cannot consume the following packet across the missing source interval');
  }
});

test('codec end in a replacement epoch releases video-only fallback, and a new codec epoch primes explicitly', async () => {
  const h = harness(); h.feed(6, 'airplay-mirror');
  for (let i = 0; i < 20; i++) h.render();
  const references = createAudioReferenceTimeline();
  const playing = h.processor.messages.filter(value => value.playout?.type === 6).at(-1).playout;
  references.update({ ...playing, at: 1000, audibleTimeMs: 1000 });
  assert.equal(references.resolve('airplay-mirror', playing.sourceTimeMs, 1, 1000).required, true);
  const decoder = createAirPlayAudioDecoder({ onPcm: record => h.post({ ...record, generation: 3 }) });
  const common = { type: 6, mode: 'airplay-mirror', channels: 1, rate: 48000, flags: 4, sequence: 0 };
  try {
    await decoder.configure({ ...common, epoch: 2, config: { ended: true } });
    const ending = h.processor.messages.filter(value => value.playout?.type === 6).at(-1).playout;
    assert.equal(ending.state, 'ended'); assert.equal(ending.epoch, 2);
    references.update({ ...ending, at: 1010 });
    assert.equal(references.resolve('airplay-mirror', playing.sourceTimeMs, 1, 1010).state, 'video-only');
    await decoder.configure({ ...common, epoch: 3, config: { codec: 'pcm', sampleRate: 48000, channels: 1, bitDepth: 16 } });
    const priming = h.processor.messages.filter(value => value.playout?.type === 6).at(-1).playout;
    assert.equal(priming.state, 'priming'); assert.equal(priming.epoch, 3);
    h.feed(6, 'airplay-mirror', 3); h.render();
    assert.equal(h.processor.timelines.get(6).state, 'playing');
  } finally { decoder.dispose(); }
});

test('disposing a retired processor releases all per-stream filters and terminates processing', () => {
  const h = harness(); h.feed(); h.render();
  const backend = h.processor.timelines.get(0).backend;
  h.post({ dispose: true });
  assert.equal(backend.handle, 0); assert.equal(h.processor.runtime, null); assert.equal(h.processor.timelines.size, 0);
  const output = [new Float32Array(128).fill(1)];
  assert.equal(h.processor.process([], [output]), false); assert.ok(output[0].every(value => value === 0));
});


test('WASM deserialization failure requests bytes and the same resampler produces audible output', () => {
  const h = harness(true);
  h.processor.port.onmessageerror();
  assert.ok(h.processor.messages.some(message => message.resamplerModuleError));
  for (let i = 0; i < 80; i++) { h.feed(); const output = h.render(); if (i > 5) assert.ok(output[0].some(value => Math.abs(value) > 0.1)); }
  assert.ok(h.processor.messages.some(message => message.playout?.state === 'playing'));
  const failed = new Processor();
  failed.port.onmessage({ data: { resamplerBytes: new Uint8Array([0]).buffer } });
  assert.ok(failed.messages.some(message => message.resamplerError));
  assert.equal(failed.runtime, null);
});
