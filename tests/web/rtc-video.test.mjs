// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRtcTrackReader, createRtcVideoPipeline, rtcVideoCodecs, phoneSupportsRtcVideo, RTC_VIDEO_TRANSPORT } from '../../site/play/rtc-video.js';
import { createFramePresenter } from '../../site/play/video.js';
import { RECORD, encodeRecord } from '../../site/play/link.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const frame = () => ({ closed: 0, close() { this.closed++; } });
const config = (epoch, videoTransport = RTC_VIDEO_TRANSPORT, videoGeneration = 1, fields = {}) => encodeRecord({ kind: RECORD.CONFIG, epoch,
  payload: new TextEncoder().encode(JSON.stringify({ codec: 'avc1.640028', mode: 'carplay', width: 800, height: 480, fps: 60, videoTransport, videoGeneration, ...fields })) });

test('capability discovery gates RTP offers for old phones and only admits passthrough codecs', async () => {
  assert.equal(await phoneSupportsRtcVideo(async () => ({ ok: true, json: async () => ({ app: 'TiPlay', protocol: 1 }) })), false);
  assert.equal(await phoneSupportsRtcVideo(async () => ({ ok: true, json: async () => ({ app: 'TiPlay', protocol: 1, videoTransport: RTC_VIDEO_TRANSPORT }) })), true);
  assert.equal(await phoneSupportsRtcVideo(async () => { throw Error('offline'); }), false);
  assert.deepEqual(rtcVideoCodecs({ getCapabilities: () => ({ codecs: [{ mimeType: 'video/VP8' }, { mimeType: 'video/H264' }, { mimeType: 'video/H265' }] }) }),
    [{ mimeType: 'video/H264' }, { mimeType: 'video/H265' }]);
});

test('track reader requests a one-frame queue, releases reader and closes a frame that races cancellation', async () => {
  let resolveRead, releases = 0, cancels = 0, options;
  const mine = frame(), presented = [], errors = [];
  class Processor {
    constructor(value) { options = value; this.readable = { getReader: () => ({
      read: () => new Promise(resolve => { resolveRead = resolve; }), cancel: async () => { cancels++; }, releaseLock() { releases++; },
    }) }; }
  }
  const reader = createRtcTrackReader({ Processor, present: value => presented.push(value), onError: error => errors.push(error) });
  const track = new EventTarget(); track.kind = 'video';
  const pending = reader.read(track);
  assert.equal(options.maxBufferSize, 1);
  reader.stop(); resolveRead({ value: mine, done: false }); await pending;
  assert.equal(mine.closed, 1); assert.equal(presented.length, 0); assert.equal(releases, 1); assert.equal(cancels, 1); assert.equal(errors.length, 0);
});

test('track reader passes ownership without a video element and suppresses retirement errors', async () => {
  let controller, cancelled = 0;
  class Processor { constructor() { this.readable = new ReadableStream({ start(value) { controller = value; }, cancel() { cancelled++; } }); } }
  const received = [], errors = [], track = new EventTarget(); track.kind = 'video';
  const reader = createRtcTrackReader({ Processor, present: value => { received.push(value); value.close(); }, onError: error => errors.push(error) });
  const pending = reader.read(track), mine = frame();
  controller.enqueue(mine); await settle();
  assert.deepEqual(received, [mine]); assert.equal(mine.closed, 1);
  reader.close(); await pending;
  assert.equal(cancelled, 1); assert.equal(errors.length, 0);
});

