// SPDX-License-Identifier: GPL-3.0-only
// The WebCodecs pipeline of video.js against a scripted VideoDecoder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAG, RECORD, encodeRecord } from '../../site/play/link.js';
import { createDecoderPipeline, createFramePresenter } from '../../site/play/video.js';
import { createTimedFrames } from '../../site/play/media-timing.js';

const settle = () => new Promise(resolve => setImmediate(resolve));

class FakeDecoder {
  static instances = [];
  static gate = null;

  static isConfigSupported(config) {
    return (FakeDecoder.gate ?? Promise.resolve()).then(() => ({ supported: true, config }));
  }

  constructor({ output }) {
    this.output = output;
    this.state = 'unconfigured';
    this.decodeQueueSize = 0;
    this.chunks = [];
    FakeDecoder.instances.push(this);
  }

  configure() { this.state = 'configured'; }
  decode(chunk) { this.chunks.push(chunk); }
  close() { this.state = 'closed'; }
  reset() { this.state = 'unconfigured'; this.decodeQueueSize = 0; this.resets = (this.resets || 0) + 1; }
}

const config = (epoch, mode = 'carplay') => encodeRecord({
  kind: RECORD.CONFIG, codec: 1, epoch, payload: new TextEncoder().encode(JSON.stringify({ mode, codec: 'avc1.640028', width: 1182, height: 920, fps: 60 })),
});
const keyFrame = epoch => encodeRecord({ kind: RECORD.FRAME, flags: FLAG.KEY, codec: 1, epoch, payload: Uint8Array.of(0, 0, 0, 1, 0x65) });
const videoFrame = timestamp => ({ timestamp, closed: false, close() { this.closed = true; } });

function recordingPresenter(t, messages, presented) {
  const canvas = { width: 800, height: 480, removeEventListener() {},
    getContext: type => type === '2d' ? { fillRect() {}, drawImage() {} } : null };
  const presenter = createFramePresenter(canvas, {
    onFirstPresent: config => messages.push({ type: 'decoded', id: config.streamId, epoch: config.epoch }),
  });
  t.after(() => presenter.dispose());
  return (frame, config, id, timing, window) => {
    presented.push(frame); presenter.present(frame, config, timing, window);
  };
}

test('AirPlay mirror rejects decoded PQ/HLG frames before presentation and preserves CarPlay compatibility', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  globalThis.VideoDecoder = FakeDecoder;
  globalThis.EncodedVideoChunk = class { constructor(init) { Object.assign(this, init); } };
  FakeDecoder.instances = []; FakeDecoder.gate = null;
  t.after(() => { delete globalThis.VideoDecoder; delete globalThis.EncodedVideoChunk; FakeDecoder.instances = []; FakeDecoder.gate = null; });
  const messages = [], presented = [], pipeline = createDecoderPipeline({ post: message => messages.push(message), present: recordingPresenter(t, messages, presented) });
  t.after(() => pipeline.stop());
  let controller;
  pipeline.read(15, new ReadableStream({ start(value) { controller = value; } }));
  for (const [epoch, transfer] of [[1, 'pq'], [2, 'hlg']]) {
    controller.enqueue(config(epoch, 'airplay-mirror')); controller.enqueue(keyFrame(epoch)); await settle();
    const decoder = FakeDecoder.instances.at(-1), frame = { ...videoFrame(0), colorSpace: { transfer, primaries: 'bt2020' } };
    decoder.output(frame);
    assert.equal(frame.closed, true); assert.equal(decoder.state, 'closed'); assert.equal(pipeline.stats().codecSupported, false);
    assert.equal(presented.length, 0); assert.equal(messages.at(-1).reason, 'hdr'); assert.match(messages.at(-1).detail, /SDR/);
    const late = videoFrame(1); decoder.output(late); assert.equal(late.closed, true);
  }
  controller.enqueue(config(3, 'airplay-mirror')); controller.enqueue(keyFrame(3)); await settle();
  const sdr = { ...videoFrame(0), colorSpace: { transfer: 'bt709' } }; FakeDecoder.instances.at(-1).output(sdr);
  assert.equal(presented[0], sdr); assert.equal(sdr.closed, false);
  controller.enqueue(config(4, 'carplay')); controller.enqueue(keyFrame(4)); await settle();
  const retained = { ...videoFrame(0), colorSpace: { transfer: 'pq' } }; FakeDecoder.instances.at(-1).output(retained);
  assert.equal(presented[1], retained); assert.equal(retained.closed, false);
  assert.equal(messages.filter(message => message.type === 'unsupported').length, 2);
});

