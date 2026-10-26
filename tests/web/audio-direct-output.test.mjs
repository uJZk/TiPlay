// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import { createAirPlayAudioDecoder } from '../../site/play/airplay-audio-decoder.js';
import { createLiveAudioDecoder } from '../../site/play/live-audio-software.js';
import { SoftwareWorker } from './live-worker.mjs';
import { loadFixtures } from '../bench/libav/fixtures.mjs';
let Processor;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = (_, value) => { Processor = value; };
globalThis.sampleRate = 48000; globalThis.currentFrame = 0;
await import('../../site/play/audio-worklet.js?direct-output');
const fixtures = await loadFixtures();
const config = f => ({ codec: f.name.includes('ELD') ? 'aac-eld' : f.codec === 'alac' ? 'alac' : 'aac-lc',
  sampleRate: f.rate, channels: f.channels, bitDepth: 16,
  samplesPerFrame: f.name.includes('ELD') ? Number(f.name.split(' ').at(-1)) : f.codec === 'alac' ? 4096 : 1024,
  ...(f.codec === 'alac' ? { cookie: Array.from(f.asc) } : { asc: Array.from(f.asc) }) });
const setup = c => ({ type: 0, epoch: 1, mode: 'airplay-mirror', flags: 2, rate: c.sampleRate, channels: c.channels, config: c });
const softwareFactory = (c, options) => createLiveAudioDecoder(c, { Worker: SoftwareWorker, ...options });
function harness() {
  const processor = new Processor(), outputs = [], metadata = [], closed = [];
  let hold = false, id = 0;
  const ports = new Map(), events = [];
  const apply = message => {
    if (!message.directPcm) return;
    metadata.push(message);
    const owner = ports.get(message.directPcm.id);
    if (!owner) return;
    const { deliveryId } = message.directPcm;
    const pending = owner.waiters.get(deliveryId);
    if (pending) { owner.waiters.delete(deliveryId); pending.resolve(); }
    else owner.seen.add(deliveryId);
  };
  processor.port.postMessage = message => { if (hold && message.directPcm) events.push(message); else apply(message); };
  const original = processor.message.bind(processor);
  processor.message = record => {
    if (record.pcm?.byteLength) outputs.push({ ...record, pcm: record.pcm.slice(0) });
    return original(record);
  };
  processor.message({ reset: true, generation: 1 });
  return { processor, outputs, metadata, closed,
    hold(value) { hold = value; if (!value) while (events.length) apply(events.shift()); },
    createDirectOutput(record) {
      const channel = new MessageChannel(), owner = { id: ++id, seen: new Set(), waiters: new Map() };
      ports.set(owner.id, owner);
      const base = { ...record, generation: 1, arrivalTimeOrigin: performance.timeOrigin };
      processor.message({ directInput: { id: owner.id, port: channel.port1, record: base } });
      return { id: owner.id, port: channel.port2, record: base,
        wait(deliveryId) {
          if (owner.seen.delete(deliveryId)) return Promise.resolve();
          return new Promise((resolve, reject) => owner.waiters.set(deliveryId, { resolve, reject }));
        },
        close() {
          ports.delete(owner.id); closed.push(owner.id);
          for (const pending of owner.waiters.values()) pending.reject(Error('Output closed.'));
          owner.waiters.clear();
          processor.message({ directClose: { id: owner.id, type: record.type, generation: 1 } });
          channel.port2.close();
        },
      };
    },
    dispose() { processor.message({ dispose: true }); },
  };
}

test('actual decoder Worker transfers PCM directly to Worklet with identical finite output and scalar-only main messages', async () => {
  for (const name of ['AAC-LC 44100 stereo', 'ALAC 44100 stereo', 'AAC-ELD 48000 2ch 512']) {
    const f = fixtures.find(f => f.name === name) || fixtures.find(f => f.codec === 'aac');
    const c = config(f), h = harness(), baseline = [], mainPcm = [], errors = [];
    const direct = createAirPlayAudioDecoder({ onPcm: r => mainPcm.push(r), onError: e => errors.push(e), softwareFactory,
      createDirectOutput: r => h.createDirectOutput(r) });
    const ordinary = createAirPlayAudioDecoder({ onPcm: r => { if (r.pcm.byteLength) baseline.push(r); }, softwareFactory });
    try {
      direct.debug(true);
      assert.equal(await direct.configure(setup(c)), true);
      await ordinary.configure(setup(c));
      for (let i = 0; i < Math.min(3, f.packets.length); i++) {
        const record = { ...setup(c), flags: 0, decodeTimestampUs: i * c.samplesPerFrame * 1e6 / c.sampleRate,
          payload: Uint8Array.from(f.packets[i]).buffer };
        assert.equal(await direct.decode(record), true);
        await ordinary.decode(record);
      }
      await direct.configure({ ...setup(c), config: { ended: true } });
      await ordinary.configure({ ...setup(c), config: { ended: true } });
      assert.deepEqual(errors, []); assert.equal(mainPcm.length, 0, 'main never receives software PCM, including EOF');
      assert.deepEqual(h.outputs.map(r => new Uint8Array(r.pcm)), baseline.map(r => new Uint8Array(r.pcm)), name);
      assert.equal(h.processor.endedEpochs.get(0), 1);
      assert.ok(h.metadata.some(m => m.directPcm.records.some(r => r.pcmStats?.nonzero > 0)));
      for (const message of h.metadata) for (const record of message.directPcm.records) {
        assert.equal(record.pcm, undefined); assert.ok(Number.isInteger(record.pcmBytes));
      }
    } finally { direct.dispose(); ordinary.dispose(); h.dispose(); }
  }
});

