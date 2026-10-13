// SPDX-License-Identifier: GPL-3.0-only
// The WebCodecs pipeline of video.js against a scripted VideoDecoder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAG, RECORD, encodeRecord } from '../../site/play/link.js';
import { createDecoderPipeline, createFramePresenter } from '../../site/play/video.js';

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
}

const config = (epoch, mode = 'carplay') => encodeRecord({
  kind: RECORD.CONFIG, codec: 1, epoch, payload: new TextEncoder().encode(JSON.stringify({ mode, codec: 'avc1.640028', width: 1182, height: 920, fps: 60 })),
});
const keyFrame = epoch => encodeRecord({ kind: RECORD.FRAME, flags: FLAG.KEY, codec: 1, epoch, payload: Uint8Array.of(0, 0, 0, 1, 0x65) });
const videoFrame = timestamp => ({ timestamp, closed: false, close() { this.closed = true; } });

test('late output of the previous decoder is not drawn or reported as the new epoch', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  globalThis.VideoDecoder = FakeDecoder;
  globalThis.EncodedVideoChunk = class { constructor(init) { Object.assign(this, init); } };
  t.after(() => { delete globalThis.VideoDecoder; delete globalThis.EncodedVideoChunk; });

  const messages = [], presented = [];
  const pipeline = createDecoderPipeline({ post: message => messages.push(message), present: frame => presented.push(frame) });
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
  const pipeline = createDecoderPipeline({ post: message => messages.push(message), present: frame => presented.push(frame) });
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
  const pipeline = createDecoderPipeline({ post: message => messages.push(message), present: frame => presented.push(frame) });
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
  for (const [i, mode] of ['carplay', 'airplay-mirror', 'airplay-video'].entries()) {
    controller.enqueue(config(i + 1, mode)); controller.enqueue(keyFrame(i + 1)); await settle();
    FakeDecoder.instances.at(-1).output(videoFrame(0));
    assert.equal(messages.filter(message => message.type === 'config').at(-1).config.mode, mode);
  }
  assert.deepEqual(presented, ['carplay', 'airplay-mirror', 'airplay-video']);
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
  presenter.dispose();
});

test('the presenter rejects frames delayed by main-thread delivery and rechecks before drawing', () => {
  let now = 1101, draws = 0, clears = 0, clockReads = 0, preparationExpires = false;
  const context = { fillRect() { clears++; }, drawImage() { draws++; } };
  const canvas = { width: 800, height: 480, getContext: type => type === '2d' ? context : null, removeEventListener() {} };
  const presenter = createFramePresenter(canvas, { applyTimingPolicy: true, now: () => { if (preparationExpires && ++clockReads >= 2) now = 1101; return now; } });
  const expired = videoFrame(0); presenter.present(expired, { mode: 'carplay' }, 1000);
  assert.equal(expired.closed, true); assert.equal(draws, 0);
  now = 1099; preparationExpires = true;
  const crossed = videoFrame(1); presenter.present(crossed, { mode: 'carplay' }, 1000);
  assert.equal(crossed.closed, true); assert.equal(draws, 0, 'canvas submission check catches time spent preparing the draw');
  assert.equal(clears, 0, 'an expired frame never clears the retained picture');
  preparationExpires = false; presenter.present(videoFrame(2), { mode: 'carplay' }, null);
  assert.equal(draws, 1, 'missing timestamps retain explicit fallback playback');
  assert.equal(presenter.stats().expiredFrames, 2); assert.equal(presenter.stats().untimedFrames, 1);
  presenter.dispose();
});

test('an expired GPU texture upload never clears or submits the canvas', () => {
  let now = 1099;
  const calls = [], canvas = { width: 800, height: 480, addEventListener() {}, removeEventListener() {} }, gl = { canvas, isContextLost: () => false };
  for (const name of ['createProgram', 'createShader', 'shaderSource', 'compileShader', 'attachShader', 'deleteShader', 'linkProgram', 'useProgram', 'createBuffer', 'bindBuffer', 'bufferData', 'getAttribLocation', 'enableVertexAttribArray', 'vertexAttribPointer', 'createTexture', 'bindTexture', 'texParameteri', 'getUniformLocation', 'uniform1i', 'viewport', 'clearColor', 'clear', 'drawArrays', 'deleteTexture', 'deleteBuffer', 'deleteProgram']) gl[name] = () => { calls.push(name); return {}; };
  gl.texImage2D = () => { calls.push('upload'); now = 1101; };
  canvas.getContext = type => type === 'webgl2' ? gl : null;
  const presenter = createFramePresenter(canvas, { applyTimingPolicy: true, now: () => now });
  const frame = videoFrame(0); presenter.present(frame, { mode: 'carplay' }, 1000);
  assert.ok(calls.includes('upload')); assert.equal(calls.includes('clear'), false); assert.equal(calls.includes('drawArrays'), false);
  assert.equal(frame.closed, true); assert.equal(presenter.stats().expiredFrames, 1); presenter.dispose();
});