test('late output of the previous decoder is not drawn or reported as the new epoch', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  globalThis.VideoDecoder = FakeDecoder;
  globalThis.EncodedVideoChunk = class { constructor(init) { Object.assign(this, init); } };
  t.after(() => { delete globalThis.VideoDecoder; delete globalThis.EncodedVideoChunk; });

  const messages = [], presented = [];
  const pipeline = createDecoderPipeline({ post: message => messages.push(message), present: recordingPresenter(t, messages, presented) });
  let controller;
  pipeline.read(1, new ReadableStream({ start(c) { controller = c; } }));
  const decoded = () => messages.filter(message => message.type === 'decoded').map(message => message.epoch);

  controller.enqueue(config(1));
  controller.enqueue(keyFrame(1));
  await settle();
  const [first] = FakeDecoder.instances;
  assert.equal(first.chunks.length, 1);
  first.output(videoFrame(0));
  assert.deepEqual(decoded(), [1]);

  // The phone changes the configuration while the old decoder still holds a frame.
  let open;
  FakeDecoder.gate = new Promise(resolve => { open = resolve; });
  controller.enqueue(config(2));
  await settle();
  const late = videoFrame(16666);
  if (first.state !== 'closed') first.output(late);
  assert.deepEqual(decoded(), [1], 'a frame of epoch 1 is no proof that epoch 2 renders');
  assert.equal(presented.includes(late), false);

  FakeDecoder.gate = null;
  open();
  await settle();
  controller.enqueue(keyFrame(2));
  await settle();
  const second = FakeDecoder.instances.at(-1);
  assert.notEqual(second, first);
  assert.equal(second.chunks.length, 1);
  second.output(videoFrame(0));
  assert.deepEqual(decoded(), [1, 2]);
  pipeline.stop();
});

test('stop interrupts codec probing and an old probe cannot reopen a decoder after reconnect', async t => {
  const timers = new Set();
  t.mock.method(globalThis, 'setInterval', callback => { timers.add(callback); return callback; });
  t.mock.method(globalThis, 'clearInterval', callback => timers.delete(callback));
  globalThis.VideoDecoder = FakeDecoder;
  globalThis.EncodedVideoChunk = class { constructor(init) { Object.assign(this, init); } };
  t.after(() => { delete globalThis.VideoDecoder; delete globalThis.EncodedVideoChunk; FakeDecoder.gate = null; });
  FakeDecoder.instances = [];
  let release;
  FakeDecoder.gate = new Promise(resolve => { release = resolve; });
  const messages = [], presented = [];
  const pipeline = createDecoderPipeline({ post: message => messages.push(message), present: recordingPresenter(t, messages, presented) });
  const firstBody = new ReadableStream({ start(c) { c.enqueue(config(1)); } });
  const firstRead = pipeline.read(1, firstBody);
  await settle();
  pipeline.stop();
  await firstRead;
  assert.equal(firstBody.locked, false);
  assert.equal(timers.size, 0);
  FakeDecoder.gate = null;
  let next;
  const secondBody = new ReadableStream({ start(c) { next = c; c.enqueue(config(2)); c.enqueue(keyFrame(2)); } });
  const secondRead = pipeline.read(2, secondBody);
  await settle();
  release();
  await settle();
  assert.equal(FakeDecoder.instances.length, 1, 'late old probe cannot open a decoder');
  const decoder = FakeDecoder.instances[0];
  decoder.output(videoFrame(0));
  assert.deepEqual(messages.filter(m => m.type === 'decoded').map(m => [m.id, m.epoch]), [[2, 2]]);
  next.close();
  await secondRead;
  assert.equal(decoder.state, 'closed', 'natural stream end releases the decoder');
  assert.equal(timers.size, 0);
  const late = videoFrame(1);
  decoder.output(late);
  assert.equal(late.closed, true);
  assert.equal(presented.length, 1);
});

