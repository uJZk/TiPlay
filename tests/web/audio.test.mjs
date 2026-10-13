// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readAudioRecords } from '../../site/play/audio-protocol.js';
import { createBrowserAudio } from '../../site/play/audio.js';
import { audioDelayAt } from '../../site/play/playback-window.js';
import { createFramePresenter } from '../../site/play/video.js';
import { constantDelay, delayAt, planDelay } from '../../site/play/delay-plan.js';

function record(samples, { rate = 48000, channels = 1, flags = 0 } = {}) {
  const bytes = new Uint8Array(28 + samples.length * 2), view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length - 4); bytes[4] = 2; bytes[6] = channels; bytes[7] = flags;
  view.setUint32(8, rate); view.setFloat64(20, NaN);
  samples.forEach((value, i) => view.setInt16(28 + i * 2, value, true));
  return bytes;
}
const body = chunks => new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); } });

test('PCM framing survives arbitrary network boundaries and skips keepalives', async () => {
  const bytes = record([-32768, 0, 32767]);
  const chunks = [new Uint8Array(4), ...Array.from(bytes, byte => Uint8Array.of(byte))];
  const records = [];
  for await (const value of readAudioRecords(body(chunks))) records.push(value);
  assert.equal(records.length, 1);
  assert.equal(records[0].rate, 48000);
  assert.deepEqual([...new Int16Array(records[0].pcm)], [-32768, 0, 32767]);
});

test('audio mode flags retain buffered/reset flags and notify policy before timing without video config', async () => {
  for (const [bits, mode] of [[0, 'carplay'], [4, 'airplay-mirror']]) {
    const records = [];
    for await (const value of readAudioRecords(body([record([1], { flags: bits | 3 })]))) records.push(value);
    assert.equal(records[0].mode, mode); assert.equal(records[0].flags & 3, 3);
  }
  const browser = mockBrowser(); let controller;
  const events = [], audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }), onMode: mode => events.push(['mode', mode]), onTiming: () => events.push(['timing']), fetchPhone: async () => ({ ok: true, body: new ReadableStream({ start(value) { controller = value; } }) }) });
  try {
    await audio.activate(); audio.attach(new AbortController().signal, { audio: true });
    await new Promise(resolve => setImmediate(resolve));
    const now = performance.timeOrigin + performance.now(); audio.clock({ offset: now - 1000, at: now, rtt: 2 });
    const timed = record([1, 2], { flags: 5 }); new DataView(timed.buffer).setFloat64(20, 950);
    controller.enqueue(record([], { flags: 2 })); controller.enqueue(timed);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, [['mode', 'airplay-mirror'], ['timing']], 'empty reset cannot select CarPlay; the real audio selects its policy before measurement');
  } finally { audio.dispose(); browser.done(); }
});

test('empty stream reset is neither played PCM nor a clock fallback sample', async () => {
  const browser = mockBrowser();
  let queued = 0;
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }),
    onQueued: () => queued++, fetchPhone: async () => ({ ok: true, body: body([record([], { flags: 2 })]) }) });
  try {
    await audio.activate();
    audio.attach(new AbortController().signal, { audio: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(queued, 0, 'a reset must leave the initial delay free to follow the first real media sample');
    assert.equal(audio.stats().fallbackPackets, 0);
  } finally { audio.dispose(); browser.done(); }
});

function mockBrowser() {
  const messages = [], contexts = [], sources = [], nodes = [];
  const oldContext = globalThis.AudioContext, oldNode = globalThis.AudioWorkletNode;
  globalThis.AudioContext = class {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.audioWorklet = { addModule: async () => {} }; contexts.push(this); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createMediaStreamSource() { const source = { connect(node) { this.connected = node; }, disconnect() { this.connected = null; } }; sources.push(source); return source; }
  };
  globalThis.AudioWorkletNode = class { constructor() { this.port = { postMessage: value => messages.push(value) }; nodes.push(this); } connect() {} };
  return { messages, contexts, sources, nodes, done() { globalThis.AudioContext = oldContext; globalThis.AudioWorkletNode = oldNode; } };
}

