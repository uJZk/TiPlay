import { SoftwareWorker } from './live-worker.mjs';
// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readAudioRecords } from '../../site/play/audio-protocol.js';
import { createBrowserAudio } from '../../site/play/audio.js';
import { audioDelayAt } from '../../site/play/playback-window.js';
import { constantDelay, delayAt, planDelay } from '../../site/play/delay-plan.js';
import { browserDiagnosticEvents } from '../../site/play/browser-diagnostics.js';

function record(samples, { rate = 48000, channels = 1, flags = 0, type = 0 } = {}) {
  const bytes = new Uint8Array(28 + samples.length * 2), view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length - 4); bytes[4] = 2; bytes[6] = channels; bytes[7] = flags;
  bytes[5] = type;
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

test('mirror soundtrack keeps its own channel beside CarPlay and rejects an unlabelled mirror', async () => {
  const values = [];
  for await (const value of readAudioRecords(body([record([10]), record([20], { type: 6, flags: 4 })]))) values.push(value);
  assert.deepEqual(values.map(value => [value.type, value.mode]), [[0, 'carplay'], [6, 'airplay-mirror']]);
  await assert.rejects(async () => { for await (const _ of readAudioRecords(body([record([20], { type: 6 })]))) {} });
});

test('unsigned extended CarPlay stream IDs preserve framing and reject AirPlay-mode aliases', async () => {
  const values = [];
  for await (const value of readAudioRecords(body([record([10], { type: 128 }), record([20], { type: 255 })]))) values.push(value);
  assert.deepEqual(values.map(value => value.type), [128, 255]);
  await assert.rejects(async () => { for await (const _ of readAudioRecords(body([record([20], { type: 255, flags: 4 })]))) {} });
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

test('source-timed and untimed CarPlay guidance keep independent diagnostics and media readiness', async () => {
  const browser = mockBrowser(); let controller;
  const timing = [], queued = [];
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }),
    onTiming: (...value) => timing.push(value), onQueued: value => queued.push(value),
    fetchPhone: async () => ({ ok: true, body: new ReadableStream({ start(value) { controller = value; } }) }) });
  try {
    await audio.activate(); audio.attach(new AbortController().signal, { audio: true });
    await new Promise(resolve => setImmediate(resolve));
    const at = performance.timeOrigin + performance.now(); audio.clock({ offset: at - 1000, at, rtt: 2 });
    const untimed = record([1000, 1000], { type: 1 });
    controller.enqueue(untimed); await new Promise(resolve => setImmediate(resolve));
    assert.equal(audio.stats().arrivalAnchoredPackets, 1);
    assert.equal(audio.stats().timedPackets, 0);
    const guidance = record([1000, 1000], { type: 1 }); new DataView(guidance.buffer).setFloat64(20, 1000);
    controller.enqueue(guidance); await new Promise(resolve => setImmediate(resolve));
    assert.equal(audio.stats().timedPackets, 1);
    assert.equal(audio.stats().arrivalAnchoredPackets, 1);
    assert.deepEqual(timing, []); assert.deepEqual(queued, []);
    const media = record([1000, 1000]); new DataView(media.buffer).setFloat64(20, 1000);
    controller.enqueue(media); await new Promise(resolve => setImmediate(resolve));
    assert.equal(timing.length, 1); assert.deepEqual(queued, ['carplay']);
  } finally { audio.dispose(); browser.done(); }
});

function mockBrowser({ failFirstModuleLoad = false } = {}) {
  let moduleLoads = 0;
  const messages = [], contexts = [], sources = [], nodes = [];
  const oldContext = globalThis.AudioContext, oldNode = globalThis.AudioWorkletNode;
  globalThis.AudioContext = class {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.audioWorklet = { addModule: async () => { if (++moduleLoads === 1 && failFirstModuleLoad) throw new Error('Temporary worklet fetch failure'); } }; contexts.push(this); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createMediaStreamSource() { const source = { connect(node) { this.connected = node; }, disconnect() { this.connected = null; } }; sources.push(source); return source; }
  };
  globalThis.AudioWorkletNode = class { constructor() { this.port = { postMessage: value => {
    messages.push(value); if (value.prepare) queueMicrotask(() => this.port.onmessage?.({ data: { prepared: value.prepare.id } }));
  } }; nodes.push(this); } connect() {} };
  return { messages, contexts, sources, nodes, get moduleLoads() { return moduleLoads; }, done() { globalThis.AudioContext = oldContext; globalThis.AudioWorkletNode = oldNode; } };
}