test('producer idle drops late decoder output and resumes on the same response', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  FakeDecoder.instances = [];
  FakeDecoder.gate = null;
  globalThis.VideoDecoder = FakeDecoder;
  globalThis.EncodedVideoChunk = class { constructor(init) { Object.assign(this, init); } };
  t.after(() => { delete globalThis.VideoDecoder; delete globalThis.EncodedVideoChunk; });
  const messages = [], presented = [];
  const pipeline = createDecoderPipeline({ post: message => messages.push(message), present: recordingPresenter(t, messages, presented) });
  t.after(() => pipeline.stop());
  let controller;
  pipeline.read(7, new ReadableStream({ start(c) { controller = c; } }));
  controller.enqueue(config(1));
  controller.enqueue(keyFrame(1));
  await settle();
  const first = FakeDecoder.instances.at(-1);
  first.output(videoFrame(0));
  controller.enqueue(encodeRecord({ kind: RECORD.IDLE }));
  controller.enqueue(encodeRecord({ kind: RECORD.HEARTBEAT }));
  await settle();
  assert.equal(first.state, 'closed');
  assert.equal(pipeline.stats().codec, null);
  assert.deepEqual(messages.filter(m => m.type === 'idle').map(m => m.id), [7]);
  assert.equal(messages.some(m => m.type === 'end'), false, 'idle must retain the response');
  const late = videoFrame(16666);
  first.output(late);
  assert.equal(late.closed, true);
  assert.equal(presented.length, 1);
  controller.enqueue(config(2));
  controller.enqueue(keyFrame(2));
  await settle();
  const second = FakeDecoder.instances.at(-1);
  assert.notEqual(second, first);
  second.output(videoFrame(0));
  assert.deepEqual(messages.filter(m => m.type === 'decoded').map(m => [m.id, m.epoch]), [[7, 1], [7, 2]]);
});

test('the presenter closes retained and failed frames on stop/dispose', async () => {
  const { createFramePresenter } = await import('../../site/play/video.js');
  let fail = false;
  const context = { fillRect() {}, drawImage() { if (fail) throw new Error('draw failed'); } };
  const canvas = { width: 800, height: 480, getContext: type => type === '2d' ? context : null, removeEventListener() {} };
  const presenter = createFramePresenter(canvas);
  const first = { ...videoFrame(0), displayWidth: 800, displayHeight: 480 };
  presenter.present(first);
  presenter.close();
  assert.equal(first.closed, true);
  assert.equal(presenter.stats().currentFps, 0);
  const second = { ...videoFrame(1), displayWidth: 800, displayHeight: 480 };
  presenter.present(second);
  const failed = { ...videoFrame(2), displayWidth: 800, displayHeight: 480 };
  fail = true;
  assert.throws(() => presenter.present(failed), /draw failed/);
  assert.equal(failed.closed, true);
  assert.equal(presenter.stats().currentFps, 1, 'a failed draw does not contribute to current FPS');
  assert.equal(presenter.stats().renderDroppedFrames, 1);
  presenter.dispose();
  assert.equal(second.closed, true);
});

test('scheduled source timestamps reach presentation; absent clocks never become guessed offsets', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  FakeDecoder.instances = [];
  FakeDecoder.gate = null;
  globalThis.VideoDecoder = FakeDecoder;
  globalThis.EncodedVideoChunk = class { constructor(init) { Object.assign(this, init); } };
  t.after(() => { delete globalThis.VideoDecoder; delete globalThis.EncodedVideoChunk; });
  const presented = [];
  const pipeline = createDecoderPipeline({ post() {}, present: (frame, info, id, timing) => presented.push(timing) });
  t.after(() => pipeline.stop());
  let controller;
  pipeline.read(1, new ReadableStream({ start(value) { controller = value; } }));
  controller.enqueue(config(1));
  await settle();
  const now = performance.timeOrigin + performance.now();
  pipeline.clock({ offset: now - 1000, at: now, rtt: 2 });
  const payload = new Uint8Array(8);
  new DataView(payload.buffer).setFloat64(0, 1100, true);
  const timing = () => encodeRecord({ kind: RECORD.TIMING, epoch: 1, payload });
  controller.enqueue(timing());
  controller.enqueue(keyFrame(1));
  await settle();
  FakeDecoder.instances.at(-1).output(videoFrame(0));
  assert.equal(presented[0], now + 100);
  pipeline.clock(null);
  controller.enqueue(timing());
  controller.enqueue(keyFrame(1));
  await settle();
  FakeDecoder.instances.at(-1).output(videoFrame(0));
  assert.equal(presented[1], null);
  assert.equal(pipeline.stats().timingRecords, 2);
  assert.equal(pipeline.stats().timingRejected, 1);
});

