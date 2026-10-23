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
  function render(blockFrames = 128) {
    globalThis.currentFrame = frame; globalThis.currentTime = frame / 48000;
    // Controls keep observing a running device; a once-at-start anchor would
    // correctly accumulate unbounded projection uncertainty in these long runs.
    const anchor = processor.contextAnchor, rate = processor.deviceClock.rate;
    if (anchor && frame / 48 > 200 * rate) {
      const contextTimeMs = frame / 48 - 200 * rate;
      post({ contextAnchor: { contextTimeMs,
        localTimeMs: anchor.localTimeMs + (contextTimeMs - anchor.contextTimeMs) / rate } });
    }
    const output = [new Float32Array(blockFrames), new Float32Array(blockFrames)];
    processor.process([], [output]); frame += blockFrames; return output;
  }
  return { processor, post, feed, render, base, get frame() { return frame; }, jump(frames) { frame += frames; } };
}

test('production worklet emits sample-count-driven audible content references without enabling debug', () => {
  const h = harness(); h.feed();
  for (let i = 0; i < 100; i++) { h.feed(); const output = h.render(); if (i > 5) assert.ok(output[0].some(value => Math.abs(value) > 0.1)); }
  const refs = h.processor.messages.filter(value => value.playout).map(value => value.playout);
  assert.ok(refs.length >= 6); assert.ok(refs.every(value => value.state === 'playing'));
  assert.ok(refs.every(value => value.renderQuantumFrames === 128));
  assert.equal(h.processor.diagnostics, null);
  assert.equal(h.processor.renderedFrames, 12800);
  for (const reference of refs) {
    assert.ok(Math.abs(reference.sourceTimeMs - (h.base + reference.contextTimeMs + 140)) < 0.1,
      '200ms device path is scheduled early using the audible context mapping, with filter delay inside source content');
    assert.ok(reference.outputUncertaintyMs >= 1 && reference.outputUncertaintyMs < 5.2,
      'feedback reserves the actual native-anchor projection distance');
    assert.ok(reference.filterUncertaintyMs <= 1);
    assert.ok(reference.resampleRatio > 0.99 && reference.resampleRatio < 1.01);
    assert.equal(reference.networkDelayMs, 60);
  }
  h.post({ debug: true }); h.render();
  const stream = h.processor.messages.filter(value => value.diagnostics).at(-1).diagnostics.stream0;
  assert.ok(stream.resampleRatio > 0.99 && stream.resampleRatio < 1.01, 'diagnostics preserve the actual input/output ratio');
  assert.equal(stream.networkDelayMs, 60); assert.equal(stream.delayMs, 60, 'legacy delay telemetry reads the continuous queue target');
});

test('variable real render blocks report their quantum without Debug or changing the Soxr signal', () => {
  const ordinary = harness(), diagnostic = harness();
  const blocks = [...Array(80).fill(64), ...Array(40).fill(128), ...Array(20).fill(256), ...Array(80).fill(64)];
  let renderedFrames = 0;
  for (let index = 0; index < blocks.length; index++) {
    const frames = blocks[index];
    ordinary.feed(); diagnostic.feed();
    if (index % 17 === 0) diagnostic.post({ debug: index % 34 === 0 });
    const output = ordinary.render(frames), compared = diagnostic.render(frames);
    assert.deepEqual(output, compared, 'actual output samples are independent of diagnostics at every block size');
    renderedFrames += frames;
  }
  assert.equal(ordinary.processor.diagnostics, null);
  assert.equal(ordinary.processor.renderedFrames, renderedFrames);
  const refs = ordinary.processor.messages.filter(value => value.playout).map(value => value.playout);
  assert.deepEqual([...new Set(refs.map(value => value.renderQuantumFrames))].sort((a, b) => a - b), [64, 128, 256]);
  assert.ok(refs.every(value => value.state === 'playing'));
  assert.deepEqual(ordinary.processor.timelines.get(0).recoveryCounts, diagnostic.processor.timelines.get(0).recoveryCounts);
});