test('actual Standard audio stats carry deadline faults without Debug or video-reference telemetry', async () => {
  const browser = mockBrowser(), notifications = [], firstFaults = [];
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }),
    fetchPhone: async () => ({ ok: true, body: new ReadableStream({}) }),
    onSourceDeadline: event => { firstFaults.push(event.first); notifications.push(browserDiagnosticEvents({ audio: audio.stats() }, false, false)[0]); },
  });
  try {
    await audio.activate();
    await new Promise(resolve => setImmediate(resolve));
    const generation = browser.messages.filter(value => value.reset).length;
    const publish = (fields = {}) => browser.nodes[0].port.onmessage({ data: { playout: {
      mode: 'carplay', type: 0, epoch: 1, generation, state: 'recovering',
      sourceDeadlineState: 'violated', sourceDeadlineReason: 'source-deadline',
      sourceDeltaUpperMs: 305, sourceDeadlineRejectedFrames: 128, ...fields,
    } } });
    publish();
    assert.deepEqual(firstFaults, [true]);
    const event = notifications.at(-1);
    assert.equal(audio.stats().debug, undefined);
    assert.equal(event.v['audio.sourceDeadlineState'], 'violated');
    assert.equal(event.v['audio.sourceDeadlineReason'], 'source-deadline');
    assert.equal(event.v['audio.sourceDeltaUpperMs'], 305);
    assert.equal(event.v['audio.sourceDeadlineRejectedFrames'], 128);
    assert.equal(event.v['audio.sourceDeadlineStream'], 'carplay-0');
    assert.equal(event.v['audio.sourceDeadlineEpoch'], 1);
    const before = notifications.length;
    publish();
    assert.equal(notifications.length, before, 'the same cumulative rejection is not sent again');
    publish({ sourceDeadlineRejectedFrames: 256 });
    assert.deepEqual(firstFaults, [true, false], 'additional rejected blocks are cumulative updates, not new immediate faults');
    publish({ epoch: 2, sourceDeadlineRejectedFrames: 64 });
    assert.deepEqual(firstFaults, [true, false, true], 'a new epoch retains its first fault');
    assert.equal(audio.stats().sourceDeadlineRejectedFrames, 320, 'epoch replacement adds only its new rejected frames');
    audio.reset();
    publish({ epoch: 1, sourceDeadlineRejectedFrames: 128 });
    assert.equal(audio.stats().sourceDeadlineRejectedFrames, 320, 'retired playback-generation feedback is ignored');
  } finally { audio.dispose(); browser.done(); }
});

test('alternating healthy and unknown audio streams do not flood immediate Standard diagnostics', async () => {
  const browser = mockBrowser(); let notifications = 0;
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }),
    fetchPhone: async () => ({ ok: true, body: new ReadableStream({}) }), onSourceDeadline: () => notifications++ });
  try {
    await audio.activate();
    await new Promise(resolve => setImmediate(resolve));
    const generation = browser.messages.filter(value => value.reset).length;
    for (let i = 0; i < 100; i++) for (const type of [0, 1]) browser.nodes[0].port.onmessage({ data: { playout: {
      mode: 'carplay', type, epoch: 1, generation, state: 'playing',
      sourceDeadlineState: type ? 'unknown' : 'within-bound',
      sourceDeadlineReason: type ? 'source-anchor-unavailable' : null,
      sourceDeltaUpperMs: type ? null : 100, sourceDeadlineRejectedFrames: 0,
    } } });
    assert.equal(notifications, 1, 'only the first important unavailable reason is sent immediately');
    assert.equal(audio.stats().sourceDeadlineState, 'unknown');
    assert.equal(audio.stats().sourceDeadlineStream, 'carplay-1');
    assert.equal(audio.stats().sourceDeadlineRejectedFrames, 0);
  } finally { audio.dispose(); browser.done(); }
});

test('a transient worklet load failure can recover without refreshing a running context', async () => {
  for (const retry of ['gesture', 'attach']) {
    const browser = mockBrowser({ failFirstModuleLoad: true });
    let requests = 0;
    const audio = createBrowserAudio({
      credentials: () => ({ code: '1234', session: 'session' }),
      fetchPhone: async () => { requests++; return { ok: true, body: new ReadableStream({}) }; },
    });
    try {
      await audio.activate(); await new Promise(resolve => setImmediate(resolve));
      assert.equal(browser.contexts[0].state, 'running');
      assert.equal(browser.nodes.length, 0);
      assert.match(audio.stats().error, /Temporary worklet fetch failure/);
      if (retry === 'gesture') {
        audio.gesture(); await new Promise(resolve => setImmediate(resolve));
      }
      audio.attach(new AbortController().signal, { audio: true });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(browser.moduleLoads, 2, `${retry} retries the failed module`);
      assert.equal(browser.contexts.length, 1, 'the existing context is reused');
      assert.equal(browser.nodes.length, 1);
      assert.equal(requests, 1, 'the recovered processor starts the audio transport');
      assert.equal(audio.stats().error, null);
    } finally { audio.dispose(); browser.done(); }
  }
});

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
    assert.equal(audio.stats().browserMuted, false);
    assert.equal(audio.stats().sound, true);
    assert.equal(audio.stats().bluetooth, 'active');
  } finally { audio.dispose(); browser.done(); Object.defineProperty(globalThis, 'navigator', descriptor); }
});