test('decoder drop count tracks rejected inputs and resets only for a new producer epoch or response', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  FakeDecoder.instances = []; FakeDecoder.gate = null;
  globalThis.VideoDecoder = FakeDecoder;
  globalThis.EncodedVideoChunk = class { constructor(init) { Object.assign(this, init); } };
  t.after(() => { delete globalThis.VideoDecoder; delete globalThis.EncodedVideoChunk; });
  const pipeline = createDecoderPipeline({ post() {}, present() {} });
  t.after(() => pipeline.stop());
  let controller;
  pipeline.read(1, new ReadableStream({ start(value) { controller = value; } }));
  controller.enqueue(config(1));
  await settle();
  const delta = epoch => encodeRecord({ kind: RECORD.FRAME, codec: 1, epoch, payload: Uint8Array.of(0, 0, 0, 1, 0x41) });
  controller.enqueue(delta(1));
  await settle();
  assert.equal(pipeline.stats().decodeDroppedFrames, 1);
  t.mock.method(FakeDecoder.instances.at(-1), 'decode', () => { throw new Error('rejected input'); });
  controller.enqueue(keyFrame(1));
  await settle();
  assert.equal(pipeline.stats().decodeDroppedFrames, 2, 'a synchronous rejection adds exactly its input');
  controller.enqueue(config(1));
  await settle();
  assert.equal(pipeline.stats().decodeDroppedFrames, 2, 'repeated configuration does not erase current-epoch drops');
  controller.enqueue(config(2));
  await settle();
  assert.equal(pipeline.stats().decodeDroppedFrames, 0);
  controller.enqueue(delta(2));
  await settle();
  assert.equal(pipeline.stats().decodeDroppedFrames, 1);
  pipeline.read(2, new ReadableStream({ start(value) { value.enqueue(config(2)); } }));
  await settle();
  assert.equal(pipeline.stats().decodeDroppedFrames, 0, 'new HTTP response starts a fresh count');
});

test('video pipeline preserves source mode in CONFIG messages and presented frame configuration', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  FakeDecoder.instances = []; FakeDecoder.gate = null;
  globalThis.VideoDecoder = FakeDecoder;
  globalThis.EncodedVideoChunk = class { constructor(init) { Object.assign(this, init); } };
  t.after(() => { delete globalThis.VideoDecoder; delete globalThis.EncodedVideoChunk; });
  const messages = [], presented = [];
  const pipeline = createDecoderPipeline({ post: message => messages.push(message), present: (frame, info) => presented.push(info.mode) });
  t.after(() => pipeline.stop());
  let controller; pipeline.read(1, new ReadableStream({ start(value) { controller = value; } }));
  for (const [i, mode] of ['carplay', 'airplay-mirror'].entries()) {
    controller.enqueue(config(i + 1, mode)); controller.enqueue(keyFrame(i + 1)); await settle();
    FakeDecoder.instances.at(-1).output(videoFrame(0));
    assert.equal(messages.filter(message => message.type === 'config').at(-1).config.mode, mode);
  }
  assert.deepEqual(presented, ['carplay', 'airplay-mirror']);
});