test('startup and Bluetooth demand never ask the browser for capture or permissions', async () => {
  const browser = mockBrowser(), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let prompts = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia() { prompts++; throw new Error('Unexpected browser capture'); } },
    permissions: { query() { prompts++; throw new Error('Unexpected browser permission'); } },
  } });
  const routes = [];
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }),
    fetchPhone: async route => { routes.push(route); return { ok: true, body: body([]) }; } });
  try {
    audio.start(); await new Promise(resolve => setImmediate(resolve));
    audio.attach(new AbortController().signal, { audio: true });
    audio.status({ voice: { revision: 1, state: 'connecting', muted: true } });
    audio.gesture();
    audio.status({ voice: { revision: 2, state: 'active', muted: true } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(prompts, 0);
    assert.ok(routes.every(route => route.startsWith('/audio?')));
    assert.equal(audio.stats().browserMuted, true);
    assert.equal(audio.stats().sound, false);
  } finally { audio.dispose(); browser.done(); Object.defineProperty(globalThis, 'navigator', descriptor); }
});

test('ordered route records clear buffered music, discard demand audio, and resume only fresh PCM', async () => {
  const browser = mockBrowser(); let controller;
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }),
    fetchPhone: async () => ({ ok: true, body: new ReadableStream({ start(value) { controller = value; } }) }) });
  const route = (revision, muted) => {
    const bytes = record([], { flags: muted ? 16 : 0 }); bytes[5] = 5;
    new DataView(bytes.buffer).setUint32(16, revision); return bytes;
  };
  try {
    await audio.activate(); audio.attach(new AbortController().signal, { audio: true });
    await new Promise(resolve => setImmediate(resolve));
    controller.enqueue(record([10, 10], { flags: 1 }));
    controller.enqueue(route(1, true)); controller.enqueue(record([20, 20]));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(audio.stats().queuedBytes, 0);
    assert.equal(audio.stats().browserMuted, true);
    assert.equal(browser.messages.filter(value => value.pcm?.byteLength).length, 1);
    controller.enqueue(route(3, false)); controller.enqueue(route(2, true)); controller.enqueue(record([30, 30]));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(audio.stats().browserMuted, false, 'retired mute cannot undo release');
    const pcm = browser.messages.filter(value => value.pcm?.byteLength);
    assert.equal(pcm.length, 2); assert.deepEqual([...new Int16Array(pcm.at(-1).pcm)], [30, 30]);
  } finally { audio.dispose(); browser.done(); }
});

test('route status overtaking an HTTP body retires it and reports failure without a capture fallback', async () => {
  const browser = mockBrowser(), requests = [];
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }),
    fetchPhone: async (_, { signal }) => { let controller;
      const response = { ok: true, body: new ReadableStream({ start(value) { controller = value; } }) };
      requests.push({ signal, controller }); return response;
    } });
  try {
    await audio.activate(); audio.attach(new AbortController().signal, { audio: true });
    await new Promise(resolve => setImmediate(resolve));
    const old = requests.at(-1);
    audio.status({ voice: { revision: 1, muted: true, state: 'connecting' } });
    old.controller.enqueue(record([99]));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(old.signal.aborted, true);
    assert.equal(browser.messages.filter(value => value.pcm?.byteLength).length, 0);
    audio.status({ voice: { revision: 2, muted: true, state: 'failed', error: 'car-bluetooth-unavailable' } });
    assert.equal(audio.stats().error, 'car-bluetooth-unavailable');
    audio.status({ voice: { revision: 3, muted: true, state: 'releasing' } });
    assert.equal(audio.stats().browserMuted, true);
    audio.status({ voice: { revision: 4, muted: false, state: 'idle', error: null } });
    await new Promise(resolve => setImmediate(resolve));
    requests.at(-1).controller.enqueue(record([7]));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(audio.stats().error, null);
    assert.deepEqual([...new Int16Array(browser.messages.filter(value => value.pcm?.byteLength).at(-1).pcm)], [7]);
  } finally { audio.dispose(); browser.done(); }
});