test('Bluetooth route records preserve buffered music, playback credit and the running clock', async () => {
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
    await new Promise(resolve => setImmediate(resolve));
    const resets = browser.messages.filter(value => value.reset).length;
    const first = browser.messages.find(value => value.pcm?.byteLength);
    assert.equal(browser.messages.some(value => Object.hasOwn(value, 'clockBase')), false);
    controller.enqueue(route(1, true)); controller.enqueue(record([20, 20]));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(audio.stats().queuedBytes, 8);
    assert.equal(audio.stats().browserMuted, false);
    assert.equal(browser.messages.filter(value => value.pcm?.byteLength).length, 2);
    controller.enqueue(route(3, false)); controller.enqueue(route(2, true)); controller.enqueue(record([30, 30]));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(audio.stats().browserMuted, false);
    const pcm = browser.messages.filter(value => value.pcm?.byteLength);
    assert.equal(pcm.length, 3); assert.deepEqual([...new Int16Array(pcm.at(-1).pcm)], [30, 30]);
    assert.equal(pcm.at(-1).generation, first.generation, 'route changes retain queued playback');
    assert.equal(browser.messages.filter(value => value.reset).length, resets);
    assert.equal(browser.messages.some(value => Object.hasOwn(value, 'clockBase')), false);
    browser.nodes[0].port.onmessage({ data: { consumed: 4, generation: first.generation } });
    assert.equal(audio.stats().queuedBytes, 8, 'pre-call music still releases its playback credit');
  } finally { audio.dispose(); browser.done(); }
});

test('Bluetooth state and failures preserve the audio connection while rejecting obsolete status', async () => {
  const browser = mockBrowser(), requests = [];
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }),
    fetchPhone: async (_, { signal }) => { let controller;
      const response = { ok: true, body: new ReadableStream({ start(value) { controller = value; } }) };
      requests.push({ signal, controller }); return response;
    } });
  try {
    await audio.activate(); audio.attach(new AbortController().signal, { audio: true });
    await new Promise(resolve => setImmediate(resolve));
    const current = requests.at(-1), requestCount = requests.length;
    const resets = browser.messages.filter(value => value.reset).length;
    audio.status({ voice: { revision: 1, muted: true, state: 'connecting' } });
    current.controller.enqueue(record([99]));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(current.signal.aborted, false);
    assert.equal(requests.length, requestCount);
    assert.equal(browser.messages.filter(value => value.pcm?.byteLength).length, 1);
    audio.status({ voice: { revision: 2, muted: true, state: 'failed', error: 'car-bluetooth-unavailable' } });
    assert.equal(audio.stats().error, 'car-bluetooth-unavailable');
    audio.status({ voice: { revision: 3, muted: true, state: 'releasing' } });
    assert.equal(audio.stats().browserMuted, false);
    assert.equal(audio.stats().bluetooth, 'releasing');
    assert.equal(audio.stats().sound, true);
    audio.status({ voice: { revision: 4, muted: false, state: 'idle', error: null } });
    audio.status({ voice: { revision: 2, muted: true, state: 'failed', error: 'obsolete-error' } });
    current.controller.enqueue(record([7]));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(audio.stats().error, null);
    assert.equal(audio.stats().bluetooth, 'idle');
    assert.equal(audio.stats().queuedBytes, 4);
    assert.equal(requests.length, requestCount);
    assert.equal(browser.messages.filter(value => value.reset).length, resets);
    assert.deepEqual([...new Int16Array(browser.messages.filter(value => value.pcm?.byteLength).at(-1).pcm)], [7]);
  } finally { audio.dispose(); browser.done(); }
});

test('malformed and truncated PCM frames fail before publication', async () => {
  for (const bytes of [record([1], { channels: 2 }), record([1], { rate: 1 }), record([1]).subarray(0, 21), Uint8Array.of(0, 8, 0, 0)]) {
    await assert.rejects(async () => { for await (const _ of readAudioRecords(body([bytes]))) {} });
  }
});
test('speaker credit is isolated across resets without deriving an epoch from the context getter', async () => {
  const browser = mockBrowser(); let controller;
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }), fetchPhone: async () => ({ ok: true, body: new ReadableStream({ start(value) { controller = value; } }) }) });
  try {
    await audio.activate(); audio.attach(new AbortController().signal, { audio: true });
    await new Promise(resolve => setImmediate(resolve));
    controller.enqueue(record([1, 2])); await new Promise(resolve => setImmediate(resolve));
    const first = browser.messages.find(value => value.pcm);
    browser.contexts[0].currentTime = 100;
    controller.enqueue(record([3, 4])); await new Promise(resolve => setImmediate(resolve));
    assert.equal(browser.messages.some(value => Object.hasOwn(value, 'clockBase')), false);
    audio.reset(); controller.enqueue(record([5, 6])); await new Promise(resolve => setImmediate(resolve));
    assert.equal(audio.stats().queuedBytes, 4);
    browser.nodes[0].port.onmessage({ data: { consumed: 4, generation: first.generation } });
    assert.equal(audio.stats().queuedBytes, 4, 'retired packet completion cannot spend new credit');
    const current = browser.messages.filter(value => value.pcm).at(-1);
    browser.nodes[0].port.onmessage({ data: { consumed: 4, generation: current.generation } });
    assert.equal(audio.stats().queuedBytes, 0);
  } finally { audio.dispose(); browser.done(); }
});