test('canvas submission reports an early source presentation as a signed offset', async () => {
  const { createFramePresenter } = await import('../../site/play/video.js');
  const context = { fillRect() {}, drawImage() {} };
  const canvas = { width: 800, height: 480, getContext: type => type === '2d' ? context : null, removeEventListener() {} };
  const presenter = createFramePresenter(canvas);
  const sourcePresentation = performance.timeOrigin + performance.now() + 40;
  presenter.present({ ...videoFrame(0), displayWidth: 800, displayHeight: 480 }, { epoch: 1 }, sourcePresentation);
  const stats = presenter.stats();
  assert.equal(stats.presentationOffsetSamples, 1);
  assert.ok(stats.presentationOffset90 < 0 && stats.presentationOffset90 >= -40);
  assert.ok(Math.abs(stats.currentDelta - stats.presentationOffset90) < 1e-9, 'single submitted frame is the current Delta within floating-point precision');
  presenter.dispose();
});

test('the presenter rejects frames delayed by main-thread delivery and rechecks before drawing', () => {
  let now = 1301, draws = 0, clears = 0, clockReads = 0, preparationExpires = false;
  const context = { fillRect() { clears++; }, drawImage() { draws++; } };
  const canvas = { width: 800, height: 480, getContext: type => type === '2d' ? context : null, removeEventListener() {} };
  const presenter = createFramePresenter(canvas, { applyTimingPolicy: true, now: () => { if (preparationExpires && ++clockReads >= 2) now = 1301; return now; } });
  const expired = videoFrame(0); presenter.present(expired, { mode: 'carplay' }, 1000);
  assert.equal(expired.closed, true); assert.equal(draws, 0);
  now = 1299; preparationExpires = true;
  const crossed = videoFrame(1); presenter.present(crossed, { mode: 'carplay' }, 1000);
  assert.equal(crossed.closed, true); assert.equal(draws, 0, 'canvas submission check catches time spent preparing the draw');
  assert.equal(clears, 0, 'an expired frame never clears the retained picture');
  preparationExpires = false; presenter.present(videoFrame(2), { mode: 'carplay' }, null);
  assert.equal(draws, 1, 'missing timestamps retain explicit fallback playback');
  assert.equal(presenter.stats().expiredFrames, 2); assert.equal(presenter.stats().untimedFrames, 1);
  assert.equal(presenter.stats().renderDroppedFrames, 2);
  presenter.dispose();
});

test('an expired GPU texture upload never clears or submits the canvas', () => {
  let now = 1299, proofs = 0;
  const calls = [], canvas = { width: 800, height: 480, addEventListener() {}, removeEventListener() {} }, gl = { canvas, isContextLost: () => false };
  for (const name of ['createProgram', 'createShader', 'shaderSource', 'compileShader', 'attachShader', 'deleteShader', 'linkProgram', 'useProgram', 'createBuffer', 'bindBuffer', 'bufferData', 'getAttribLocation', 'enableVertexAttribArray', 'vertexAttribPointer', 'createTexture', 'bindTexture', 'texParameteri', 'getUniformLocation', 'uniform1i', 'viewport', 'clearColor', 'clear', 'drawArrays', 'deleteTexture', 'deleteBuffer', 'deleteProgram']) gl[name] = () => { calls.push(name); return {}; };
  gl.texImage2D = () => { calls.push('upload'); now = 1301; };
  gl.flush = () => calls.push('flush');
  canvas.getContext = type => type === 'webgl2' ? gl : null;
  const presenter = createFramePresenter(canvas, { applyTimingPolicy: true, now: () => now, onFirstPresent: () => proofs++ });
  const frame = videoFrame(0); presenter.present(frame, { mode: 'carplay' }, 1000);
  assert.ok(calls.includes('upload')); assert.equal(calls.includes('clear'), false); assert.equal(calls.includes('drawArrays'), false);
  assert.equal(calls.includes('flush'), false);
  assert.equal(frame.closed, true); assert.equal(presenter.stats().expiredFrames, 1);
  assert.equal(proofs, 0, 'an expired upload cannot prove the picture was shown');
  presenter.present(videoFrame(1), { mode: 'carplay' }, 1100);
  assert.ok(calls.includes('drawArrays')); assert.equal(calls.filter(value => value === 'flush').length, 1);
  assert.equal(proofs, 1);
  presenter.dispose();
});


