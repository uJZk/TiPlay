// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { createBrowserAudio } from '../../site/play/audio.js';
import { SoftwareWorker } from './live-worker.mjs';

let Processor, processorPort;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = processorPort; } };
globalThis.registerProcessor = (_, value) => { Processor = value; };
globalThis.sampleRate = 48000; globalThis.currentFrame = 0;
await import('../../site/play/audio-worklet.js?main-ledger');

async function until(check) {
  for (let i = 0; i < 300; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Direct audio ledger did not settle');
}
function pcm(epoch = 1) {
  const bytes = new Uint8Array(28 + 3200 * 2), view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length - 4); bytes[4] = 2; bytes[6] = 1;
  view.setUint32(8, 32000); view.setUint32(16, epoch); view.setFloat64(20, NaN);
  new Int16Array(bytes.buffer, 28).fill(12000); return bytes;
}

test('browser audio direct PCM ledger counts actual Worklet admission and ignores retired generation credit', async t => {
  const saved = { AudioContext: globalThis.AudioContext, AudioWorkletNode: globalThis.AudioWorkletNode, Worker: globalThis.Worker };
  const nodes = [], mainMessages = [];
  globalThis.Worker = SoftwareWorker;
  globalThis.AudioContext = class {
    constructor() { this.state = 'suspended'; this.sampleRate = 48000; this.audioWorklet = { addModule: async () => {} }; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  };
  globalThis.AudioWorkletNode = class {
    constructor(_, __, options) {
      const pair = new MessageChannel(); processorPort = pair.port1; this.port = pair.port2;
      this.processor = new Processor(options); nodes.push(this);
      this.port.addEventListener('message', event => mainMessages.push(event.data));
    }
    connect() {}
    disconnect() { this.processor.message({ dispose: true }); this.processor.port.close(); this.port.close(); }
  };
  let controller;
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'test' }),
    fetchPhone: async () => ({ ok: true, body: new ReadableStream({ start(value) { controller = value; } }) }) });
  t.after(() => { audio.dispose(); Object.assign(globalThis, saved); });
  await audio.activate(); audio.attach(new AbortController().signal, { audio: true });
  await until(() => controller);
  audio.debug(true); controller.enqueue(pcm());
  const processor = nodes[0].processor;
  await until(() => processor.streams.get(0)?.queueBytes > 0 && audio.stats().queuedBytes > 0);
  assert.equal(audio.stats().queuedBytes, processor.streams.get(0).queueBytes);
  assert.ok(audio.stats().debug.pcmNonzero > 0);
  assert.ok(audio.stats().debug.decoder.nonzero > 0);
  const received = mainMessages.filter(message => message.directPcm);
  assert.ok(received.length);
  for (const message of received) for (const record of message.directPcm.records) assert.equal(record.pcm, undefined);
  const generation = processor.generation;
  audio.reset(); await until(() => processor.generation !== generation);
  assert.equal(audio.stats().queuedBytes, 0);
  controller.enqueue(pcm(2));
  await until(() => processor.streams.get(0)?.epoch === 2 && audio.stats().queuedBytes > 0);
  const before = audio.stats().queuedBytes;
  processor.port.postMessage({ consumed: before, generation });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(audio.stats().queuedBytes, before, 'old generation credit cannot free replacement PCM');
  for (let i = 0; i < 100; i++) {
    processor.process([], [[new Float32Array(480), new Float32Array(480)]]);
    globalThis.currentFrame += 480;
  }
  await until(() => audio.stats().queuedBytes === 0);
});
