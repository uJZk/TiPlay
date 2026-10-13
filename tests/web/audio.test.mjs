// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { PcmCapture, readAudioRecords } from '../../site/play/audio-protocol.js';
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
  for (const [bits, mode] of [[0, 'carplay'], [4, 'airplay-mirror'], [8, 'airplay-video']]) {
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
    const timed = record([1, 2], { flags: 9 }); new DataView(timed.buffer).setFloat64(20, 950);
    controller.enqueue(record([], { flags: 2 })); controller.enqueue(timed);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, [['mode', 'airplay-video'], ['timing']], 'empty reset cannot select CarPlay; the real audio selects its policy before measurement');
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

test('audio disable and connection stop release capture and reset speaker credit', async () => {
  const browser = mockBrowser(), oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let stopped = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }) } } });
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }), fetchPhone: async () => ({ ok: true, body: body([]) }) });
  try {
    await audio.activate();
    const connection = new AbortController(); audio.attach(connection.signal, { audio: true });
    audio.status({ audio: true, mic: { active: true, sampleRate: 16000 } });
    await audio.activateMicrophone();
    assert.equal(audio.stats().microphone, true);
    audio.status({ audio: false, mic: { active: true, sampleRate: 16000 } });
    assert.equal(audio.stats().microphone, false); assert.equal(stopped, 1);
    assert.ok(browser.messages.some(value => value.reset));
    audio.status({ audio: true, mic: { active: true, sampleRate: 24000 } });
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(browser.messages.some(value => value.captureRate === 24000), 'previously granted capture follows next negotiated rate');
    connection.abort(); assert.equal(audio.stats().microphone, false); assert.equal(stopped, 2);
  } finally {
    audio.dispose(); browser.done();
    Object.defineProperty(globalThis, 'navigator', oldNavigator);
  }
});

test('capture permission resolving after microphone demand ends stops every track', async () => {
  const browser = mockBrowser(), oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let resolveCapture, stopped = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { resolveCapture = resolve; }) } } });
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }), fetchPhone: async () => ({ ok: true, body: body([]) }) });
  try {
    await audio.activate(); audio.attach(new AbortController().signal, { audio: true });
    audio.status({ mic: { active: true, sampleRate: 16000 } });
    const pending = audio.activateMicrophone();
    audio.status({ mic: { active: false, sampleRate: 16000 } });
    resolveCapture({ getTracks: () => [{ stop() { stopped++; } }] });
    await pending;
    assert.equal(stopped, 1); assert.equal(audio.stats().microphone, false);
  } finally { audio.dispose(); browser.done(); Object.defineProperty(globalThis, 'navigator', oldNavigator); }
});

test('malformed and truncated PCM frames fail before publication', async () => {
  for (const bytes of [record([1], { channels: 2 }), record([1], { rate: 1 }), record([1]).subarray(0, 21), Uint8Array.of(0, 8, 0, 0)]) {
    await assert.rejects(async () => { for await (const _ of readAudioRecords(body([bytes]))) {} });
  }
});

test('page startup requests permission, releases idle capture, and new demand captures automatically', async () => {
  const browser = mockBrowser(), oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let requests = 0, stopped = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => {
    requests++; return { getTracks: () => [{ stop() { stopped++; } }] };
  } } } });
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }), fetchPhone: async () => ({ ok: true, body: body([]) }) });
  try {
    audio.start(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests, 1); assert.equal(stopped, 1); assert.equal(audio.stats().microphone, false);
    audio.attach(new AbortController().signal, { audio: true });
    audio.status({ mic: { active: true, sampleRate: 48000 } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests, 2); assert.equal(audio.stats().microphone, true);
    assert.ok(browser.sources[0].connected, 'capture source is connected to the processing node');
    assert.ok(browser.messages.some(value => value.captureRate === 48000));
    audio.status({ mic: { active: false, sampleRate: 48000 } });
    assert.equal(stopped, 2);
  } finally { audio.dispose(); browser.done(); Object.defineProperty(globalThis, 'navigator', oldNavigator); }
});