test('AirPlay encoded dependency order survives PTS reordering and backlog recovery waits for a key frame', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  FakeDecoder.instances = []; FakeDecoder.gate = null;
  globalThis.VideoDecoder = FakeDecoder;
  globalThis.EncodedVideoChunk = class { constructor(init) { Object.assign(this, init); } };
  t.after(() => { delete globalThis.VideoDecoder; delete globalThis.EncodedVideoChunk; });
  const messages = [], pipeline = createDecoderPipeline({ post: value => messages.push(value), present() {} });
  t.after(() => pipeline.stop());
  let controller;
  pipeline.read(1, new ReadableStream({ start(value) { controller = value; } }));
  controller.enqueue(config(1, 'airplay-mirror')); controller.enqueue(keyFrame(1)); await settle();
  const decoder = FakeDecoder.instances.at(-1);
  const delta = (sequence, timestampUs) => encodeRecord({ kind: RECORD.FRAME, codec: 1, epoch: 1,
    sequence, timestampUs, payload: Uint8Array.of(0, 0, 0, 1, 0x41) });
  controller.enqueue(delta(1, 3000)); controller.enqueue(delta(2, 2000)); await settle();
  assert.deepEqual(decoder.chunks.map(chunk => chunk.timestamp), [0, 3000, 2000],
    'encoded reference/decode order cannot be sorted by presentation timestamps');
  decoder.decodeQueueSize = 31;
  controller.enqueue(delta(3, 4000)); controller.enqueue(delta(4, 5000)); await settle();
  assert.equal(decoder.resets, 1); assert.equal(decoder.chunks.length, 3);
  assert.equal(pipeline.stats().backlogResets, 1);
  assert.equal(pipeline.stats().decodeDroppedFrames, 2);
  assert.ok(messages.some(message => message.type === 'keyframe'));
  controller.enqueue(keyFrame(1)); controller.enqueue(delta(5, 6000)); await settle();
  assert.deepEqual(decoder.chunks.slice(-2).map(chunk => chunk.type), ['key', 'delta']);
});


test('a decoded frame dropped by audio sync proves nothing until a later frame is actually drawn', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  globalThis.VideoDecoder = FakeDecoder;
  globalThis.EncodedVideoChunk = class { constructor(init) { Object.assign(this, init); } };
  FakeDecoder.instances = []; FakeDecoder.gate = null;
  t.after(() => { delete globalThis.VideoDecoder; delete globalThis.EncodedVideoChunk; });
  const messages = [], shown = [];
  const frames = createTimedFrames(recordingPresenter(t, messages, shown), { now: () => 1000 });
  frames.audio({ mode: 'airplay-mirror', type: 0, epoch: 1, generation: 1, sequence: 1, clockGeneration: 1,
    state: 'playing', sourceTimeMs: 5000, audibleTimeMs: 1120, mediaRate: 1, at: 1000, uncertaintyMs: 0 });
  const pipeline = createDecoderPipeline({ post: message => messages.push(message), present: frames.present });
  t.after(() => { pipeline.stop(); frames.reset(); });
  let controller;
  pipeline.read(3, new ReadableStream({ start(c) { controller = c; } }));
  controller.enqueue(config(1, 'airplay-mirror')); controller.enqueue(keyFrame(1)); await settle();
  const dropped = videoFrame(0); FakeDecoder.instances.at(-1).output(dropped);
  assert.equal(dropped.closed, true); assert.equal(shown.length, 0);
  assert.equal(messages.some(m => m.type === 'decoded'), false);
  frames.audio({ mode: 'airplay-mirror', type: 0, epoch: 1, generation: 1, sequence: 2, clockGeneration: 1,
    state: 'disabled', at: 1000 });
  FakeDecoder.instances.at(-1).output(videoFrame(1));
  FakeDecoder.instances.at(-1).output(videoFrame(2));
  assert.equal(shown.length, 2);
  assert.deepEqual(messages.filter(m => m.type === 'decoded').map(m => [m.id, m.epoch]), [[3, 1]]);
});

