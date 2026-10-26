// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAudio } from '../../site/play/audio.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await turn(); }
  assert.fail('Audio dispatch did not make progress');
}
function frame(kind, payload, { type = 0, epoch = 1, rate = 44100, flags = 0, timestamp = 0 } = {}) {
  const size = kind === 7 ? 36 : 28, bytes = new Uint8Array(size + payload.byteLength), view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length - 4); bytes[4] = kind; bytes[5] = type; bytes[6] = 1; bytes[7] = flags;
  view.setUint32(8, rate); view.setUint32(16, epoch); view.setFloat64(20, NaN);
  if (kind === 7) view.setFloat64(28, timestamp);
  bytes.set(payload, size); return bytes;
}
const aac = { codec: 'aac-lc', sampleRate: 44100, channels: 1, asc: [18, 8], samplesPerFrame: 1024 };
const nativeRatePcm = { codec: 'pcm', sampleRate: 48000, channels: 1, bitDepth: 16, littleEndian: true };
const setup = (config = aac, fields = {}) => frame(6, new TextEncoder().encode(JSON.stringify(config)),
  { flags: 2, rate: config.sampleRate ?? 44100, ...fields });

async function harness(t) {
  const saved = { AudioContext: globalThis.AudioContext, AudioWorkletNode: globalThis.AudioWorkletNode, Worker: globalThis.Worker };
  const workers = [], messages = [], contexts = [], sources = [];
  globalThis.AudioContext = class {
    constructor() { this.state = 'suspended'; this.audioWorklet = { addModule: async () => {} }; contexts.push(this); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  };
  globalThis.AudioWorkletNode = class {
    constructor() { this.port = { postMessage: record => {
      messages.push(record);
      if (record.prepare) queueMicrotask(() => this.port.onmessage?.({ data: { prepared: record.prepare.id } }));
    } }; }
    connect() {}
  };
  globalThis.Worker = class {
    constructor() { this.calls = []; this.waiting = []; workers.push(this); }
    postMessage(request) {
      this.calls.push(request.kind);
      if (request.kind === 'decode') this.waiting.push(request);
      else queueMicrotask(() => this.onmessage?.({ data: { id: request.id, backend: 'held-codec', frames: [] } }));
    }
    release(value = 123) {
      const request = this.waiting.shift(); assert.ok(request);
      this.onmessage?.({ data: { id: request.id,
        frames: [{ pcm: new Int16Array([value]).buffer, timestamp: request.timestamp, sampleRate: 48000 }] } });
    }
    terminate() { this.terminated = true; }
  };
  let controller;
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'test' }),
    fetchPhone: async () => ({ ok: true, body: new ReadableStream({ start(value) { controller = value; sources.push(value); } }) }) });
  t.after(() => { audio.dispose(); Object.assign(globalThis, saved); });
  await audio.activate(); audio.attach(new AbortController().signal, { audio: true });
  await until(() => controller);
  return { audio, workers, messages, contexts, sources, send: record => controller.enqueue(record) };
}

test('held AAC cannot hold following 48 kHz PCM/navigation; its own packets and EOS remain ordered', async t => {
  const { workers, messages, send } = await harness(t);
  send(setup()); send(frame(7, Uint8Array.of(1)));
  send(frame(7, Uint8Array.of(2), { timestamp: 20000 }));
  send(setup({ ended: true }));
  send(setup(nativeRatePcm, { type: 1 }));
  send(frame(7, Uint8Array.of(3, 0), { type: 1, rate: 48000 }));
  send(frame(2, new Uint8Array(new Int16Array([55]).buffer), { type: 2, rate: 48000 }));
  await until(() => messages.some(record => record.type === 1 && record.pcm?.byteLength)
    && messages.some(record => record.type === 2 && record.pcm?.byteLength));
  assert.equal(workers[0].waiting.length, 1);
  assert.deepEqual(workers[0].calls, ['init', 'decode']);
  assert.equal(messages.some(record => record.type === 0 && record.ended), false);
  workers[0].release(111);
  await until(() => workers[0].waiting.length === 1);
  workers[0].release(222);
  await until(() => messages.some(record => record.type === 0 && record.ended));
  assert.deepEqual(workers[0].calls, ['init', 'decode', 'decode', 'flush']);
  assert.deepEqual(messages.filter(record => record.type === 0 && record.pcm?.byteLength)
    .map(record => [...new Int16Array(record.pcm)]), [[111], [222]]);
});

test('reset cancels active codec and queued old epoch before accepting a fresh epoch', async t => {
  const { audio, workers, messages, send } = await harness(t);
  send(setup()); send(frame(7, Uint8Array.of(1))); send(frame(7, Uint8Array.of(2)));
  await until(() => workers[0]?.waiting.length === 1);
  audio.reset(); assert.equal(workers[0].terminated, true);
  send(setup(aac, { epoch: 2 })); send(frame(7, Uint8Array.of(3), { epoch: 2 }));
  await until(() => workers[1]?.waiting.length === 1);
  workers[0].release(111); workers[1].release(333);
  await until(() => messages.some(record => record.pcm?.byteLength));
  const pcm = messages.filter(record => record.pcm?.byteLength);
  assert.deepEqual(pcm.map(record => [record.epoch, ...new Int16Array(record.pcm)]), [[2, 333]]);
  assert.deepEqual(workers[0].calls, ['init', 'decode']);
  assert.equal(audio.stats().queuedBytes, 2);
});

test('one codec failure reports an error without cancelling another stream', async t => {
  const { audio, workers, messages, send } = await harness(t);
  send(setup()); send(frame(7, Uint8Array.of(1)));
  await until(() => workers[0]?.waiting.length === 1);
  workers[0].onerror(new Error('broken codec'));
  await until(() => audio.stats().error);
  send(frame(2, new Uint8Array(new Int16Array([77]).buffer), { type: 2, rate: 48000 }));
  await until(() => messages.some(record => record.type === 2 && record.pcm?.byteLength));
  assert.match(audio.stats().error, /worker failed/);
  assert.equal(messages.filter(record => record.type === 0 && record.pcm?.byteLength).length, 0);
});

test('context suspension retires codec owners and resume reopens one fresh subscription', async t => {
  const { audio, workers, messages, contexts, sources, send } = await harness(t);
  send(setup()); send(frame(7, Uint8Array.of(1)));
  await until(() => workers[0]?.waiting.length === 1);
  contexts[0].state = 'suspended'; contexts[0].onstatechange();
  assert.equal(workers[0].terminated, true); assert.equal(audio.stats().queuedBytes, 0);
  contexts[0].state = 'running'; contexts[0].onstatechange();
  await until(() => sources.length === 2);
  send(setup(aac, { epoch: 2 })); send(frame(7, Uint8Array.of(2), { epoch: 2 }));
  await until(() => workers[1]?.waiting.length === 1);
  workers[0].release(111); workers[1].release(222);
  await until(() => messages.some(record => record.pcm?.byteLength));
  assert.deepEqual(messages.filter(record => record.pcm?.byteLength)
    .map(record => [record.epoch, ...new Int16Array(record.pcm)]), [[2, 222]]);
  assert.equal(sources.length, 2);
});