test('native frames are fenced by current metadata and never instantiate an application decoder', async t => {
  let controller;
  const posted = [], drawn = [];
  t.mock.method(globalThis, 'setInterval', () => 1);
  const pipeline = createRtcVideoPipeline({ post: value => posted.push(value), present: value => { drawn.push(value); value.close(); } });
  t.after(() => pipeline.stop());
  pipeline.read(9, new ReadableStream({ start(value) { controller = value; } }));
  const early = frame(); pipeline.trackFrame(early); assert.equal(early.closed, 0);
  controller.enqueue(config(1)); await settle();
  const native = frame(); pipeline.trackFrame(native);
  assert.deepEqual(drawn, [early, native]); assert.equal(early.closed, 1); assert.equal(pipeline.stats().videoTransport, RTC_VIDEO_TRANSPORT);
  controller.enqueue(encodeRecord({ kind: RECORD.IDLE, epoch: 1 })); await settle();
  const late = frame(); pipeline.trackFrame(late); assert.equal(late.closed, 1); assert.equal(drawn.length, 2);
  // Returning to another source cannot revive a stale RTP track on this peer.
  controller.enqueue(config(2)); await settle();
  assert.equal(posted.at(-1).type, 'video-error'); assert.equal(posted.at(-1).reason, 'video-source-changed-reconnect-required');
});

test('a legacy video configuration is rejected without a fallback decoder or peer retirement', async t => {
  let controller;
  t.mock.method(globalThis, 'setInterval', () => 1);
  const messages = [], drawn = [];
  const pipeline = createRtcVideoPipeline({ post: value => messages.push(value), present: value => { drawn.push(value); value.close(); } });
  t.after(() => pipeline.stop());
  pipeline.read(9, new ReadableStream({ start(value) { controller = value; } }));
  controller.enqueue(config(1)); await settle(); pipeline.trackFrame(frame());
  // No VideoDecoder in this fixture: fallback must report unsupported rather than
  // falsely showing stale RTP frames under the new source's epoch.
  controller.enqueue(config(2, 'webrtc-datachannel-v1')); await settle();
  const late = frame(); pipeline.trackFrame(late);
  assert.equal(late.closed, 1); assert.equal(drawn.length, 1);
  assert.equal(messages.some(value => value.type === 'end'), false);
  assert.equal(messages.at(-1).type, 'video-error'); assert.equal(messages.at(-1).reason, 'rtc-video-required');
});

test('native presentation draws browser-decoded pictures immediately', () => {
  const drawn = [], canvas = { width: 800, height: 480,
    getContext: name => name === '2d' ? { fillRect() {}, drawImage(value) { drawn.push(value); } } : null,
    removeEventListener() {},
  };
  const presenter = createFramePresenter(canvas);
  const mine = frame(); presenter.present(mine, { width: 800, height: 480, streamId: 2, epoch: 1, videoTransport: RTC_VIDEO_TRANSPORT }, null);
  assert.deepEqual(drawn, [mine]); presenter.dispose(); assert.equal(mine.closed, 1);
});

test('a native source with live metadata but no first decoded frame reports a video-only error once', async t => {
  let controller, tick, now = 100;
  t.mock.method(globalThis, 'setInterval', callback => { tick = callback; return 1; });
  t.mock.method(performance, 'now', () => now);
  const messages = [];
  const pipeline = createRtcVideoPipeline({ post: value => messages.push(value), present: value => value.close(), firstFrameWaitMs: 1000 });
  t.after(() => pipeline.stop());
  pipeline.read(9, new ReadableStream({ start(value) { controller = value; } }));
  controller.enqueue(config(1)); await settle();
  now = 1099; tick();
  assert.equal(messages.some(value => value.type === 'video-error'), false);
  now = 1100; tick(); tick();
  assert.equal(messages.filter(value => value.type === 'video-error').length, 1);
  assert.equal(messages.some(value => value.type === 'end'), false, 'the shared peer must stay alive');
  assert.equal(pipeline.usesTrack(), false, 'failed video is stopped without falling back');
});

test('a decoded native first frame cancels the startup deadline without requiring recurring video frames', async t => {
  let controller, tick, now = 100;
  t.mock.method(globalThis, 'setInterval', callback => { tick = callback; return 1; });
  t.mock.method(performance, 'now', () => now);
  const messages = [];
  const pipeline = createRtcVideoPipeline({ post: value => messages.push(value), present: value => value.close(), firstFrameWaitMs: 1000 });
  t.after(() => pipeline.stop());
  pipeline.read(9, new ReadableStream({ start(value) { controller = value; } }));
  controller.enqueue(config(1)); await settle();
  pipeline.trackFrame(frame());
  now = 5000; tick();
  assert.equal(messages.some(value => value.type === 'video-error'), false);
});