test('direct render admission runs without main, while decode completion retains its reservation until main ledger catches up', async () => {
  const h = harness(), c = { codec: 'pcm', sampleRate: 32000, channels: 1, bitDepth: 16, littleEndian: true };
  const decoder = createAirPlayAudioDecoder({ onPcm() { throw Error('PCM returned to main'); }, softwareFactory,
    createDirectOutput: r => h.createDirectOutput(r) });
  try {
    assert.equal(await decoder.configure(setup(c)), true);
    h.hold(true);
    let completed = false;
    const pending = decoder.decode({ ...setup(c), flags: 0, payload: new Int16Array(3200).fill(12000).buffer,
      decodeTimestampUs: 0 }).then(result => { completed = true; return result; });
    for (let i = 0; i < 100 && !h.outputs.length; i++) await delay(5);
    assert.ok(h.outputs.length, 'worklet received PCM while main metadata is held');
    assert.equal(completed, false, 'input reservation cannot be released before main admission');
    h.hold(false); assert.equal(await pending, true);
  } finally { decoder.dispose(); h.dispose(); }
});

test('reset cancels in-flight direct completion, retires ports and prevents old owner revival', async () => {
  const h = harness(), c = { codec: 'pcm', sampleRate: 32000, channels: 1, bitDepth: 16, littleEndian: true };
  const decoder = createAirPlayAudioDecoder({ onPcm() {}, softwareFactory, createDirectOutput: r => h.createDirectOutput(r) });
  try {
    await decoder.configure(setup(c));
    const retired = h.processor.directInputs.get(0);
    h.hold(true);
    const pending = decoder.decode({ ...setup(c), flags: 0, payload: new Int16Array(3200).buffer, decodeTimestampUs: 0 });
    for (let i = 0; i < 100 && !h.outputs.length; i++) await delay(5);
    decoder.reset(); assert.equal(await pending, false);
    h.hold(false);
    h.processor.message({ reset: true, generation: 2 });
    h.processor.receiveDirect(retired, { deliveryId: 99, records: [] });
    assert.equal(h.processor.streams.size, 0); assert.equal(h.processor.directInputs.size, 0);
    assert.ok(h.closed.length);
  } finally { decoder.dispose(); h.dispose(); }
});

test('reset during finite flush settles EOS without waiting for the worker timeout', async () => {
  const h = harness(), c = { codec: 'pcm', sampleRate: 32000, channels: 1, bitDepth: 16, littleEndian: true };
  const decoder = createAirPlayAudioDecoder({ onPcm() {}, softwareFactory, createDirectOutput: r => h.createDirectOutput(r) });
  try {
    await decoder.configure(setup(c));
    await decoder.decode({ ...setup(c), flags: 0, payload: new Int16Array(3200).fill(3000).buffer, decodeTimestampUs: 0 });
    h.hold(true);
    const pending = decoder.configure({ ...setup(c), config: { ended: true } });
    for (let i = 0; i < 100 && h.processor.endedEpochs.get(0) !== 1; i++) await delay(5);
    assert.equal(h.processor.endedEpochs.get(0), 1, 'worklet accepts tails and EOS before main acknowledgement');
    decoder.reset();
    assert.equal(await Promise.race([pending, delay(1000).then(() => 'timed out')]), false);
    h.hold(false);
    assert.equal(h.processor.directInputs.size, 0);
  } finally { decoder.dispose(); h.dispose(); }
});

test('oversized direct batches fail explicitly without admitting PCM or killing the render processor', async () => {
  const h = harness(), channel = new MessageChannel();
  try {
    const base = { type: 0, mode: 'carplay', epoch: 1, generation: 1, channels: 2, rate: 48000 };
    h.processor.message({ directInput: { id: 9, port: channel.port1, record: base } });
    const owner = h.processor.directInputs.get(0);
    h.processor.receiveDirect(owner, { deliveryId: 1, records: [{ ...base, pcm: new ArrayBuffer(256 * 1024 + 4) }] });
    assert.equal(h.processor.streams.size, 0);
    assert.equal(h.metadata.at(-1).directPcm.records.length, 0);
    assert.equal(h.processor.process([], [[new Float32Array(128), new Float32Array(128)]]), true);
  } finally { channel.port2.close(); h.dispose(); }
});
