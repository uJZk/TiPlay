// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { PcmCapture, readAudioRecords } from '../../site/play/audio-protocol.js';
import { createBrowserAudio } from '../../site/play/audio.js';

function record(samples, { rate = 48000, channels = 1, flags = 0 } = {}) {
  const bytes = new Uint8Array(20 + samples.length * 2), view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length - 4); bytes[4] = 1; bytes[6] = channels; bytes[7] = flags;
  view.setUint32(8, rate);
  samples.forEach((value, i) => view.setInt16(20 + i * 2, value, true));
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

function mockBrowser() {
  const messages = [], contexts = [], sources = [];
  const oldContext = globalThis.AudioContext, oldNode = globalThis.AudioWorkletNode;
  globalThis.AudioContext = class {
    constructor() { this.state = 'suspended'; this.audioWorklet = { addModule: async () => {} }; contexts.push(this); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createMediaStreamSource() { const source = { connect(node) { this.connected = node; }, disconnect() { this.connected = null; } }; sources.push(source); return source; }
  };
  globalThis.AudioWorkletNode = class { constructor() { this.port = { postMessage: value => messages.push(value) }; } connect() {} };
  return { messages, contexts, sources, done() { globalThis.AudioContext = oldContext; globalThis.AudioWorkletNode = oldNode; } };
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

test('capture resampling retains phase and emits exact 20 ms mono packets', () => {
  const sent = [], capture = new PcmCapture(48000, 16000, pcm => sent.push(new Int16Array(pcm)));
  for (let i = 0; i < 375; i++) capture.push(new Float32Array(128).fill(0.5));
  assert.equal(sent.length, 50);
  assert.ok(sent.every(packet => packet.length === 320 && packet.every(value => value === 16384)));
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
  const clipping = new Processor();
  for (const type of [1, 2]) clipping.port.onmessage({ data: { type, rate: 48000, channels: 1, flags: 0, pcm: new Int16Array(128).fill(32767).buffer } });
  clipping.process([], [[left, right]]);
  assert.ok(left.every(value => value === 1), 'overlapping prompts saturate instead of producing out-of-range samples');
  delete globalThis.AudioWorkletProcessor; delete globalThis.registerProcessor; delete globalThis.sampleRate;
});