test('an unreadable main-thread context getter cannot interrupt PCM publication or diagnostics', async () => {
  const browser = mockBrowser(); let controller;
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }),
    fetchPhone: async () => ({ ok: true, body: new ReadableStream({ start(value) { controller = value; } }) }) });
  try {
    await audio.activate(); audio.attach(new AbortController().signal, { audio: true });
    await new Promise(resolve => setImmediate(resolve));
    Object.defineProperty(browser.contexts[0], 'currentTime', { get() { throw new Error('Unusable graph getter'); } });
    audio.debug(true);
    controller.enqueue(record([17, -31, 52]));
    await new Promise(resolve => setImmediate(resolve));
    const published = browser.messages.filter(value => value.pcm?.byteLength);
    assert.equal(published.length, 1);
    assert.deepEqual([...new Int16Array(published[0].pcm)], [17, -31, 52]);
    assert.equal(audio.stats().queuedBytes, 6);
    assert.equal(audio.stats().error, null);
    assert.equal(audio.stats().debug.contextTimeMs, null);
    assert.equal(audio.stats().debug.renderAgeMs, null);
    assert.equal(browser.messages.some(value => Object.hasOwn(value, 'clockBase')), false);
  } finally { audio.dispose(); browser.done(); }
});

test('two seconds of buffered music cannot block a following low-rate navigation packet', async () => {
  const previousWorker = globalThis.Worker; globalThis.Worker = SoftwareWorker;
  const browser = mockBrowser(); let controller;
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }), fetchPhone: async () => ({ ok: true, body: new ReadableStream({ start(value) { controller = value; } }) }) });
  try {
    await audio.activate(); audio.attach(new AbortController().signal, { audio: true });
    await new Promise(resolve => setImmediate(resolve));
    const music = record(new Array(1920).fill(1), { channels: 2, flags: 1 });
    for (let i = 0; i < 100; i++) controller.enqueue(music);
    const navigation = record(new Array(320).fill(2), { rate: 8000 }); navigation[5] = 1; controller.enqueue(navigation);
    await new Promise(resolve => setImmediate(resolve));
    for (let i=0;i<200 && !browser.messages.some(r=>r.type===1 && r.pcm?.byteLength);i++) await new Promise(r=>setTimeout(r,5));
    const sent = browser.messages.filter(value => value.pcm?.byteLength);
    assert.equal(sent.length, 101);
    assert.equal(sent.at(-1).type, 1, 'navigation posts without waiting for any music completion');
  } finally { audio.dispose(); browser.done(); globalThis.Worker = previousWorker; }
});

test('cancelling a pending DataChannel audio read releases its subscription without waiting for a packet', async () => {
  let cancelled = 0;
  const abort = new AbortController();
  const source = new ReadableStream({ cancel() { cancelled++; } });
  const records = readAudioRecords(source, abort.signal);
  const next = records.next();
  await new Promise(resolve => setImmediate(resolve));
  abort.abort();
  assert.equal((await next).done, true);
  assert.equal(cancelled, 1);
  assert.equal(source.locked, false);
});

test('DataChannel audio shares the existing playback path and reopens a fresh subscription after disable', async () => {
  const browser = mockBrowser();
  const sources = [];
  let opened = 0, cancelled = 0, http = 0;
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'session' }), fetchPhone: () => { http++; throw new Error('Unexpected HTTP media'); } });
  try {
    await audio.activate();
    audio.attach(new AbortController().signal, { audio: true }, () => {
      opened++;
      return new ReadableStream({ start(controller) { sources.push(controller); }, cancel() { cancelled++; } });
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(opened, 1);
    sources[0].enqueue(record([1, 2, 3]));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(audio.stats().queuedBytes, 6);
    audio.status({ audio: false });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled, 1);
    audio.status({ audio: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(opened, 2);
    assert.equal(audio.stats().queuedBytes, 0);
    assert.equal(http, 0);
  } finally { audio.dispose(); browser.done(); }
});