test('malformed and truncated PCM frames fail before publication', async () => {
  for (const bytes of [record([1], { channels: 2 }), record([1], { rate: 1 }), record([1]).subarray(0, 21), Uint8Array.of(0, 8, 0, 0)]) {
    await assert.rejects(async () => { for await (const _ of readAudioRecords(body([bytes]))) {} });
  }
});
test('speaker credit is isolated across resets and the context clock is anchored once', async () => {
  const browser = mockBrowser(); let controller;
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }), fetchPhone: async () => ({ ok: true, body: new ReadableStream({ start(value) { controller = value; } }) }) });
  try {
    await audio.activate(); audio.attach(new AbortController().signal, { audio: true });
    await new Promise(resolve => setImmediate(resolve));
    controller.enqueue(record([1, 2])); await new Promise(resolve => setImmediate(resolve));
    const first = browser.messages.find(value => value.pcm), firstBase = browser.messages.find(value => value.clockBase !== undefined).clockBase;
    browser.contexts[0].currentTime = 100;
    controller.enqueue(record([3, 4])); await new Promise(resolve => setImmediate(resolve));
    assert.equal(browser.messages.filter(value => value.clockBase !== undefined).at(-1).clockBase, firstBase);
    audio.reset(); controller.enqueue(record([5, 6])); await new Promise(resolve => setImmediate(resolve));
    assert.equal(audio.stats().queuedBytes, 4);
    browser.nodes[0].port.onmessage({ data: { consumed: 4, generation: first.generation } });
    assert.equal(audio.stats().queuedBytes, 4, 'retired packet completion cannot spend new credit');
    const current = browser.messages.filter(value => value.pcm).at(-1);
    browser.nodes[0].port.onmessage({ data: { consumed: 4, generation: current.generation } });
    assert.equal(audio.stats().queuedBytes, 0);
  } finally { audio.dispose(); browser.done(); }
});

test('two seconds of buffered music cannot block a following low-rate navigation packet', async () => {
  const browser = mockBrowser(); let controller;
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }), fetchPhone: async () => ({ ok: true, body: new ReadableStream({ start(value) { controller = value; } }) }) });
  try {
    await audio.activate(); audio.attach(new AbortController().signal, { audio: true });
    await new Promise(resolve => setImmediate(resolve));
    const music = record(new Array(1920).fill(1), { channels: 2, flags: 1 });
    for (let i = 0; i < 100; i++) controller.enqueue(music);
    const navigation = record(new Array(320).fill(2), { rate: 8000 }); navigation[5] = 1; controller.enqueue(navigation);
    await new Promise(resolve => setImmediate(resolve));
    const sent = browser.messages.filter(value => value.pcm);
    assert.equal(sent.length, 101);
    assert.equal(sent.at(-1).type, 1, 'navigation posts without waiting for any music completion');
  } finally { audio.dispose(); browser.done(); }
});