test('one static RTP picture arriving before CONFIG renders after metadata and never falsely times out', async t => {
  let controller, tick, now = 100;
  t.mock.method(globalThis, 'setInterval', callback => { tick = callback; return 1; });
  const messages = [], order = [], drawn = [];
  const pipeline = createRtcVideoPipeline({ now: () => now, firstFrameWaitMs: 1000,
    post: value => { messages.push(value); if (value.type === 'config') order.push('config'); },
    present: (value, metadata, id) => { order.push('present'); drawn.push({ value, metadata, id }); value.close(); } });
  t.after(() => pipeline.stop());
  pipeline.read(9, new ReadableStream({ start(value) { controller = value; } }));
  const early = frame(); pipeline.trackFrame(early, 1);
  assert.equal(early.closed, 0); assert.equal(drawn.length, 0, 'no rendering under unknown metadata');
  controller.enqueue(config(7)); await settle();
  assert.deepEqual(order, ['config', 'present']);
  assert.equal(drawn[0].value, early); assert.equal(drawn[0].metadata.epoch, 7); assert.equal(drawn[0].id, 9);
  assert.equal(early.closed, 1); assert.equal(pipeline.stats().decoded, 1);
  now = 5000; tick();
  assert.equal(messages.some(value => value.type === 'video-error'), false);
  assert.equal(pipeline.stats().errorReason, null);
});

test('pending native pictures retain only the latest frame until the first matching CONFIG', async t => {
  let controller;
  t.mock.method(globalThis, 'setInterval', () => 1);
  const drawn = [], pipeline = createRtcVideoPipeline({ post() {}, present: value => { drawn.push(value); value.close(); } });
  t.after(() => pipeline.stop());
  pipeline.read(1, new ReadableStream({ start(value) { controller = value; } }));
  const frames = Array.from({ length: 4 }, frame);
  for (const value of frames) pipeline.trackFrame(value, 1);
  assert.deepEqual(frames.map(value => value.closed), [1, 1, 1, 0]);
  assert.equal(pipeline.stats().decoded, 0);
  controller.enqueue(config(1)); await settle();
  controller.enqueue(config(1)); await settle();
  assert.deepEqual(drawn, [frames[3]]); assert.deepEqual(frames.map(value => value.closed), [1, 1, 1, 1]);
});

test('retiring, idling or rejecting the source closes its pending native picture exactly once', async t => {
  t.mock.method(globalThis, 'setInterval', () => 1);
  const actions = {
    stop: pipeline => pipeline.stop(),
    replacement: pipeline => pipeline.read(2, new ReadableStream()),
    generation: pipeline => pipeline.resetGeneration(2),
    failure: pipeline => pipeline.fail('rtc-video-track-ended'),
    idle: (_, controller) => controller.enqueue(encodeRecord({ kind: RECORD.IDLE })),
    invalid: (_, controller) => controller.enqueue(encodeRecord({ kind: RECORD.CONFIG, payload: new TextEncoder().encode('null') })),
    malformed: (_, controller) => controller.enqueue(encodeRecord({ kind: RECORD.CONFIG, payload: new TextEncoder().encode('{') })),
    legacy: (_, controller) => controller.enqueue(config(1, 'webrtc-datachannel-v1')),
  };
  for (const [name, action] of Object.entries(actions)) {
    let controller;
    const drawn = [], pipeline = createRtcVideoPipeline({ post() {}, present: value => drawn.push(value) });
    pipeline.read(1, new ReadableStream({ start(value) { controller = value; } }));
    const early = frame(); pipeline.trackFrame(early, 1);
    action(pipeline, controller); await settle();
    assert.equal(early.closed, 1, name); assert.deepEqual(drawn, [], name);
    pipeline.stop(); assert.equal(early.closed, 1, `${name}: disposal does not close it twice`);
  }
});

