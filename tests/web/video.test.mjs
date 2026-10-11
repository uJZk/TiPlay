// SPDX-License-Identifier: GPL-3.0-only
// The WebCodecs pipeline of video.js against a scripted VideoDecoder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAG, RECORD, encodeRecord } from '../../site/play/link.js';
import { createDecoderPipeline } from '../../site/play/video.js';

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

const config = epoch => encodeRecord({
  kind: RECORD.CONFIG, codec: 1, epoch, payload: new TextEncoder().encode(JSON.stringify({ codec: 'avc1.640028', width: 1182, height: 920, fps: 60 })),
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
  const second = { ...videoFrame(1), displayWidth: 800, displayHeight: 480 };
  presenter.present(second);
  const failed = { ...videoFrame(2), displayWidth: 800, displayHeight: 480 };
  fail = true;
  assert.throws(() => presenter.present(failed), /draw failed/);
  assert.equal(failed.closed, true);
  presenter.dispose();
  assert.equal(second.closed, true);
});
