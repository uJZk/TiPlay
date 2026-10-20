// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createMediaTiming, createTimedFrames, createVideoEpochGuard } from '../../site/play/media-timing.js';
import { createFrameDelivery } from '../../site/play/transport.js';
import { createFramePresenter } from '../../site/play/video.js';
import { constantDelay } from '../../site/play/delay-plan.js';

// Execute the actual worker message handler with a deterministic decoder and clock.
// This tests messages crossing the scheduling boundary, rather than matching code text.
async function workerHarness() {
  let callbacks, at = 1000, reportStats;
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
    createMediaTiming: change => createMediaTiming(change, () => at),
    createVideoEpochGuard, createFrameDelivery,
    createChunkStream: () => { throw new Error('unexpected port feed'); },
    setInterval: callback => { reportStats = callback; return 1; }, clearInterval() {},
  });
  return {
    messages,
    send: data => self.onmessage({ data }),
    post: message => callbacks.post(message),
    stats() { reportStats(); return messages.filter(message => message.type === 'stats').at(-1).stats; },
    frame(frame, config, id, timing, source) { callbacks.present(frame, config, id, timing, source); },
    advance(value) {
      at = value;
      for (const [id, timer] of timers) if (timer.at <= at) { timers.delete(id); timer.callback(); }
    },
  };
}
function frame() { return { closed: 0, close() { this.closed++; } }; }
function latest(harness, type) { return harness.messages.filter(message => message.type === type).at(-1); }

test('worker diagnostic policy comes from its actual scheduling owner and retains a short touch', async () => {
  const h = await workerHarness();
  h.send({ type: 'stream', id: 7, stream: {} });
  h.post({ type: 'config', id: 7, config: { epoch: 1, mode: 'carplay' } });
  h.frame(frame(), { epoch: 1, mode: 'carplay' }, 7, 900);
  assert.equal(h.stats().policyVideoTargetMs, 120); assert.equal(h.stats().policyVideoReadinessMs, 100);
  assert.equal(h.stats().policyVideoMarginMs, 20); assert.equal(h.stats().playbackProfile, 'carplay');
  h.send({ type: 'interaction', active: true }); h.send({ type: 'interaction', active: true });
  h.send({ type: 'interaction', active: false });
  h.advance(2000);
  const measured = h.stats();
  assert.equal(measured.playbackProfile, 'carplay-touch'); assert.equal(measured.policyVideoTargetMs, 0);
  assert.equal(measured.policyVideoMarginMs, 0); assert.equal(measured.policyInteractionActive, false);
  assert.equal(measured.policyHoldRemainingMs, 0); assert.equal(measured.policyInteractionStarts, 1);
  assert.equal(measured.policyInteractionReleases, 1);
});

test('worker schedules CarPlay without a main-thread readiness round trip', async () => {
  const h = await workerHarness(), picture = frame();
  h.send({ type: 'stream', id: 7, stream: {} });
  h.post({ type: 'config', id: 7, config: { epoch: 1, mode: 'carplay' } });
  h.frame(picture, { epoch: 1, mode: 'carplay' }, 7, 1010);
  assert.equal(latest(h, 'media-ready').id, 7, 'main thread still receives audio-buffer observations');
  h.advance(1030);
  assert.equal(latest(h, 'frame').frame, picture, 'the worker owns its readiness plan without awaiting a main-thread ACK');
  h.advance(1100);
  assert.equal(picture.closed, 0, 'ownership transferred before the busy main thread returned');
});

test('worker epoch reset closes pending pictures before installing the new local plan', async () => {
  const h = await workerHarness(), old = frame(), next = frame();
  h.send({ type: 'stream', id: 1, stream: {} });
  h.post({ type: 'config', id: 1, config: { epoch: 1, mode: 'carplay' } });
  h.frame(old, { epoch: 1, mode: 'carplay' }, 1, 1050);
  assert.equal(latest(h, 'frame'), undefined);
  h.post({ type: 'idle', id: 1 });
  assert.equal(old.closed, 1);
  h.post({ type: 'config', id: 1, config: { epoch: 2, mode: 'carplay' } });
  h.frame(next, { epoch: 2, mode: 'carplay' }, 1, 1050);
  h.advance(1070);
  assert.equal(latest(h, 'frame').frame, next);
});