test('pending pictures never cross video generations or consume an old-generation CONFIG', async t => {
  let controller;
  t.mock.method(globalThis, 'setInterval', () => 1);
  const drawn = [], pipeline = createRtcVideoPipeline({ post() {}, present: value => { drawn.push(value); value.close(); } });
  t.after(() => pipeline.stop());
  pipeline.read(1, new ReadableStream({ start(value) { controller = value; } }));
  const old = frame(); pipeline.trackFrame(old, 1);
  pipeline.resetGeneration(2); assert.equal(old.closed, 1);
  const stale = frame(); pipeline.trackFrame(stale, 1); assert.equal(stale.closed, 1);
  const current = frame(); pipeline.trackFrame(current, 2);
  controller.enqueue(encodeRecord({ kind: RECORD.END, payload: new TextEncoder().encode('retired-source') }));
  controller.enqueue(config(1)); await settle();
  assert.equal(current.closed, 0); assert.deepEqual(drawn, []);
  controller.enqueue(config(2, RTC_VIDEO_TRANSPORT, 2)); await settle();
  assert.deepEqual(drawn, [current]); assert.equal(current.closed, 1);
});

test('pending mirror pictures receive the same HDR rejection as pictures arriving after CONFIG', async t => {
  let controller;
  t.mock.method(globalThis, 'setInterval', () => 1);
  const messages = [], drawn = [], pipeline = createRtcVideoPipeline({ post: value => messages.push(value), present: value => drawn.push(value) });
  t.after(() => pipeline.stop());
  pipeline.read(1, new ReadableStream({ start(value) { controller = value; } }));
  const early = { ...frame(), colorSpace: { transfer: 'smpte2084' } }; pipeline.trackFrame(early, 1);
  controller.enqueue(config(1, RTC_VIDEO_TRANSPORT, 1, { mode: 'airplay-mirror' })); await settle();
  assert.equal(early.closed, 1); assert.deepEqual(drawn, []);
  assert.equal(messages.at(-1).type, 'video-error'); assert.equal(messages.at(-1).reason, 'hdr');
  assert.equal(pipeline.stats().errorReason, 'hdr');
});

test('synchronous CONFIG retirement cannot present a pending picture under a replacement owner', async t => {
  t.mock.method(globalThis, 'setInterval', () => 1);
  for (const action of ['stop', 'reset', 'fail']) {
    let controller;
    const drawn = [], pipeline = createRtcVideoPipeline({
      post: value => { if (value.type === 'config') {
        if (action === 'stop') pipeline.stop();
        else if (action === 'reset') pipeline.resetGeneration(2);
        else pipeline.fail('rtc-video-track-ended');
      } },
      present: value => drawn.push(value),
    });
    pipeline.read(1, new ReadableStream({ start(value) { controller = value; } }));
    const early = frame(); pipeline.trackFrame(early, 1);
    controller.enqueue(config(1)); await settle();
    assert.equal(early.closed, 1, action); assert.deepEqual(drawn, [], action);
    pipeline.stop(); assert.equal(early.closed, 1, action);
  }
});

test('a CONFIG callback failure closes its detached pending frame', async t => {
  let controller;
  t.mock.method(globalThis, 'setInterval', () => 1);
  const drawn = [], pipeline = createRtcVideoPipeline({
    post: value => { if (value.type === 'config') throw Error('presentation consumer failed'); },
    present: value => drawn.push(value),
  });
  t.after(() => pipeline.stop());
  pipeline.read(1, new ReadableStream({ start(value) { controller = value; } }));
  const early = frame(); pipeline.trackFrame(early, 1);
  controller.enqueue(config(1)); await settle();
  assert.equal(early.closed, 1); assert.deepEqual(drawn, []);
  pipeline.stop(); assert.equal(early.closed, 1);
});