test('worklet mixes separate streams and bounds an unpaced music producer', async () => {
  let Processor;
  globalThis.sampleRate = 48000;
  globalThis.AudioWorkletProcessor = class { constructor() { this.messages = []; this.port = { postMessage: message => this.messages.push(message) }; } };
  globalThis.registerProcessor = (_, processor) => { Processor = processor; };
  await import('../../site/play/audio-worklet.js');
  const processor = new Processor();
  const publish = (type, count, value, flags = 0) => processor.port.onmessage({ data: { type, rate: 48000, channels: 1, flags, pcm: new Int16Array(count).fill(value).buffer } });
  publish(0, 128, 8192); publish(1, 128, 8192);
  const left = new Float32Array(128), right = new Float32Array(128);
  processor.process([], [[left, right]]);
  assert.ok(left.every(value => Math.abs(value - 0.3) < 0.00001), 'guidance ducks music'); assert.deepEqual(left, right);
  for (let i = 0; i < 100; i++) publish(0, 4800, 1, 1);
  assert.ok(processor.streams.get(0).frames <= 96000);
  assert.ok(processor.messages.some(message => message.consumed));
  const live = new Processor();
  for (let i = 0; i < 20; i++) live.port.onmessage({ data: { type: 1, rate: 48000, channels: 1, flags: 0, pcm: new Int16Array(4800).fill(i === 19 ? 16384 : 0).buffer } });
  assert.equal(live.streams.get(1).frames, 9600, 'live queue retains at most 250 ms');
  const timed = new Processor();
  globalThis.currentTime = 0;
  timed.port.onmessage({ data: { plans: { video: constantDelay(60), audio: constantDelay(60) }, clockBase: 1060 } });
  const publishTimed = (type, epoch, sourceTime) => timed.port.onmessage({ data: {
    type, epoch, sourceTime, sequence: 0, rate: 48000, channels: 1, flags: 0, pcm: new Int16Array(480).fill(8192).buffer,
  } });
  publishTimed(0, 1, 1000); publishTimed(1, 1, 1000);
  timed.process([], [[left, right]]);
  assert.ok(left.every(value => Math.abs(value - 0.3) < 0.00001), 'timestamped guidance ducks timestamped music at the shared deadline');
  publishTimed(1, 2, 1010);
  assert.equal(timed.timelines.get(0).epoch, 1, 'guidance epoch does not reset music');
  publishTimed(1, 1, 1000);
  assert.equal(timed.timelines.get(1).epoch, 2, 'retired epoch cannot replace the new timeline');
  timed.port.onmessage({ data: { type: 1, epoch: 1, rate: 48000, channels: 1, sourceTime: NaN, flags: 2, pcm: new ArrayBuffer(0) } });
  assert.equal(timed.timelines.get(1).epoch, 2, 'retired fallback reset cannot clear timestamped playback');
  timed.port.onmessage({ data: { reset: true } });
  assert.equal(timed.timelines.size, 0);
  const smooth = new Processor();
  let plan = planDelay(constantDelay(60), 80, 1060);
  smooth.port.onmessage({ data: { plans: { video: plan, audio: plan }, clockBase: 1060 } });
  smooth.port.onmessage({ data: { type: 0, epoch: 1, sequence: 0, rate: 48000, channels: 1, sourceTime: 1000, flags: 1, pcm: new Int16Array(48000).fill(16384).buffer } });
  for (let block = 0; block < 200; block++) {
    globalThis.currentTime = block * 128 / 48000;
    if (block === 100) { plan = planDelay(plan, 60, 1060 + currentTime * 1000); smooth.port.onmessage({ data: { plans: { video: plan, audio: plan } } }); }
    smooth.process([], [[left, right]]);
    assert.ok(left.every(value => value === 0.5), 'actual worklet keeps continuous PCM audible during both delay ramps');
    const wall = 1060 + (currentTime + 127 / 48000) * 1000;
    assert.ok(Math.abs(smooth.timelines.get(0).through - (wall - delayAt(plan, wall))) < 0.000001);
  }
  for (const [rawAudioDelay, audioWall, videoWall] of [[0, 1055, 1100], [1000, 1205, 1080]]) {
    globalThis.currentTime = 0;
    const matched = new Processor(), plans = { video: constantDelay(80), audio: constantDelay(rawAudioDelay) };
    matched.port.onmessage({ data: { plans, clockBase: audioWall } });
    matched.port.onmessage({ data: { type: 0, epoch: 1, sequence: 0, rate: 48000, channels: 1, sourceTime: 1000, flags: 0, pcm: new Int16Array(480).fill(16384).buffer } });
    matched.port.onmessage({ data: { type: 0, epoch: 1, sequence: 1, rate: 48000, channels: 1, sourceTime: 700, flags: 0, pcm: new Int16Array(480).fill(8192).buffer } });
    matched.process([], [[left, right]]); assert.equal(left[0], 0.5, 'expired audio is discarded and matching audio remains audible');
    assert.equal(audioWall - audioDelayAt(plans, audioWall), 1000);
    const submitted = [], canvas = { width: 800, height: 480, getContext: type => type === '2d' ? { fillRect() {}, drawImage(frame) { submitted.push({ source: frame.timestamp, at: videoWall }); } } : null, removeEventListener() {} };
    const presenter = createFramePresenter(canvas, { now: () => videoWall, videoPlan: () => plans.video });
    presenter.present({ timestamp: 1000, displayWidth: 800, displayHeight: 480, close() {} }, { epoch: 1, mode: 'carplay' }, 1000);
    assert.equal(submitted.length, 1);
    const actualOffset = audioWall - submitted[0].at;
    assert.ok(actualOffset >= -45 && actualOffset <= 125, 'actual worklet sample versus matching canvas submission stays within the accepted window');
    assert.ok(matched.messages.some(message => message.consumed === 960), 'too-late PCM never makes video wait');
    presenter.dispose();
  }
  delete globalThis.currentTime;
  const clipping = new Processor();
  for (const type of [1, 2]) clipping.port.onmessage({ data: { type, rate: 48000, channels: 1, flags: 0, pcm: new Int16Array(128).fill(32767).buffer } });
  clipping.process([], [[left, right]]);
  assert.ok(left.every(value => value === 1), 'overlapping prompts saturate instead of producing out-of-range samples');
  delete globalThis.AudioWorkletProcessor; delete globalThis.registerProcessor; delete globalThis.sampleRate;
});