test('denied capture retries on next demand without prompting on status heartbeats', async () => {
  const browser = mockBrowser(), oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let requests = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => { requests++; throw new Error('Permission denied'); } } } });
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }), fetchPhone: async () => ({ ok: true, body: body([]) }) });
  try {
    await audio.activate(); audio.attach(new AbortController().signal, { audio: true });
    audio.status({ mic: { active: true, sampleRate: 16000 } });
    await new Promise(resolve => setImmediate(resolve));
    for (let i = 0; i < 20; i++) audio.status({ mic: { active: true, sampleRate: 16000 } });
    assert.equal(requests, 1);
    audio.status({ mic: { active: false, sampleRate: 16000 } });
    audio.status({ mic: { active: true, sampleRate: 16000 } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests, 2);
  } finally { audio.dispose(); browser.done(); Object.defineProperty(globalThis, 'navigator', oldNavigator); }
});

test('inactive microphone HTTP reply ends capture quietly while other upload failures remain visible', async () => {
  for (const reply of ['microphone-inactive', 'other-conflict']) {
    const browser = mockBrowser(), oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } } });
    const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }), fetchPhone: async route => route.startsWith('/microphone?')
      ? { ok: false, status: 409, json: async () => ({ error: reply }) } : { ok: true, body: body([]) } });
    try {
      await audio.activate(); audio.attach(new AbortController().signal, { audio: true });
      audio.status({ mic: { active: true, sampleRate: 16000 } });
      await new Promise(resolve => setImmediate(resolve));
      for (let i = 0; i < 2; i++) browser.nodes[0].port.onmessage({ data: { microphone: new Int16Array(320).buffer, peak: 0 } });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(audio.stats().microphone, false);
      assert.equal(audio.stats().rejectedMicrophoneUploads, 1);
      assert.equal(audio.stats().error, reply === 'microphone-inactive' ? null : 'Microphone HTTP 409');
    } finally { audio.dispose(); browser.done(); Object.defineProperty(globalThis, 'navigator', oldNavigator); }
  }
});

test('late inactive upload response from a retired capture cannot stop the next demand', async () => {
  const browser = mockBrowser(), oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let resolveUpload;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } } });
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }), fetchPhone: async route => route.startsWith('/microphone?')
    ? new Promise(resolve => { resolveUpload = resolve; }) : { ok: true, body: body([]) } });
  try {
    await audio.activate(); audio.attach(new AbortController().signal, { audio: true });
    audio.status({ mic: { active: true, sampleRate: 16000 } });
    await new Promise(resolve => setImmediate(resolve));
    for (let i = 0; i < 2; i++) browser.nodes[0].port.onmessage({ data: { microphone: new Int16Array(320).buffer, peak: 0 } });
    audio.status({ mic: { active: false, sampleRate: 16000 } });
    audio.status({ mic: { active: true, sampleRate: 16000 } });
    await new Promise(resolve => setImmediate(resolve));
    resolveUpload({ ok: false, status: 409, json: async () => ({ error: 'microphone-inactive' }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(audio.stats().microphone, true); assert.equal(audio.stats().error, null);
  } finally { audio.dispose(); browser.done(); Object.defineProperty(globalThis, 'navigator', oldNavigator); }
});

test('capture resampling retains phase and emits exact 20 ms mono packets', () => {
  const sent = [], capture = new PcmCapture(48000, 16000, pcm => sent.push(new Int16Array(pcm)));
  for (let i = 0; i < 375; i++) capture.push(new Float32Array(128).fill(0.5));
  assert.equal(sent.length, 50);
  assert.ok(sent.every(packet => packet.length === 320 && packet.every(value => value === 16384)));
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

test('capture keeps producing packets after transferring each PCM buffer to the main thread', () => {
  const sent = [], capture = new PcmCapture(48000, 48000, pcm => sent.push(new Int16Array(structuredClone(pcm, { transfer: [pcm] }))));
  for (let i = 0; i < 375; i++) capture.push(new Float32Array(128).fill(0.5));
  assert.equal(sent.length, 49);
  assert.ok(sent.every(packet => packet.length === 960 && packet.every(value => value === 16384)));
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
