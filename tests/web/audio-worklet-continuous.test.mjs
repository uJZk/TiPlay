// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { constantDelay } from '../../site/play/delay-plan.js';
import { createAudioReferenceTimeline } from '../../site/play/audio-output-clock.js';
import { createAirPlayAudioDecoder } from '../../site/play/airplay-audio-decoder.js';
import { SoxrRuntime } from '../../site/play/streaming-resampler.js';
const calibration = { rate: 48000, outputRate: 48000, delayMs: new SoxrRuntime().filterDelay(48000, 48000) };

let Processor;
globalThis.AudioWorkletProcessor = class { constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(value) }; } };
globalThis.registerProcessor = (_, value) => { Processor = value; };
globalThis.sampleRate = 48000;
globalThis.currentTime = 0; globalThis.currentFrame = 0;
await import('../../site/play/audio-worklet.js');

function harness() {
  globalThis.currentTime = 0; globalThis.currentFrame = 0;
  const processor = new Processor(), base = 8000000;
  const post = data => processor.port.onmessage({ data });
  post({ calibration });
  post({ clock: { version: 2, generation: 1, serverOriginMs: base, localOriginMs: 0, rate: 1, state: 'locked', uncertaintyMs: 0 },
    contextAnchor: { contextTimeMs: 0, localTimeMs: 200 }, localTimeOriginMs: 1792159881000,
    outputUncertaintyMs: 1, plans: { audio: constantDelay(60), video: constantDelay(0) } });
  let frame = 0;
  const cursors = new Map();
  function feed(type = 0, mode = 'carplay', epoch = 1, untilMs = frame / 48 + 400, gapMs = 0, semanticType = type) {
    const key = `${type}:${epoch}`, cursor = cursors.get(key) || { frame: 0, sequence: 0 };
    while (cursor.frame < untilMs * 48) {
      const pcm = Int16Array.from({ length: 960 }, (_, i) => Math.round(10000 * Math.sin((cursor.frame + i) * 2 * Math.PI * 997 / 48000)));
      post({ type, semanticType, mode, epoch, rate: 48000, channels: 1, flags: 0, sequence: cursor.sequence++, generation: 3,
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

test('restarting the output timestamp fit preserves a continuous device sample counter and live filter', () => {
  const h = harness(); h.post({ deviceClock: { generation: 10, rate: 1 } }); h.feed();
  for (let i = 0; i < 30; i++) h.render();
  const player = h.processor.timelines.get(0), backend = player.backend;
  const cursor = player.rawCursorMs;
  // A rejected/backward native timestamp restarts only its measurement fit.
  // AudioContext suspend and actual render-counter jumps have separate signals.
  h.post({ deviceClock: { generation: 11, rate: 1 } });
  for (let i = 0; i < 30; i++) { h.feed(); h.render(); }
  assert.equal(player.backend, backend, 'measurement generations do not interrupt the emitted signal');
  assert.equal(player.recoveryCounts['device-clock-reset'], undefined);
  assert.ok(player.rawCursorMs > cursor);
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

test('zero-lead guidance starts with a delayed output device and never becomes the screen clock', () => {
  for (const semanticType of [1, 2, 3, 4]) for (const leadMs of [0, 75]) {
    const h = harness();
    h.post({ contextAnchor: { contextTimeMs: 0, localTimeMs: 188 } });
    let nonzero = 0;
    for (let quantum = 0; quantum < 400; quantum++) {
      h.feed(255, 'carplay', 1, h.frame / 48 + 20, leadMs, semanticType);
      const output = h.render();
      if (output[0].some(value => Math.abs(value) > 0.01)) nonzero++;
    }
    const player = h.processor.timelines.get(255);
    assert.ok(nonzero > 385, 'navigation, telephone and Siri PCM play after one short startup buffer');
    assert.equal(player.state, 'playing'); assert.deepEqual(player.recoveryCounts, {});
    const reference = h.processor.messages.filter(value => value.playout?.type === 255).at(-1).playout;
    assert.equal(reference.anchoring, 'presentation'); assert.equal(reference.semanticType, semanticType);
    assert.equal(reference.senderRelativePolicyCeilingMs, 300);
    assert.ok(reference.sourceStartupDelayMs <= 300);
    const references = createAudioReferenceTimeline(); references.update({ ...reference, at: 1000, audibleTimeMs: 1188 });
    assert.equal(references.resolve('carplay', h.base + h.frame / 48, 1, 1000).state, 'audio-output');
    // A browser route returning after SCO gets a new epoch and the same short start.
    h.post({ type: 255, semanticType, mode: 'carplay', epoch: 2, generation: 3, flags: 2, ended: true, pcm: new ArrayBuffer(0) });
    const start = h.frame / 48;
    const pcm = Int16Array.from({ length: 4800 }, () => 8000);
    h.post({ type: 255, semanticType, mode: 'carplay', epoch: 3, generation: 3, flags: 0,
      rate: 48000, channels: 1, sequence: 0, presentationMs: h.base + start, pcm: pcm.buffer });
    let resumed = false;
    for (let quantum = 0; quantum < 25; quantum++) if (h.render()[0].some(value => value > 0.1)) resumed = true;
    assert.equal(resumed, true);
    h.post({ dispose: true });
  }
});

test('same-purpose streams mix independently and ending one preserves the other and media references', () => {
  for (const semanticType of [0, 1]) {
    const h = harness(), control = harness();
    h.feed(semanticType, 'carplay', 1, 400, 0, semanticType);
    h.feed(255, 'carplay', 1, 400, 0, semanticType);
    control.feed(semanticType, 'carplay', 1, 400, 0, semanticType);
    for (let quantum = 0; quantum < 30; quantum++) {
      const a = h.render()[0], b = control.render()[0];
      if (quantum > 15) for (let i = 0; i < 128; i++) assert.ok(Math.abs(a[i] - 2 * b[i]) < 1e-6, 'both streams contribute samples');
    }
    const remaining = h.processor.timelines.get(semanticType), backend = remaining.backend;
    const references = createAudioReferenceTimeline();
    for (const value of h.processor.messages) if (value.playout) references.update({ ...value.playout, at: 1000, audibleTimeMs: 1100 });
    h.post({ type: 255, semanticType, mode: 'carplay', epoch: 2, flags: 2, generation: 3, ended: true, pcm: new ArrayBuffer(0) });
    const ending = h.processor.messages.filter(value => value.playout?.type === 255).at(-1).playout;
    references.update({ ...ending, at: 1001 });
    assert.equal(h.processor.timelines.has(255), false); assert.equal(remaining.backend, backend);
    if (semanticType === 0) {
      const resolved = references.resolve('carplay', remaining.rawCursorMs, 1, 1001);
      assert.equal(resolved.state, 'audio-output'); assert.equal(resolved.reference.type, 0);
    }
    for (let quantum = 0; quantum < 10; quantum++) {
      const a = h.render()[0], b = control.render()[0];
      if (quantum > 3) for (let i = 0; i < 128; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-6);
    }
    h.post({ dispose: true }); control.post({ dispose: true });
  }
});

test('source-timed navigation leaves the active media clock and resampler unchanged', () => {
  const h = harness(); h.feed();
  for (let i = 0; i < 20; i++) h.render();
  const media = h.processor.timelines.get(0), backend = media.backend, before = media.rawCursorMs;
  h.feed(255, 'carplay', 1, 400, 0, 1);
  for (let i = 0; i < 30; i++) h.render();
  assert.equal(media.backend, backend); assert.deepEqual(media.recoveryCounts, {});
  assert.ok(Math.abs(media.rawCursorMs - before - 30 * 128 / 48) < 0.1);
  const references = createAudioReferenceTimeline();
  for (const value of h.processor.messages) if (value.playout) references.update({ ...value.playout, at: 1000, audibleTimeMs: 1100 });
  assert.equal(references.resolve('carplay', media.rawCursorMs, 1, 1000).reference.type, 0);
  h.post({ dispose: true });
});

test('guidance recovers a delivery step within 300ms and reports an impossible sender deadline without replay', () => {
  for (const deliveryStep of [50, 160]) {
    const h = harness(); let player, previous = -Infinity, resumed = 0;
    for (let quantum = 0; quantum < 300; quantum++) {
      if (quantum < 40 || quantum >= 60) h.feed(1, 'carplay', 1, h.frame / 48 + 20 - (quantum >= 60 ? deliveryStep : 0));
      const output = h.render(); player = h.processor.timelines.get(1);
      if (Number.isFinite(player.rawCursorMs)) { assert.ok(player.rawCursorMs >= previous); previous = player.rawCursorMs; }
      if (quantum > 150 && output[0].some(value => Math.abs(value) > 0.01)) resumed++;
    }
    if (deliveryStep === 50) {
      assert.ok(resumed > 140, JSON.stringify({ resumed, state: player.state, reason: player.reason, delay: player.sourceStartupDelayMs, recovery: player.recoveryCounts, head: player.queue[0]?.first, tail: player.queue.at(-1)?.end, sourceFrame: player.sourceFrame, raw: player.rawCursorMs })); assert.equal(player.state, 'playing');
      assert.ok(player.sourceStartupDelayMs <= 300);
    } else {
      assert.equal(player.state, 'infeasible'); assert.equal(player.reason, 'sender-deadline');
      assert.ok(player.senderCeilingViolations > 0); assert.equal(resumed, 0);
    }
    assert.ok(player.recoveryCounts.underrun > 0); h.post({ dispose: true });
  }
});

test('output rate calibration keeps strict media and arrival guidance on independent continuous anchors', () => {
  const h = harness(), deviceRate = 0.996;
  h.post({ deviceClock: { rate: deviceRate, generation: 1 }, contextAnchor: { contextTimeMs: 0, localTimeMs: 188 } });
  let voiceBlocks = 0;
  for (let quantum = 0; quantum < 12000; quantum++) {
    const physicalMs = h.frame / 48 / deviceRate;
    h.feed(0, 'carplay', 1, physicalMs + 400);
    h.feed(255, 'carplay', 1, physicalMs + 20, 0, 1);
    const output = h.render();
    if (quantum > 10 && output[0].some(value => Math.abs(value) > 0.1)) voiceBlocks++;
  }
  const media = h.processor.timelines.get(0), voice = h.processor.timelines.get(255);
  assert.ok(voiceBlocks > 11970);
  assert.deepEqual(media.recoveryCounts, {}); assert.deepEqual(voice.recoveryCounts, {});
  assert.ok(Math.abs(media.phaseErrorMs) < 0.1); assert.ok(Math.abs(voice.phaseErrorMs) < 0.1);
  assert.equal(h.processor.clock.rate, 1);
  const voiceTime = h.processor.arrivalTime(h.frame / 48), backend = voice.backend;
  h.post({ deviceClock: { rate: 0.99601, generation: 1 } });
  assert.ok(Math.abs(h.processor.arrivalTime(h.frame / 48) - voiceTime) < 0.001, 'a fit refinement cannot jump the guidance clock');
  h.render(); assert.equal(voice.backend, backend);
  h.post({ deviceClock: { rate: 1, generation: 2 } });
  assert.deepEqual(media.recoveryCounts, {}, 'restarting a measurement fit preserves the media signal');
  assert.equal(voice.backend, backend, 'measurement restarts also preserve guidance');
  h.jump(1200); h.render();
  assert.equal(media.recoveryCounts['device-clock-jump'], 1, 'a genuine render-counter discontinuity still resets the signal');
  assert.equal(voice.recoveryCounts['device-clock-jump'], 1);
  h.post({ dispose: true });
});

test('independent audio deadline reserves uncertainty and video-only touch plans leave the filter unchanged', () => {
  const h = harness(); h.feed();
  h.post({ plans: { video: constantDelay(180), audio: constantDelay(280) } });
  for (let quantum = 0; quantum < 100; quantum++) { h.feed(); h.render(); }
  const player = h.processor.timelines.get(0), backend = player.backend, recoveries = { ...player.recoveryCounts };
  assert.equal(player.networkDelayMs, 268, '300ms includes the 30ms phase budget plus 1ms output and 1ms filter uncertainty');
  assert.equal(player.sourceDeadlineState, 'within-bound'); assert.ok(player.sourceDeltaUpperMs <= 300);
  h.post({ plans: { video: constantDelay(0), audio: constantDelay(280) } });
  for (let quantum = 0; quantum < 100; quantum++) { h.feed(); h.render(); }
  assert.equal(player.backend, backend); assert.deepEqual(player.recoveryCounts, recoveries);
  assert.equal(player.networkDelayMs, 268); assert.equal(player.sourceDeadlineRejectedFrames, 0);
  h.post({ clock: { version: 2, generation: 1, serverOriginMs: h.base, localOriginMs: 0, rate: 1, state: 'locked' } });
  for (let quantum = 0; quantum < 20; quantum++) { h.feed(); h.render(); }
  assert.equal(player.sourceDeadlineState, 'unknown');
  assert.equal(player.sourceDeadlineReason, 'clock-uncertainty-unavailable');
  assert.equal(h.processor.messages.filter(value => value.playout).at(-1).playout.state, 'untimed');
});
