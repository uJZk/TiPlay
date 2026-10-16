// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createTimedFrames, createVideoEpochGuard } from '../../site/play/media-timing.js';
import { createFrameDelivery } from '../../site/play/transport.js';
import { createFramePresenter } from '../../site/play/video.js';
import { constantDelay } from '../../site/play/delay-plan.js';

// Execute the actual worker message handler with a deterministic decoder and clock.
// This tests messages crossing the scheduling boundary, rather than matching code text.
async function workerHarness() {
  let callbacks, at = 1000;
  const messages = [], timers = new Map();
  let timerId = 0;
  const schedule = (callback, wait) => { const id = ++timerId; timers.set(id, { callback, at: at + wait }); return id; };
  const cancel = id => timers.delete(id);
  const self = { postMessage: message => messages.push(message), close() {} };
  const source = (await readFile(new URL('../../site/play/decoder-worker.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '');
  vm.runInNewContext(source, {
    self, VideoDecoder: function () {},
    createDecoderPipeline(options) {
      callbacks = options;
      return { clock() {}, read() {}, stop() {}, stats: () => ({}) };
    },
    createFramePresenter() { throw new Error('unexpected offscreen presenter'); },
    createTimedFrames: (present, options) => createTimedFrames(present, { ...options, now: () => at, schedule, cancel }),
    createVideoEpochGuard, createFrameDelivery,
    createChunkStream: () => { throw new Error('unexpected port feed'); },
    setInterval: () => 1, clearInterval() {},
  });
  return {
    messages,
    send: data => self.onmessage({ data }),
    post: message => callbacks.post(message),
    frame(frame, config, id, timing, source) { callbacks.present(frame, config, id, timing, source); },
    advance(value) {
      at = value;
      for (const [id, timer] of timers) if (timer.at <= at) { timers.delete(id); timer.callback(); }
    },
  };
}
function frame() { return { closed: 0, close() { this.closed++; } }; }
function latest(harness, type) { return harness.messages.filter(message => message.type === type).at(-1); }

test('worker readiness waits for its matching stream and token before transfer', async () => {
  const h = await workerHarness(), picture = frame();
  h.send({ type: 'stream', id: 7, stream: {} });
  h.post({ type: 'config', id: 7, config: { epoch: 1, mode: 'carplay' } });
  h.frame(picture, { epoch: 1, mode: 'carplay' }, 7, 1010);
  const ready = latest(h, 'media-ready');
  assert.equal(ready.id, 7);
  assert.equal(latest(h, 'frame'), undefined);
  h.send({ type: 'media-ready-ack', id: 6, token: ready.token, plan: constantDelay(0) });
  h.send({ type: 'media-ready-ack', id: 7, token: ready.token + 1, plan: constantDelay(0) });
  assert.equal(latest(h, 'frame'), undefined);
  h.send({ type: 'media-ready-ack', id: 7, token: ready.token, plan: constantDelay(0) });
  assert.equal(latest(h, 'frame').frame, picture);
  assert.equal(picture.closed, 0);
});

test('worker resets retire pending readiness without reusing tokens in the same stream', async () => {
  const h = await workerHarness(), old = frame(), next = frame();
  h.send({ type: 'stream', id: 1, stream: {} });
  h.post({ type: 'config', id: 1, config: { epoch: 1 } });
  h.frame(old, { epoch: 1, mode: 'carplay' }, 1, 1010);
  const stale = latest(h, 'media-ready');
  h.post({ type: 'idle', id: 1 });
  assert.equal(old.closed, 1);
  h.post({ type: 'config', id: 1, config: { epoch: 2 } });
  h.frame(next, { epoch: 2, mode: 'carplay' }, 1, 1010);
  const current = latest(h, 'media-ready');
  assert.notEqual(current.token, stale.token);
  h.send({ type: 'media-ready-ack', id: 1, token: stale.token, plan: constantDelay(0) });
  assert.equal(latest(h, 'frame'), undefined);
  h.send({ type: 'media-ready-ack', id: 1, token: current.token, plan: constantDelay(0) });
  assert.equal(latest(h, 'frame').frame, next);
});

test('worker discards a decoded CarPlay frame that expires while awaiting readiness', async () => {
  const h = await workerHarness(), picture = frame();
  h.send({ type: 'stream', id: 1, stream: {} });
  h.frame(picture, { epoch: 1, mode: 'carplay' }, 1, 1010);
  const ready = latest(h, 'media-ready');
  h.advance(1011);
  h.send({ type: 'media-ready-ack', id: 1, token: ready.token, plan: constantDelay(0) });
  assert.equal(picture.closed, 1);
  assert.equal(latest(h, 'frame'), undefined);
});

test('worker renders absent source timing without inventing a timestamp or requesting an ACK', async () => {
  const h = await workerHarness(), picture = frame();
  h.send({ type: 'stream', id: 1, stream: {} });
  h.frame(picture, { epoch: 1, mode: 'carplay' }, 1, undefined);
  assert.equal(latest(h, 'media-ready'), undefined);
  assert.equal(latest(h, 'frame').timing, null);
  assert.equal(latest(h, 'frame').frame, picture);
});

test('worker delivery keeps the old transfer credit across stream reset', async () => {
  const h = await workerHarness(), first = frame(), second = frame();
  h.send({ type: 'stream', id: 1, stream: {} });
  h.frame(first, { epoch: 1 }, 1, null);
  const transfer = latest(h, 'frame');
  h.send({ type: 'stream', id: 2, stream: {} });
  h.frame(second, { epoch: 2 }, 2, null);
  assert.equal(h.messages.filter(message => message.type === 'frame').length, 1);
  h.send({ type: 'frame-ack', frameId: transfer.frameId + 1 });
  assert.equal(h.messages.filter(message => message.type === 'frame').length, 1);
  h.send({ type: 'frame-ack', frameId: transfer.frameId });
  assert.equal(latest(h, 'frame').frame, second);
  assert.equal(latest(h, 'frame').id, 2);
});

test('main renderer rechecks the raw cap after a transferred frame waits in transit', () => {
  const context = { fillRect() {}, drawImage() { throw new Error('expired frame was drawn'); } };
  const canvas = { width: 100, height: 100, getContext: type => type === '2d' ? context : null };
  const presenter = createFramePresenter(canvas, { applyTimingPolicy: true, now: () => 1001 });
  const picture = frame();
  presenter.present(picture, { epoch: 1, mode: 'carplay' }, 1000);
  assert.equal(picture.closed, 1);
  assert.equal(presenter.stats().expiredFrames, 1);
});

test('worker applies actual output references and transfers the exact narrowed A/V window', async () => {
  const h = await workerHarness(), picture = frame();
  h.send({ type: 'stream', id: 1, stream: {} });
  h.send({ type: 'audio-output', reference: { mode: 'carplay', type: 0, epoch: 7, generation: 2, clockGeneration: 3,
    sequence: 1, state: 'playing', at: 1000, sourceTimeMs: 5000, audibleTimeMs: 1150,
    mediaRate: 1, uncertaintyMs: 1, outputMethod: 'timestamp' } });
  h.frame(picture, { mode: 'carplay', epoch: 1 }, 1, 1050, { sourceTimeMs: 5000, clockGeneration: 3 });
  const ready = latest(h, 'media-ready');
  h.send({ type: 'media-ready-ack', id: 1, token: ready.token, plan: constantDelay(0) });
  h.advance(1025); assert.equal(latest(h, 'frame'), undefined);
  h.advance(1030);
  const transfer = latest(h, 'frame');
  assert.equal(transfer.frame, picture);
  assert.equal(transfer.outputWindow.audioAt, 1150);
  assert.equal(transfer.outputWindow.earliest, 1026);
  assert.equal(transfer.outputWindow.latest, 1050, 'raw zero cap still bounds actual-output following');
  assert.equal(transfer.outputWindow.epoch, 7, 'video and audio producer epochs remain independent');
});

test('worker cannot use an invalidated active-audio reference as video-only fallback', async () => {
  const h = await workerHarness(), picture = frame();
  h.send({ type: 'stream', id: 1, stream: {} });
  const reference = { mode: 'carplay', type: 0, epoch: 7, generation: 2, sequence: 1,
    state: 'playing', at: 1000, sourceTimeMs: 5000, audibleTimeMs: 1150, mediaRate: 1 };
  h.send({ type: 'audio-output', reference });
  h.send({ type: 'audio-output', reference: { ...reference, sequence: 2, state: 'rebuffering', audibleTimeMs: null } });
  h.frame(picture, { mode: 'carplay', epoch: 1 }, 1, 1050, { sourceTimeMs: 5000 });
  const ready = latest(h, 'media-ready');
  h.send({ type: 'media-ready-ack', id: 1, token: ready.token, plan: constantDelay(0) });
  h.advance(1050);
  assert.equal(picture.closed, 1);
  assert.equal(latest(h, 'frame'), undefined);
});