test('worker discards decoded pictures beyond the independent 300ms source ceiling', async () => {
  const h = await workerHarness(), picture = frame();
  h.send({ type: 'stream', id: 1, stream: {} });
  h.post({ type: 'config', id: 1, config: { epoch: 1, mode: 'carplay' } });
  h.advance(1311);
  h.frame(picture, { epoch: 1, mode: 'carplay' }, 1, 1010);
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
  const presenter = createFramePresenter(canvas, { applyTimingPolicy: true, now: () => 1301 });
  const picture = frame();
  presenter.present(picture, { epoch: 1, mode: 'carplay' }, 1000);
  assert.equal(picture.closed, 1);
  assert.equal(presenter.stats().expiredFrames, 1);
});

test('worker transfers audio output evidence without narrowing the independent video deadline', async () => {
  const h = await workerHarness(), picture = frame();
  h.send({ type: 'stream', id: 1, stream: {} });
  h.post({ type: 'config', id: 1, config: { epoch: 1, mode: 'carplay' } });
  h.send({ type: 'audio-output', reference: { mode: 'carplay', type: 0, epoch: 7, generation: 2, clockGeneration: 3,
    sequence: 1, state: 'playing', at: 1000, sourceTimeMs: 5000, audibleTimeMs: 1150,
    mediaRate: 1, uncertaintyMs: 1, outputMethod: 'timestamp' } });
  h.frame(picture, { mode: 'carplay', epoch: 1 }, 1, 1050, { sourceTimeMs: 5000, clockGeneration: 3 });
  h.advance(1025); assert.equal(latest(h, 'frame'), undefined);
  h.advance(1070);
  const transfer = latest(h, 'frame');
  assert.equal(transfer.frame, picture);
  assert.equal(transfer.outputWindow.audioAt, 1150);
  assert.equal(transfer.outputWindow.uncertaintyMs, 1);
  assert.equal(transfer.outputWindow.latest, undefined, 'audio evidence does not add a video gate');
  assert.equal(transfer.outputWindow.epoch, 7, 'video and audio producer epochs remain independent');
});

test('worker keeps invalid audio evidence explicit while continuing independently available video', async () => {
  const h = await workerHarness(), picture = frame();
  h.send({ type: 'stream', id: 1, stream: {} });
  h.post({ type: 'config', id: 1, config: { epoch: 1, mode: 'carplay' } });
  const reference = { mode: 'carplay', type: 0, epoch: 7, generation: 2, sequence: 1,
    state: 'playing', at: 1000, sourceTimeMs: 5000, audibleTimeMs: 1150, mediaRate: 1 };
  h.send({ type: 'audio-output', reference });
  h.send({ type: 'audio-output', reference: { ...reference, sequence: 2, state: 'rebuffering', audibleTimeMs: null } });
  h.frame(picture, { mode: 'carplay', epoch: 1 }, 1, 1050, { sourceTimeMs: 5000 });
  h.advance(1070);
  assert.equal(picture.closed, 0);
  assert.equal(latest(h, 'frame').frame, picture);
  assert.equal(latest(h, 'frame').outputWindow.audioAt, undefined);
});

test('worker interaction messages accelerate only the pending video plan', async () => {
  const ordinary = await workerHarness(), touched = await workerHarness();
  for (const h of [ordinary, touched]) {
    h.send({ type: 'stream', id: 1, stream: {} });
    h.post({ type: 'config', id: 1, config: { epoch: 1, mode: 'carplay' } });
    h.frame(frame(), { mode: 'carplay', epoch: 1 }, 1, 1050);
  }
  touched.send({ type: 'interaction', active: true });
  for (const h of [ordinary, touched]) h.advance(1065);
  assert.equal(latest(ordinary, 'frame'), undefined);
  assert.ok(latest(touched, 'frame'), 'touch selects decoded video sooner without a main-thread readiness round trip');
});