test('first-frame proof waits for paced drawing and is suppressed on expired frames', t => {
  let refresh, at = 1000, draws = 0;
  globalThis.requestAnimationFrame = callback => { refresh = callback; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; });
  const proofs = [];
  const canvas = { width: 800, height: 480, removeEventListener() {},
    getContext: type => type === '2d' ? { fillRect() {}, drawImage() { draws++; } } : null };
  const presenter = createFramePresenter(canvas, { pace: true, applyTimingPolicy: true, now: () => at,
    onFirstPresent: config => proofs.push([config.streamId, config.epoch]) });
  t.after(() => presenter.dispose());
  presenter.present(videoFrame(0), { streamId: 9, epoch: 1, mode: 'carplay' }, 1100);
  assert.equal(proofs.length, 0); assert.equal(draws, 0);
  at = 1401; refresh();
  assert.equal(proofs.length, 0); assert.equal(draws, 0);
  presenter.present(videoFrame(1), { streamId: 9, epoch: 1, mode: 'carplay' }, 1200);
  at = 1150; refresh();
  assert.equal(draws, 1); assert.deepEqual(proofs, [[9, 1]]);
});

test('CarPlay decode capacity backpressures complete predictive input without resets or key requests', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  globalThis.VideoDecoder = FakeDecoder;
  globalThis.EncodedVideoChunk = class { constructor(init) { Object.assign(this, init); } };
  FakeDecoder.instances = []; FakeDecoder.gate = null;
  t.after(() => { delete globalThis.VideoDecoder; delete globalThis.EncodedVideoChunk; });
  const messages = [], pipeline = createDecoderPipeline({ post: message => messages.push(message), present() {} });
  t.after(() => pipeline.stop());
  let controller;
  pipeline.read(7, new ReadableStream({ start(value) { controller = value; } }));
  controller.enqueue(config(1)); controller.enqueue(keyFrame(1)); await settle();
  const decoder = FakeDecoder.instances.at(-1);
  decoder.decodeQueueSize = 12;
  let dequeue;
  decoder.addEventListener = (name, callback) => { if (name === 'dequeue') dequeue = callback; };
  decoder.removeEventListener = () => {};
  const delta = timestampUs => encodeRecord({ kind: RECORD.FRAME, codec: 1, epoch: 1, timestampUs,
    payload: Uint8Array.of(0, 0, 0, 1, 0x41) });
  controller.enqueue(delta(3000)); controller.enqueue(delta(2000)); await settle();
  assert.equal(decoder.chunks.length, 1, 'reader waits instead of submitting more hardware work');
  decoder.decodeQueueSize = 0; dequeue(); await settle();
  assert.deepEqual(decoder.chunks.map(chunk => chunk.timestamp), [0, 3000, 2000]);
  assert.equal(decoder.resets, undefined); assert.equal(pipeline.stats().decodeDroppedFrames, 0);
  assert.equal(messages.some(message => message.type === 'keyframe'), false);
  assert.equal(pipeline.stats().acceleration, 'prefer-hardware');
  assert.equal(pipeline.stats().decoderImplementation, 'unknown', 'requested preference is not proof of hardware');
});

test('CarPlay does not accept a software-only decoder preference', async t => {
  const original = FakeDecoder.isConfigSupported;
  FakeDecoder.isConfigSupported = async candidate => ({ supported: candidate.hardwareAcceleration === 'no-preference' });
  globalThis.VideoDecoder = FakeDecoder;
  t.after(() => { FakeDecoder.isConfigSupported = original; delete globalThis.VideoDecoder; });
  const messages = [], pipeline = createDecoderPipeline({ post: message => messages.push(message), present() {} });
  t.after(() => pipeline.stop());
  let controller;
  pipeline.read(8, new ReadableStream({ start(value) { controller = value; } }));
  controller.enqueue(config(1)); await settle();
  assert.equal(pipeline.stats().codecSupported, false);
  assert.ok(messages.some(message => message.type === 'unsupported'));
});