test('normal feedback retains a larger render block that occurs between feedback intervals and Debug resets', () => {
  const h = harness(); h.feed(); h.render(64);
  h.render(256);
  h.post({ debug: true }); h.post({ debug: false });
  for (let index = 0; index < 40; index++) { h.feed(); h.render(64); }
  const refs = h.processor.messages.filter(value => value.playout).map(value => value.playout);
  assert.ok(refs.length >= 2);
  assert.equal(refs[0].renderQuantumFrames, 64);
  assert.equal(refs[0].renderQuantumMaxFrames, 64);
  assert.equal(refs[1].renderQuantumFrames, 64);
  assert.equal(refs[1].renderQuantumMaxFrames, 256,
    'the context bound must include a larger block even when no feedback was sent for that block');
  assert.equal(h.processor.diagnostics, null);
});

test('1024-frame real render blocks stay finite and continuous while retaining their enlarged mix buffer', () => {
  const ordinary = harness(), diagnostic = harness();
  for (let index = 0; index < 40; index++) {
    ordinary.feed(); diagnostic.feed();
    assert.deepEqual(ordinary.render(), diagnostic.render());
  }
  const timeline = ordinary.processor.timelines.get(0), backend = timeline.backend;
  const initialBlock = timeline.block, initialRecoveries = { ...timeline.recoveryCounts };
  assert.equal(initialBlock.length, 512 * timeline.channels);
  let enlargedBlock;
  for (const [index, frames] of [1024, 1024, 64, 256, 512, 1024, 128, 1024].entries()) {
    ordinary.feed(); diagnostic.feed();
    diagnostic.post({ debug: index % 2 === 0 });
    const output = ordinary.render(frames), compared = diagnostic.render(frames);
    for (const channel of output) {
      assert.ok(channel.every(Number.isFinite), `${frames}-frame output must not read past its mix buffer`);
      if (frames === 1024) {
        assert.ok(channel.subarray(0, 512).some(value => Math.abs(value) > .1));
        assert.ok(channel.subarray(512).some(value => Math.abs(value) > .1), 'Soxr emits the second half of the actual block');
      }
    }
    assert.deepEqual(output, compared, 'Debug toggles preserve every PCM sample in larger blocks');
    if (!enlargedBlock) {
      enlargedBlock = timeline.block;
      assert.notEqual(enlargedBlock, initialBlock);
      assert.equal(enlargedBlock.length, 1024 * timeline.channels);
    } else assert.equal(timeline.block, enlargedBlock, 'unchanged or smaller blocks reuse the existing allocation');
    assert.equal(timeline.backend, backend, 'changing a render block size must preserve the Soxr backend');
    assert.deepEqual(timeline.recoveryCounts, initialRecoveries, 'valid block growth must not manufacture a recovery');
  }
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

test('mirror PCM can acquire its first source anchor without resetting sample progress or independent CarPlay', () => {
  const h = harness(); h.feed();
  const packet = (first, sequence, presentationMs = NaN, decodeTimestampUs = first / 48 * 1000) => h.post({
    type: 6, mode: 'airplay-mirror', epoch: 1, rate: 48000, channels: 1, flags: 0, sequence, generation: 3,
    presentationMs, decodeTimestampUs, pcm: new Int16Array(960).fill(8000).buffer,
  });
  for (let sequence = 0; sequence < 20; sequence++) packet(sequence * 960, sequence);
  for (let quantum = 0; quantum < 30; quantum++) { h.feed(); h.render(); }
  const mirror = h.processor.timelines.get(6), carplay = h.processor.timelines.get(0);
  const carplayBackend = carplay.backend, mirrorBackend = mirror.backend;
  const sourceFrame = mirror.sourceFrame, inputFrame = mirror.inputFrame, sourceAnchor = mirror.sourceAnchorMs;
  assert.equal(mirror.synchronized, false); assert.ok(sourceFrame > 0);
  packet(19200, 20, h.base + 400);
  assert.equal(h.processor.timelines.get(6), mirror); assert.equal(mirror.synchronized, true);
  assert.equal(mirror.backend, mirrorBackend); assert.equal(mirror.sourceFrame, sourceFrame); assert.equal(mirror.inputFrame, inputFrame);
  assert.equal(mirror.queue.at(-1).first, 19200, 'the decoded sample coordinate survives the first NTP anchor');
  assert.ok(Math.abs(mirror.sourceAnchorMs - h.base) < 1e-6); assert.notEqual(mirror.sourceAnchorMs, sourceAnchor);
  let previous = sourceFrame, audible = 0;
  for (let quantum = 0; quantum < 150; quantum++) {
    h.feed();
    if (quantum % 7 === 0) {
      const sequence = 21 + Math.floor(quantum / 7), first = sequence * 960;
      packet(first, sequence, h.base + first / 48 + (sequence % 2 ? .2 : 0));
    }
    h.render(); assert.ok(mirror.sourceFrame >= previous, 'source-anchor acquisition cannot replay emitted PCM'); previous = mirror.sourceFrame;
    if (mirror.state === 'playing') audible++;
    assert.equal(carplay.backend, carplayBackend);
  }
  assert.ok(audible > 50); assert.equal(mirror.sourceDeadlineState, 'within-bound');
  assert.equal(mirror.reference(0).senderTimingState, 'mapped-presentation');
  assert.ok((mirror.recoveryCounts['clock-step'] || 0) <= 1, 'later NTP packet refinements do not become source seeks');
  h.post({ dispose: true });
});

test('mirror source-anchor acquisition keeps unknown sample origins unverified and rejects expired PCM', () => {
  for (const sampleOriginKnown of [false, true]) {
    const h = harness();
    const packet = (first, sequence, presentationMs) => h.post({ type: 6, mode: 'airplay-mirror', epoch: 1,
      rate: 48000, channels: 1, flags: 0, sequence, generation: 3, presentationMs,
      decodeTimestampUs: sampleOriginKnown ? first / 48 * 1000 : NaN, pcm: new Int16Array(960).fill(8000).buffer });
    for (let sequence = 0; sequence < 20; sequence++) packet(sequence * 960, sequence, NaN);
    for (let quantum = 0; quantum < 10; quantum++) h.render();
    const mirror = h.processor.timelines.get(6);
    packet(19200, 20, h.base - 600);
    if (!sampleOriginKnown) {
      assert.equal(mirror.synchronized, false, 'record sequence alone cannot prove an unknown source sample origin');
      h.post({ type: 6, mode: 'airplay-mirror', epoch: 1, rate: 48000, channels: 1, flags: 0,
        sequence: 21, generation: 3, presentationMs: h.base + 420, decodeTimestampUs: 420000,
        pcm: new Int16Array(960).fill(8000).buffer });
      assert.equal(mirror.synchronized, false, 'a later isolated decode timestamp cannot certify the earlier queued sample origin');
    } else {
      assert.equal(mirror.synchronized, true);
      // The old queued samples now have genuine source times more than300ms
      // behind output. They cannot start a backend at the current target.
      const output = h.render();
      assert.equal(mirror.backend, null);
      assert.equal(mirror.sourceDeadlineState, 'unknown'); assert.equal(mirror.sourceDeadlineReason, 'no-output');
      assert.equal(mirror.sourceDeadlineRejectedFrames, 0, 'unemitted old samples are not rejected output quanta');
      assert.ok(output.every(channel => channel.every(value => value === 0)), 'expired PCM and pre-anchor fade copies stay silent');
      assert.ok(mirror.last.every(value => value === 0));
      const sourceFrame = mirror.sourceFrame;
      for (let quantum = 0; quantum < 20; quantum++) h.render();
      assert.equal(mirror.sourceFrame, sourceFrame, 'queued expired samples cannot replay while idle');
      assert.equal(mirror.sourceDeadlineRejectedFrames, 0);
    }
    h.post({ dispose: true });
  }
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
  const admittedDelay = 300 - 30 - 1 - 1 - 128 / 48 * (1 / .98 - 1);
  assert.ok(Math.abs(player.networkDelayMs - admittedDelay) < 1e-12,
    'startup reserves the recovery window, measured output/filter uncertainty and a full render-block projection');
  assert.equal(player.sourceDeadlineState, 'within-bound'); assert.ok(player.sourceDeltaUpperMs <= 300);
  h.post({ plans: { video: constantDelay(0), audio: constantDelay(280) } });
  for (let quantum = 0; quantum < 100; quantum++) { h.feed(); h.render(); }
  assert.equal(player.backend, backend); assert.deepEqual(player.recoveryCounts, recoveries);
  assert.equal(player.networkDelayMs, admittedDelay); assert.equal(player.sourceDeadlineRejectedFrames, 0);
  h.post({ clock: { version: 2, generation: 1, serverOriginMs: h.base, localOriginMs: 0, rate: 1, state: 'locked' } });
  for (let quantum = 0; quantum < 20; quantum++) { h.feed(); h.render(); }
  assert.equal(player.sourceDeadlineState, 'unknown');
  assert.equal(player.sourceDeadlineReason, 'clock-uncertainty-unavailable');
  assert.equal(h.processor.messages.filter(value => value.playout).at(-1).playout.state, 'untimed');
});

test('actual worklet reports the rejected source-deadline trigger after healthy output resumes', () => {
  const h = harness();
  try {
    h.post({ debug: true, plans: { video: constantDelay(40), audio: constantDelay(280) } });
    for (let quantum = 0; quantum < 100; quantum++) { h.feed(6, 'airplay-mirror'); h.render(); }
    const player = h.processor.timelines.get(6);
    assert.ok(player.networkDelayMs < 268 && player.networkDelayMs > 267.9);
    assert.equal(player.sourceDeadlineState, 'within-bound');
    // A sub-recovery phase refinement followed by less than the network-buffer
    // update threshold can exhaust the separately checked source-age reserve.
    h.post({ contextAnchor: { contextTimeMs: 0, localTimeMs: 226 }, outputUncertaintyMs: 8 });
    h.feed(6, 'airplay-mirror'); h.render();
    assert.equal(player.recoveryCounts['source-deadline'], 1);
    const triggerUpper = player.sourceDeltaUpperMs;
    assert.ok(triggerUpper > 300 && triggerUpper < 310,
      'the source bound includes the additional native-anchor projection reserve');
    for (let quantum = 0; quantum < 20; quantum++) { h.feed(6, 'airplay-mirror'); h.render(); }
    assert.equal(player.sourceDeadlineState, 'within-bound');
    h.processor.report();
    const report = h.processor.messages.filter(value => value.diagnostics).at(-1).diagnostics.stream6;
    assert.equal(report.lastSourceDeadlineDeltaUpperMs, triggerUpper);
    assert.ok(report.lastSourceDeadlineUncertaintyMs > 9 && report.lastSourceDeadlineUncertaintyMs < 15,
      'the rejected trigger includes measured uncertainty and the actual native-anchor projection');
    assert.equal(report.lastSourceDeadlineLimitMs, 300);
    assert.ok(report.lastSourceDeadlineAgeMs > 50 && report.lastSourceDeadlineAgeMs < 60);
    assert.equal(report.mode, 'airplay-mirror'); assert.equal(report.epoch, 1); assert.equal(report.generation, 3);
    assert.ok(h.processor.messages.filter(value => value.playout).every(value =>
      !Object.keys(value.playout).some(key => key.startsWith('lastSourceDeadline'))),
    'the added Debug evidence does not expand normal playout feedback');
  } finally { h.post({ dispose: true }); }
});

function voiceSignalScenario({ deliveryStep = 0, strict = false, plan = 60,
  expireAt = null, generationAt = null, repeatedGeneration = false,
  oldClockThenFresh = false, unknownThenKnown = false, onePacket = false, sourceGap = false,
  durationQuanta = 600, blockFrames = 128, latePlan = null, highUncertaintyFromMs = Infinity } = {}) {
  const h = harness(), p = h.processor;
  let sourceFrame = 0, sequence = 0, oldCursor = null, previousPilot = null, planChanged = false;
  let observed = null, previousUnderruns = 0, expiredBounds = [];
  const allUnderrunQuanta = [], cursors = [], sourceReads = [];
  let nonfinite = 0, backwards = 0, pilotReplay = 0, expiredLeak = 0, unknownClaimedBound = 0;
  let firstOutputMs = null, outputAfterOneSecond = 0, firstOutputAfterClockRestoreMs = null;
  let firstSourceOffsetMs = null;
  h.post({ plans: { audio: constantDelay(plan), video: constantDelay(0) } });
  function supply(wall, quantum) {
    if (deliveryStep && quantum >= 40 && quantum < 60) return;
    const edge = wall - (deliveryStep && quantum >= 60 ? deliveryStep : 0);
    while ((!onePacket || !sequence) && (strict ? (sourceFrame + 960) / 48 <= edge : sourceFrame / 48 < edge + 20)) {
      if (sourceGap && sourceFrame === 4800) { sourceFrame += 960; continue; }
      const first = sourceFrame, pcm = new Int16Array(1920);
      for (let i = 0; i < 960; i++) {
        pcm[i * 2] = Math.round(32767 * (.35 + .05 * Math.sin((first + i) * 2 * Math.PI * 73 / 48000)));
        // One PCM code per source ms. Once its gain is flat, the tag identifies
        // sample progress to within quantization/filter error without rawCursor.
        pcm[i * 2 + 1] = 6000 + Math.round((first + i) / 48);
      }
      sourceReads.push({ first, end: first + 960 });
      h.post({ type: 1, semanticType: 1, mode: 'carplay', epoch: 1, rate: 48000,
        channels: 2, flags: 0, sequence: sequence++, generation: 3,
        presentationMs: h.base + first / 48, arrivalLocalTimeMs: wall, pcm: pcm.buffer });
      sourceFrame += 960;
    }
  }
  function bind(timeline) {
    const bound = timeline.boundDeadline, read = timeline.read;
    timeline.boundDeadline = function(deadline, clock, sourceMs, localSpan, sourceSpan) {
      if (deadline && !deadline.unknownReason && clock && Number.isFinite(sourceMs)) {
        const projection = Math.max(Math.abs(deadline.projectionContextMs ?? 0),
          Math.abs((deadline.projectionContextMs ?? 0) + localSpan * (deadline.projectionRate ?? 1)));
        const applied = deadline.projectionRate ?? 1;
        const projectionU = projection * Math.max(Math.abs(1 / applied - 1 / .98), Math.abs(1 / applied - 1 / 1.02));
        const mapped = clock.localOriginMs + (sourceMs - clock.serverOriginMs) * clock.rate;
        expiredBounds.push({ upper: deadline.outputAt - mapped + Math.max(0, localSpan - sourceSpan)
          + deadline.uncertaintyMs + projectionU, sourceMs });
      }
      return bound.call(this, deadline, clock, sourceMs, localSpan, sourceSpan);
    };
    timeline.read = function(frame, count) {
      const copied = read.call(this, frame, count);
      let covered = frame;
      for (const source of sourceReads) {
        if (source.end <= covered) continue;
        if (source.first > covered) break;
        covered = Math.min(frame + copied, source.end);
        if (covered >= frame + copied) break;
      }
      assert.ok(!copied || covered >= frame + copied, 'Soxr may read only PCM actually delivered to this epoch');
      return copied;
    };
  }
  try {
    for (let quantum = 0; quantum < durationQuanta; quantum++) {
      const wall = h.frame / 48;
      supply(wall, quantum);
      if (latePlan !== null && wall >= 500 && !planChanged) {
        h.post({ plans: { audio: constantDelay(latePlan), video: constantDelay(0) } });
        planChanged = true;
      }
      const timeline = p.timelines.get(1);
      if (timeline && timeline !== observed) { bind(timeline); observed = timeline; }
      const generation = repeatedGeneration ? 1 + (wall >= 500 ? 1 : 0) + (wall >= 700 ? 1 : 0)
        : generationAt !== null && quantum >= generationAt ? 2 : 1;
      const origin = oldClockThenFresh && wall >= 500 && wall < 700 ? -400 : 0;
      const unknown = unknownThenKnown && wall >= 500 && wall < 700;
      h.post({ clock: { version: 2, generation, serverOriginMs: h.base, localOriginMs: origin,
        rate: 1, state: 'locked', uncertaintyMs: 0 },
        contextAnchor: unknown ? null : { contextTimeMs: wall - 200, localTimeMs: wall },
        outputUncertaintyMs: unknown ? null : quantum === expireAt || wall >= highUncertaintyFromMs ? 80 : 1 });
      expiredBounds = [];
      const output = h.render(blockFrames), current = p.timelines.get(1), nonzero = output.some(c => c.some(x => x !== 0));
      if (nonzero && firstOutputMs === null) {
        firstOutputMs = wall;
        firstSourceOffsetMs = expiredBounds.length ? Math.min(...expiredBounds.map(x => x.sourceMs)) - h.base : null;
      }
      if (wall >= 1000 && nonzero) outputAfterOneSecond++;
      if (wall >= 700 && nonzero) firstOutputAfterClockRestoreMs ??= wall;
      for (const channel of output) for (const value of channel) if (!Number.isFinite(value)) nonfinite++;
      if (expiredBounds.some(x => x.upper > 300 + 1e-7) && nonzero) expiredLeak++;
      if (unknown && nonzero && current?.sourceDeadlineState !== 'unknown') unknownClaimedBound++;
      if (current && Number.isFinite(current.rawCursorMs)) {
        if (oldCursor !== null && current.rawCursorMs < oldCursor - 1e-7) backwards++;
        oldCursor = current.rawCursorMs; cursors.push(current.rawCursorMs);
      }
      // Detect a flat-gain pilot directly from samples, rather than assuming a
      // particular implementation of retained priming or a private gain field.
      const right = output[1]; let pilotStep = 0;
      for (let i = 1; i < right.length; i++) pilotStep = Math.max(pilotStep, Math.abs(right[i] - right[i - 1]));
      if (right.every(x => x > .1) && pilotStep < 4 / 32768) {
        const pilot = right.reduce((sum, x) => sum + x, 0) / right.length;
        if (previousPilot !== null && pilot < previousPilot - 2 / 32768) pilotReplay++;
        previousPilot = pilot;
      }
      const underruns = current?.recoveryCounts.underrun ?? 0;
      // This counter locates a perturbation in a separate control run only.
      // Passing conditions below use actual PCM, deadlines and source progress.
      if (underruns > previousUnderruns) allUnderrunQuanta.push(quantum);
      previousUnderruns = underruns;
    }
    const current = p.timelines.get(1);
    return { nonfinite, backwards, pilotReplay, expiredLeak, unknownClaimedBound,
      firstOutputMs, firstSourceOffsetMs, outputAfterOneSecond, firstOutputAfterClockRestoreMs,
      allUnderrunQuanta, state: current?.state, reason: current?.reason, cursors };
  } finally { h.post({ dispose: true }); }
}

function assertVoiceSignalIntegrity(result) {
  assert.equal(result.nonfinite, 0);
  assert.equal(result.backwards, 0, 'an emitted source cursor cannot replay');
  assert.equal(result.pilotReplay, 0, 'the independently tagged source waveform cannot replay after a fade');
  assert.equal(result.expiredLeak, 0, 'external source-age bounds reject expired PCM and held tails');
  assert.equal(result.unknownClaimedBound, 0, 'unknown output mapping must not claim a verified source deadline');
}

test('voice recovery preserves the historical 50ms delivery contract and rejects a permanent 160ms sender delay', () => {
  for (const deliveryStep of [50, 160]) {
    const result = voiceSignalScenario({ deliveryStep });
    assertVoiceSignalIntegrity(result);
    if (deliveryStep === 50) {
      assert.equal(result.state, 'playing');
      assert.ok(result.outputAfterOneSecond > 200, 'new available source PCM must resume actual speech output');
    } else {
      assert.equal(result.state, 'infeasible');
      assert.equal(result.outputAfterOneSecond, 0, '200ms output lead plus 160ms source delay cannot meet the 300ms bound');
    }
  }
});

test('voice can re-prime from complete newly delivered packets after a genuine 50ms delivery step', () => {
  const result = voiceSignalScenario({ deliveryStep: 50, strict: true });
  assertVoiceSignalIntegrity(result);
  assert.equal(result.state, 'playing');
  assert.ok(result.outputAfterOneSecond > 200, 'this producer never supplies a packet before its source end');
});

test('source-fit generation changes and a deadline rejection on the final underflow cannot latch voice recovery', () => {
  const control = voiceSignalScenario({ deliveryStep: 50 });
  const quantum = control.allUnderrunQuanta.at(-1);
  assert.ok(Number.isInteger(quantum), 'fixture must exercise a genuine interrupted source stream');
  const combined = voiceSignalScenario({ deliveryStep: 50, expireAt: quantum, generationAt: quantum });
  const refits = voiceSignalScenario({ repeatedGeneration: true, strict: true });
  for (const result of [combined, refits]) {
    assertVoiceSignalIntegrity(result);
    assert.equal(result.state, 'playing');
    assert.ok(result.outputAfterOneSecond > 200, 'source-fit metadata must not prevent fresh PCM from playing');
  }
});

test('expired voice source mapping can become feasible again when the clock and fresh packets recover', () => {
  const result = voiceSignalScenario({ oldClockThenFresh: true, strict: true });
  assertVoiceSignalIntegrity(result);
  assert.equal(result.state, 'playing');
  assert.ok(result.firstOutputAfterClockRestoreMs !== null && result.firstOutputAfterClockRestoreMs <= 1000,
    'a restored feasible source interval must resume within the existing 300ms audio window');
  assert.ok(result.outputAfterOneSecond > 200);
});

test('unknown voice output mapping remains unverified and recovers with the real output anchor', () => {
  const result = voiceSignalScenario({ unknownThenKnown: true, strict: true });
  assertVoiceSignalIntegrity(result);
  assert.equal(result.state, 'playing');
  assert.ok(result.outputAfterOneSecond > 200);
});

test('one complete 20ms first utterance can start without awaiting an unavailable second packet', () => {
  const result = voiceSignalScenario({ onePacket: true, strict: true, durationQuanta: 200 });
  assertVoiceSignalIntegrity(result);
  assert.ok(result.firstOutputMs !== null && result.firstOutputMs <= 20 + 20 + 2 * 128 / 48,
    'one complete packet plus the existing wall-clock startup gate is sufficient');
  assert.ok(result.firstSourceOffsetMs !== null && result.firstSourceOffsetMs < 2 * 128 / 48,
    'starting a short utterance must preserve its first source samples to render-quantum precision');
});

test('voice recovery selects a later contiguous source run after a genuine PCM hole', () => {
  const result = voiceSignalScenario({ sourceGap: true, strict: true });
  assertVoiceSignalIntegrity(result);
  assert.equal(result.state, 'playing');
  assert.ok(result.outputAfterOneSecond > 200, 'an unfillable earlier source hole must not block later delivered speech');
});

test('a finite voice packet can emit real partial PCM in a larger render quantum', () => {
  const result = voiceSignalScenario({ onePacket: true, strict: true, blockFrames: 1024, durationQuanta: 15 });
  assertVoiceSignalIntegrity(result);
  assert.ok(result.firstOutputMs !== null && result.firstOutputMs <= 20 + 20 + 2 * 1024 / 48,
    'the hardware quantum must not silence a short utterance with real available Soxr output');
  assert.ok(result.firstSourceOffsetMs !== null && result.firstSourceOffsetMs < 2 * 128 / 48,
    'a partial first quantum still preserves the beginning of the utterance');
});

test('the first real guidance anchor preserves an already audible arrival-based filter', () => {
  const h = harness();
  h.post({ contextAnchor: { contextTimeMs: 0, localTimeMs: 188 } });
  const packet = (sequence, presentationMs) => ({ type: 255, semanticType: 1, mode: 'carplay', epoch: 1,
    rate: 48000, channels: 1, flags: 0, sequence, generation: 3,
    ...(presentationMs === undefined ? {} : { presentationMs }), arrivalLocalTimeMs: h.frame / 48,
    pcm: Int16Array.from({ length: 960 }, (_, i) => Math.round(10000 * Math.sin((sequence * 960 + i) * 2 * Math.PI * 997 / 48000))).buffer });
  for (let sequence = 0; sequence < 20; sequence++) h.post(packet(sequence));
  for (let quantum = 0; quantum < 50; quantum++) h.render();
  const timeline = h.processor.timelines.get(255), backend = timeline.backend;
  assert.ok(backend && timeline.arrivalPlayback && timeline.hasEmitted);
  const recoveries = { ...timeline.recoveryCounts };
  h.post(packet(20, h.base + 400));
  const cursor = timeline.rawCursorMs;
  for (let quantum = 0; quantum < 20; quantum++) {
    const output = h.render();
    assert.ok(timeline.backend === backend, 'learning a real anchor preserves the same live Soxr signal');
    assert.ok(output[0].some(value => Math.abs(value) > .1));
    assert.ok(timeline.rawCursorMs >= cursor);
  }
  assert.equal(timeline.arrivalPlayback, false); assert.equal(timeline.synchronized, true);
  assert.deepEqual(timeline.recoveryCounts, recoveries);
  assert.equal(timeline.sourceDeadlineState, 'within-bound');
  h.post({ dispose: true });
});

test('the reachable 280ms audio plan remains a soft target during first voice admission', () => {
  const result = voiceSignalScenario({ plan: 280 });
  assertVoiceSignalIntegrity(result);
  assert.ok(result.firstOutputMs !== null, 'the media readiness ceiling must not contradict the first voice admission window');
  assert.ok(result.outputAfterOneSecond > 200);
  assert.equal(result.state, 'playing');
});

test('a higher audio plan can recover already audible voice within its actual source budget', () => {
  const result = voiceSignalScenario({ latePlan: 280, repeatedGeneration: true });
  assertVoiceSignalIntegrity(result);
  assert.ok(result.outputAfterOneSecond > 200);
  assert.equal(result.state, 'playing');
});

test('a soft audio target cannot prevent legal voice recovery under higher output uncertainty', () => {
  const result = voiceSignalScenario({ latePlan: 280, highUncertaintyFromMs: 500 });
  assertVoiceSignalIntegrity(result);
  assert.ok(result.outputAfterOneSecond > 200, 'complete fresh packets remain playable inside the full 300ms uncertainty bound');
  assert.equal(result.state, 'playing');
});
