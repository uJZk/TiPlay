// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createFrameDelivery } from '../../site/play/transport.js';
import { createRtcTrackReader, createRtcVideoPipeline, RTC_VIDEO_TRANSPORT } from '../../site/play/rtc-video.js';
import { RECORD, encodeRecord } from '../../site/play/link.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const frame = () => ({ closed: 0, close() { this.closed++; } });
const config = (epoch, videoGeneration = 1) => encodeRecord({ kind: RECORD.CONFIG, epoch,
  payload: new TextEncoder().encode(JSON.stringify({ mode: 'carplay', codec: 'avc1.640028', width: 800, height: 480,
    videoTransport: RTC_VIDEO_TRANSPORT, videoGeneration })) });
async function workerHarness(t, { canvas = false, now, firstFrameWaitMs } = {}) {
  let reportStats, controller, cancelled = 0;
  const messages = [], self = { postMessage: message => messages.push(message), close() {} };
  const source = (await readFile(new URL('../../site/play/decoder-worker.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  vm.runInNewContext(source, {
    self, createFrameDelivery, createRtcTrackReader,
    createRtcVideoPipeline: options => createRtcVideoPipeline({ ...options, ...(now ? { now } : {}), ...(firstFrameWaitMs ? { firstFrameWaitMs } : {}) }),
    createFramePresenter(_canvas, options) {
      if (!canvas) throw Error('unexpected canvas setup');
      return { present(value, config) { value.close(); options.onFirstPresent(config); }, close() {}, dispose() {}, resize() {}, stats: () => ({ renderDroppedFrames: 0 }) };
    },
    createChunkStream() { throw Error('unexpected port feed'); },
    setInterval: callback => { reportStats = callback; return 1; }, clearInterval() {},
  });
  const send = data => self.onmessage({ data });
  if (canvas) send({ type: 'canvas', canvas: {} });
  send({ type: 'stream', id: 7, stream: new ReadableStream({ start(value) { controller = value; }, cancel() { cancelled++; } }) });
  t.after(() => send({ type: 'stop' }));
  return { send, messages, enqueue: value => controller.enqueue(value), cancelled: () => cancelled,
    stats() { reportStats(); return messages.filter(value => value.type === 'stats').at(-1).stats; } };
}
const latest = (h, type) => h.messages.filter(value => value.type === type).at(-1);

test('worker reports transfer drops only when frames really use worker-to-main delivery', async t => {
  const mainCanvas = await workerHarness(t);
  const workerCanvas = await workerHarness(t, { canvas: true });
  assert.equal(mainCanvas.stats().transferDroppedFrames, 0);
  assert.equal(Object.hasOwn(workerCanvas.stats(), 'transferDroppedFrames'), false);
  assert.equal(workerCanvas.stats().renderDroppedFrames, 0);
});

test('worker renders native frames directly without WebCodecs, source-clock or touch scheduling', async t => {
  const h = await workerHarness(t);
  h.enqueue(config(1)); await settle();
  h.send({ type: 'interaction', active: true });
  h.send({ type: 'audio-output', reference: { state: 'priming' } });
  const picture = frame(); h.send({ type: 'rtc-frame', id: 7, generation: 1, frame: picture, frameId: 11 });
  assert.equal(latest(h, 'frame').frame, picture);
  assert.equal(latest(h, 'media-ready'), undefined);
  assert.equal(latest(h, 'rtc-frame-ack').frameId, 11);
  assert.equal(h.stats().decoded, 1);
});

test('old session and old track-generation frames close without appearing under the next source', async t => {
  const h = await workerHarness(t);
  h.enqueue(config(1)); await settle();
  const oldSession = frame(); h.send({ type: 'rtc-frame', id: 6, generation: 1, frame: oldSession, frameId: 1 });
  assert.equal(oldSession.closed, 1);
  h.send({ type: 'video-generation', id: 7, generation: 2 });
  h.enqueue(config(2, 2)); await settle();
  const oldTrack = frame(); h.send({ type: 'rtc-frame', id: 7, generation: 1, frame: oldTrack, frameId: 2 });
  assert.equal(oldTrack.closed, 1);
  const current = frame(); h.send({ type: 'rtc-frame', id: 7, generation: 2, frame: current, frameId: 3 });
  assert.equal(latest(h, 'frame').frame, current); assert.equal(latest(h, 'frame').config.videoGeneration, 2);
});

test('source renegotiation keeps the metadata reader alive and requires an explicit new generation', async t => {
  const h = await workerHarness(t);
  h.enqueue(config(1)); await settle();
  h.enqueue(encodeRecord({ kind: RECORD.END, payload: new TextEncoder().encode('video-renegotiation-required') })); await settle();
  assert.equal(latest(h, 'video-error').reason, 'video-renegotiation-required');
  assert.equal(h.cancelled(), 0, 'video control END cannot cancel the shared peer');
  const old = frame(); h.send({ type: 'rtc-frame', id: 7, generation: 1, frame: old, frameId: 1 }); assert.equal(old.closed, 1);
  h.send({ type: 'video-generation', id: 7, generation: 2 }); h.enqueue(config(2, 2)); await settle();
  const current = frame(); h.send({ type: 'rtc-frame', id: 7, generation: 2, frame: current, frameId: 2 });
  assert.equal(latest(h, 'frame').frame, current); assert.equal(h.cancelled(), 0);
});

test('worker delivery retains bounded transfer credit across a video-only generation reset', async t => {
  const h = await workerHarness(t); h.enqueue(config(1)); await settle();
  const first = frame(); h.send({ type: 'rtc-frame', id: 7, generation: 1, frame: first, frameId: 1 });
  const transfer = latest(h, 'frame');
  h.send({ type: 'video-generation', id: 7, generation: 2 }); h.enqueue(config(2, 2)); await settle();
  const next = frame(); h.send({ type: 'rtc-frame', id: 7, generation: 2, frame: next, frameId: 2 });
  assert.equal(h.messages.filter(value => value.type === 'frame').length, 1);
  h.send({ type: 'frame-ack', frameId: transfer.frameId });
  assert.equal(latest(h, 'frame').frame, next);
});

test('a video processing failure remains video-only and closes incoming late frames', async t => {
  const h = await workerHarness(t); h.enqueue(config(1)); await settle();
  h.send({ type: 'video-error', id: 7, reason: 'rtc-video-processor-unavailable' });
  assert.equal(latest(h, 'video-error').reason, 'rtc-video-processor-unavailable');
  assert.equal(h.cancelled(), 0);
  const late = frame(); h.send({ type: 'rtc-frame', id: 7, generation: 1, frame: late, frameId: 1 }); assert.equal(late.closed, 1);
});

test('worker Canvas success and the current main-thread Canvas proof cancel presentation waiting', async t => {
  let tick, now = 100;
  t.mock.method(globalThis, 'setInterval', callback => { tick = callback; return 1; });
  for (const canvas of [true, false]) {
    const h = await workerHarness(t, { canvas, now: () => now, firstFrameWaitMs: 1000 });
    h.enqueue(config(1)); await settle();
    h.send({ type: 'rtc-frame', id: 7, generation: 1, frame: frame(), frameId: 1 });
    if (!canvas) h.send({ type: 'video-presented', id: 7, epoch: 1, generation: 1 });
    now += 2000; tick();
    assert.equal(latest(h, 'video-error'), undefined);
    if (canvas) assert.equal(latest(h, 'decoded').epoch, 1);
    h.send({ type: 'stop' });
  }
});

test('a retired main-thread Canvas proof cannot acknowledge the new worker generation', async t => {
  let tick, now = 100;
  t.mock.method(globalThis, 'setInterval', callback => { tick = callback; return 1; });
  const h = await workerHarness(t, { now: () => now, firstFrameWaitMs: 1000 });
  h.enqueue(config(1)); await settle(); h.send({ type: 'rtc-frame', id: 7, generation: 1, frame: frame(), frameId: 1 });
  const previous = latest(h, 'frame');
  h.send({ type: 'video-generation', id: 7, generation: 2 }); h.enqueue(config(2, 2)); await settle();
  h.send({ type: 'frame-ack', frameId: previous.frameId });
  h.send({ type: 'rtc-frame', id: 7, generation: 2, frame: frame(), frameId: 2 });
  for (const value of [{ id: 6, epoch: 2, generation: 2 }, { id: 7, epoch: 1, generation: 2 }, { id: 7, epoch: 1, generation: 1 }])
    h.send({ type: 'video-presented', ...value });
  now = 1100; tick();
  assert.equal(latest(h, 'video-error').reason, 'rtc-video-first-presentation-timeout');
  assert.equal(h.cancelled(), 0, 'only video presentation fails');
});