test('extended timing records measure bounded stages without changing encoded payload or presentation', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  globalThis.VideoDecoder = FakeDecoder;
  globalThis.EncodedVideoChunk = class { constructor(init) { Object.assign(this, init); } };
  FakeDecoder.instances = []; FakeDecoder.gate = null;
  t.after(() => { delete globalThis.VideoDecoder; delete globalThis.EncodedVideoChunk; });
  const shown = [], pipeline = createDecoderPipeline({ post() {}, present: (...value) => shown.push(value) });
  t.after(() => pipeline.stop());
  let controller;
  pipeline.read(10, new ReadableStream({ start(value) { controller = value; } }));
  controller.enqueue(config(1)); await settle();
  const at = performance.timeOrigin + performance.now();
  pipeline.clock({ offset: at - 1000, at, rtt: 2, uncertaintyMs: 1 });
  const payload = new Uint8Array(24), values = new DataView(payload.buffer);
  values.setFloat64(0, 1000, true); values.setFloat64(8, 970, true); values.setFloat64(16, 990, true);
  controller.enqueue(encodeRecord({ kind: RECORD.TIMING, codec: 0, epoch: 1, timestampUs: 0, payload }));
  controller.enqueue(keyFrame(1)); await settle();
  const decoder = FakeDecoder.instances.at(-1);
  decoder.output(videoFrame(0));
  assert.equal(shown.length, 1); assert.equal(shown[0][3], at, 'source presentation still uses the first float64');
  const stages = shown[0][1].stageTiming;
  assert.ok(stages.recordReadAtMs <= stages.decodeSubmitAtMs && stages.decodeSubmitAtMs <= stages.decodedAtMs);
  assert.deepEqual([...decoder.chunks[0].data], [0, 0, 0, 1, 0x65], 'stage evidence carries no replacement media bytes');
  const stats = pipeline.stats();
  assert.equal(stats.androidHubQueueMsP95, 20);
  assert.ok(stats.androidTransportSubmitToRecordReadMsP95 >= 9);
  assert.ok(stats.recordReadToDecodeSubmitMsP95 >= 0); assert.ok(stats.decodeMsP95 >= 0);
  assert.equal(stats.stageClockUncertaintyMs, 1);
});

test('video read/decoded/draw evidence counts actual frame records and keeps explicit stream/epoch identity', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  globalThis.VideoDecoder = FakeDecoder;
  globalThis.EncodedVideoChunk = class { constructor(init) { Object.assign(this, init); } };
  FakeDecoder.instances = []; FakeDecoder.gate = null;
  t.after(() => { delete globalThis.VideoDecoder; delete globalThis.EncodedVideoChunk; });
  const shown = [], messages = [];
  const present = recordingPresenter(t, messages, shown);
  const pipeline = createDecoderPipeline({ post() {}, present });
  t.after(() => pipeline.stop());
  let controller;
  pipeline.read(42, new ReadableStream({ start(value) { controller = value; } }));
  controller.enqueue(config(7)); await settle();
  controller.enqueue(keyFrame(7)); await settle();
  FakeDecoder.instances.at(-1).output(videoFrame(0));
  const stats = pipeline.stats();
  assert.equal(stats.streamGeneration, 42); assert.equal(stats.epoch, 7); assert.equal(stats.mode, 'carplay');
  assert.equal(stats.readFrames, 1); assert.equal(stats.readFrameBytes, 5); assert.equal(stats.decoded, 1);
  assert.equal(stats.sourceForwardPtsSamples, 0, 'missing presentation anchors do not invent source cadence');
  assert.equal(shown.length, 1);
});

test('draw evidence counts successful media submissions and resets at the presenter epoch boundary', () => {
  const canvas = { width: 100, height: 100, removeEventListener() {},
    getContext: type => type === '2d' ? { fillRect() {}, drawImage() {} } : null };
  const presenter = createFramePresenter(canvas);
  presenter.present(videoFrame(0), { mode: 'carplay', streamId: 42, epoch: 7 });
  assert.equal(presenter.stats().drawnFrames, 1);
  presenter.resize(200, 200);
  assert.equal(presenter.stats().drawnFrames, 1, 'resize redraw is not another source picture');
  presenter.close(); assert.equal(presenter.stats().drawnFrames, 0);
  presenter.dispose();
});