test('a CONFIG callback can install the next generation without losing its pending frame', async t => {
  let controller;
  t.mock.method(globalThis, 'setInterval', () => 1);
  const drawn = [], next = frame(), pipeline = createRtcVideoPipeline({
    post: value => { if (value.type === 'config' && value.config.videoGeneration === 1) {
      pipeline.resetGeneration(2); pipeline.trackFrame(next, 2);
    } },
    present: value => { drawn.push(value); value.close(); },
  });
  t.after(() => pipeline.stop());
  pipeline.read(1, new ReadableStream({ start(value) { controller = value; } }));
  const early = frame(); pipeline.trackFrame(early, 1);
  controller.enqueue(config(1)); await settle();
  assert.equal(early.closed, 1); assert.equal(next.closed, 0); assert.deepEqual(drawn, []);
  controller.enqueue(config(2, RTC_VIDEO_TRANSPORT, 2)); await settle();
  assert.deepEqual(drawn, [next]); assert.equal(next.closed, 1);
});

test('a newer frame presented during CONFIG cannot be overwritten by the pending older picture', async t => {
  let controller;
  t.mock.method(globalThis, 'setInterval', () => 1);
  const drawn = [], newer = frame(), pipeline = createRtcVideoPipeline({
    post: value => { if (value.type === 'config') pipeline.trackFrame(newer, 1); },
    present: value => { drawn.push(value); value.close(); },
  });
  t.after(() => pipeline.stop());
  pipeline.read(1, new ReadableStream({ start(value) { controller = value; } }));
  const early = frame(); pipeline.trackFrame(early, 1);
  controller.enqueue(config(1)); await settle();
  assert.deepEqual(drawn, [newer]); assert.equal(early.closed, 1); assert.equal(newer.closed, 1);
});

test('a video-only generation handshake fences delayed metadata END, config and old track frames', async t => {
  let controller, cancelled = 0;
  const messages = [], drawn = [];
  const pipeline = createRtcVideoPipeline({ post: value => messages.push(value), present: value => { drawn.push(value); value.close(); } });
  t.after(() => pipeline.stop());
  pipeline.read(9, new ReadableStream({ start(value) { controller = value; }, cancel() { cancelled++; } }));
  controller.enqueue(config(1)); await settle(); pipeline.trackFrame(frame(), 1);
  controller.enqueue(encodeRecord({ kind: RECORD.END, payload: new TextEncoder().encode('video-renegotiation-required') })); await settle();
  assert.equal(cancelled, 0); assert.equal(messages.at(-1).reason, 'video-renegotiation-required');
  pipeline.resetGeneration(2);
  controller.enqueue(encodeRecord({ kind: RECORD.END, payload: new TextEncoder().encode('old-error') }));
  controller.enqueue(config(1)); await settle();
  const old = frame(); pipeline.trackFrame(old, 1); assert.equal(old.closed, 1);
  controller.enqueue(config(2, RTC_VIDEO_TRANSPORT, 2)); await settle();
  const current = frame(); pipeline.trackFrame(current, 2);
  assert.equal(drawn.length, 2); assert.equal(drawn.at(-1), current);
  assert.equal(messages.filter(value => value.type === 'video-error').length, 1); assert.equal(cancelled, 0);
});

test('invalid video metadata stops only video and a later valid source can request renegotiation', async t => {
  let controller, cancelled = 0;
  const messages = [], pipeline = createRtcVideoPipeline({ post: value => messages.push(value), present: value => value.close() });
  t.after(() => pipeline.stop());
  pipeline.read(9, new ReadableStream({ start(value) { controller = value; }, cancel() { cancelled++; } }));
  controller.enqueue(encodeRecord({ kind: RECORD.CONFIG, payload: new TextEncoder().encode('null') })); await settle();
  assert.equal(messages.at(-1).reason, 'rtc-video-config-invalid'); assert.equal(cancelled, 0);
  controller.enqueue(encodeRecord({ kind: RECORD.END, payload: new TextEncoder().encode('video-renegotiation-required') })); await settle();
  assert.equal(messages.at(-1).reason, 'video-renegotiation-required'); assert.equal(cancelled, 0);
});
