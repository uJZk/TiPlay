// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { softwareEldOptions, createSoftwareEldDecoder } from '../../site/play/aac-eld-software.js';
import { createAirPlayAudioDecoder } from '../../site/play/airplay-audio-decoder.js';

const config = (sampleRate = 44100, channels = 2, samplesPerFrame = 480) => ({
  codec: 'aac-eld', sampleRate, channels, samplesPerFrame, bitDepth: 16,
  asc: [0xf8, sampleRate === 44100 ? 0xe8 : 0xe6, (channels << 5) | (samplesPerFrame === 480 ? 0x10 : 0), 0],
});
const configuration = (value = config(), epoch = 1, type = 6) => ({
  type, epoch, mode: 'airplay-mirror', sequence: 0, flags: 6, rate: value.sampleRate, channels: value.channels, config: value,
});
const packet = (payload, index = 0, epoch = 1, type = 6) => ({
  type, epoch, mode: 'airplay-mirror', sequence: index, flags: 4, rate: 44100, channels: 2,
  decodeTimestampUs: 1000000 + index * 480e6 / 44100, presentationMs: 9000 + index * 480000 / 44100,
  payload: Uint8Array.from(payload).buffer,
});
const tick = () => new Promise(resolve => setImmediate(resolve));

function workerHarness({ initialize = true, decode = true } = {}) {
  const workers = [];
  class Worker {
    constructor(url, options) {
      assert.ok(url.pathname.endsWith('/aac-eld-worker.js')); assert.equal(options.type, 'module');
      this.messages = []; this.terminated = false; workers.push(this);
    }
    postMessage(message, transfer = []) {
      const data = structuredClone(message, { transfer }); this.messages.push(data);
      if (data.kind === 'configure' && initialize) queueMicrotask(() => this.onmessage({ data: { kind: 'ready' } }));
      if (data.kind === 'decode' && decode) {
        const options = this.messages[0].options, pcm = new Int16Array(options.frameLength * options.channels);
        pcm[0] = new Uint8Array(data.packet)[0];
        queueMicrotask(() => this.onmessage({ data: { kind: 'pcm', id: data.id, pcm: pcm.buffer } }));
      }
    }
    terminate() { this.terminated = true; }
  }
  return { Worker, workers };
}

test('software ELD accepts only the bundled raw profiles, with no SBR or extensions', () => {
  for (const rate of [44100, 48000]) for (const channels of [1, 2]) for (const frame of [480, 512]) {
    assert.deepEqual(softwareEldOptions(config(rate, channels, frame)), { sampleRate: rate, channels, frameLength: frame });
  }
  for (const value of [null, { ...config(), codec: 'aac-lc' }, { ...config(), sampleRate: 96000 },
    { ...config(), bitDepth: 24 }, { ...config(), samplesPerFrame: 1024 },
    { ...config(), asc: [0xf8, 0xe8, 0x58, 0] }, { ...config(), asc: [0xf8, 0xe8, 0x50, 1] },
    { ...config(), asc: [0xf8, 0xe8, 0x40, 0] }]) assert.equal(softwareEldOptions(value), null);
});

test('software worker transfers an exact owned packet without detaching the transport input', async () => {
  const harness = workerHarness(), decoder = createSoftwareEldDecoder(config(), harness);
  try {
    await decoder.ready;
    const input = Buffer.from([42, 1, 2]), pcm = await decoder.decode(input);
    assert.deepEqual([...input], [42, 1, 2]);
    assert.equal(harness.workers[0].messages[1].packet.byteLength, 3);
    assert.equal(pcm.byteLength, 480 * 2 * 2); assert.equal(new Int16Array(pcm)[0], 42);
    await assert.rejects(decoder.decode(new Uint8Array(8193)), /1\.\.8192/);
  } finally { decoder.close(); }
  assert.equal(harness.workers[0].terminated, true);
});

test('initialization, packet waits, worker errors and close all release bounded software resources', async () => {
  const hung = workerHarness({ initialize: false });
  const opening = createSoftwareEldDecoder(config(), { ...hung, initTimeout: 5 });
  await assert.rejects(opening.ready, /initialization timed out/); assert.equal(hung.workers[0].terminated, true);
  const blocked = workerHarness({ decode: false });
  const decoding = createSoftwareEldDecoder(config(), { ...blocked, packetTimeout: 5 });
  await decoding.ready; await assert.rejects(decoding.decode(new Uint8Array([1])), /decoding timed out/);
  assert.equal(blocked.workers[0].terminated, true);
  const errors = workerHarness({ decode: false }), broken = createSoftwareEldDecoder(config(), errors);
  await broken.ready;
  const pending = broken.decode(new Uint8Array([1])); await tick();
  errors.workers[0].onerror(); await assert.rejects(pending, /worker failed/);
  const closing = workerHarness({ initialize: false }), closed = createSoftwareEldDecoder(config(), closing);
  closed.close(); await assert.rejects(closed.ready, { name: 'AbortError' });
  closing.workers[0].onmessage({ data: { kind: 'ready' } });
  await assert.rejects(closed.decode(new Uint8Array([1])), { name: 'AbortError' });
});

test('software queue and concurrent heap count are bounded and close makes room for another epoch', async () => {
  const harness = workerHarness({ decode: false });
  const decoders = Array.from({ length: 4 }, () => createSoftwareEldDecoder(config(), harness));
  try {
    await Promise.all(decoders.map(decoder => decoder.ready));
    assert.throws(() => createSoftwareEldDecoder(config(), harness), /limit reached/);
    const pending = Array.from({ length: 32 }, () => decoders[0].decode(new Uint8Array([1])));
    const done = Promise.allSettled(pending);
    await assert.rejects(decoders[0].decode(new Uint8Array([1])), /queue is full/);
    decoders[0].close(); assert.ok((await done).every(result => result.status === 'rejected'));
    const replacement = createSoftwareEldDecoder(config(), harness);
    await replacement.ready; replacement.close();
  } finally { decoders.forEach(decoder => decoder.close()); }
});

test('ELD uses native WebCodecs first and never creates a software heap when native configuration succeeds', async () => {
  let software = 0, native = 0;
  class Decoder {
    static async isConfigSupported() { return { supported: true }; }
    constructor() { native++; this.state = 'configured'; }
    configure() {}
    close() { this.state = 'closed'; }
  }
  const decoder = createAirPlayAudioDecoder({ onPcm() {}, AudioDecoder: Decoder, EncodedAudioChunk: class {},
    softwareEldFactory() { software++; throw new Error('Unexpected fallback'); } });
  try { assert.equal(await decoder.configure(configuration()), true); assert.equal(native, 1); assert.equal(software, 0); }
  finally { decoder.dispose(); }
});

test('a rejected native ELD probe or configuration falls back locally and preserves the incoming timing', async () => {
  for (const nativeFailure of ['unsupported', 'probe-error', 'probe-timeout', 'configure-error']) {
    const harness = workerHarness(), outputs = [], errors = [], native = [];
    class Decoder {
      static isConfigSupported() {
        if (nativeFailure === 'probe-error') throw new Error('Probe failed');
        if (nativeFailure === 'probe-timeout') return new Promise(() => {});
        return Promise.resolve({ supported: nativeFailure === 'configure-error' });
      }
      constructor() { this.state = 'unconfigured'; native.push(this); }
      configure() { throw new Error('Native configuration failed'); }
      close() { this.state = 'closed'; }
    }
    const decoder = createAirPlayAudioDecoder({ onPcm: output => outputs.push(output), onError: error => errors.push(error),
      AudioDecoder: Decoder, EncodedAudioChunk: class {}, probeTimeout: 5,
      softwareEldFactory: value => createSoftwareEldDecoder(value, harness) });
    try {
      assert.equal(await decoder.configure(configuration()), true, nativeFailure);
      assert.equal(harness.workers.length, 1);
      if (nativeFailure === 'configure-error') assert.equal(native[0].state, 'closed');
      const record = packet([42], 17);
      assert.equal(await decoder.decode(record), true);
      const pcm = outputs.find(output => output.pcm.byteLength);
      assert.equal(new Int16Array(pcm.pcm)[0], 42); assert.equal(pcm.presentationMs, record.presentationMs);
      assert.equal(pcm.epoch, record.epoch); assert.equal(pcm.sequence, 0); assert.equal(pcm.flags, 4);
      assert.deepEqual(errors, []);
    } finally { decoder.dispose(); }
  }
});

test('malformed worker PCM retires the heap and rejects every pending packet', async () => {
  const harness = workerHarness({ decode: false }), decoder = createSoftwareEldDecoder(config(), harness);
  await decoder.ready;
  const pending = [decoder.decode(new Uint8Array([1])), decoder.decode(new Uint8Array([2]))];
  const done = Promise.allSettled(pending); await tick();
  harness.workers[0].onmessage({ data: { kind: 'pcm', id: 1, pcm: new ArrayBuffer(16 * 1024 * 1024) } });
  for (const result of await done) { assert.equal(result.status, 'rejected'); assert.match(result.reason.message, /Invalid software/); }
  assert.equal(harness.workers[0].terminated, true);
  decoder.close();
});

test('reset retires pending software initialization and old PCM without affecting another stream', async () => {
  const harness = workerHarness({ initialize: false, decode: false }), outputs = [], errors = [];
  const decoder = createAirPlayAudioDecoder({ onPcm: value => outputs.push(value), onError: error => errors.push(error),
    AudioDecoder: null, EncodedAudioChunk: null, softwareEldFactory: value => createSoftwareEldDecoder(value, harness) });
  try {
    const first = decoder.configure(configuration()); await tick();
    decoder.reset(6); assert.equal(await first, false); assert.equal(harness.workers[0].terminated, true);
    const next = decoder.configure(configuration(config(), 2)); await tick();
    harness.workers[1].onmessage({ data: { kind: 'ready' } }); assert.equal(await next, true);
    const pcm = { codec: 'pcm', sampleRate: 44100, channels: 2, bitDepth: 16 };
    assert.equal(await decoder.configure(configuration(pcm, 3, 1)), true);
    const waiting = decoder.decode(packet([1], 0, 2)); await tick();
    decoder.reset(6); assert.equal(await waiting, false);
    harness.workers[1].onmessage({ data: { kind: 'pcm', id: 1, pcm: new ArrayBuffer(1920) } });
    assert.equal(await decoder.decode({ ...packet([0, 1, 0, 2], 0, 3, 1), flags: 0 }), true);
    const decoded = outputs.filter(value => value.pcm.byteLength);
    assert.equal(decoded.length, 1); assert.equal(decoded[0].type, 1); assert.equal(errors.length, 0);
  } finally { decoder.dispose(); }
});

// Execute the unmodified third-party decoder through its actual browser-worker environment branch.
// Module workers expose importScripts but cannot call it; the embedded initializer needs no fetch.
const vendor = readFileSync(new URL('../../site/play/vendor/aac-eld/aac-eld.js', import.meta.url), 'utf8')
  .replace('export function createEldDecoder', 'function createEldDecoder');
const workerSource = readFileSync(new URL('../../site/play/aac-eld-worker.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/m, '');
class BrowserRealmWorker {
  constructor() {
    this.terminated = false;
    const owner = this, self = { location: { href: 'https://example.test/play/aac-eld-worker.js' }, postMessage(data, transfer = []) {
      const message = structuredClone(data, { transfer });
      queueMicrotask(() => { if (!owner.terminated) owner.onmessage({ data: message }); });
    } };
    this.realm = vm.createContext({ self, importScripts() { throw new Error('Module workers cannot call importScripts'); },
      setTimeout, clearTimeout, atob, console });
    vm.runInContext(vendor, this.realm); vm.runInContext(workerSource, this.realm);
  }
  postMessage(data, transfer = []) {
    const message = structuredClone(data, { transfer }), realm = this.realm;
    // A real worker's structured clone uses its own realm's ArrayBuffer constructor.
    if (message.packet) {
      const source = new Uint8Array(message.packet);
      realm.packetLength = source.byteLength;
      message.packet = vm.runInContext('new ArrayBuffer(packetLength)', realm);
      new Uint8Array(message.packet).set(source);
    }
    queueMicrotask(() => { if (!this.terminated) void realm.self.onmessage({ data: message }); });
  }
  terminate() { this.terminated = true; this.realm = null; }
}
function accessUnits(rate, channels, frame) {
  const bytes = readFileSync(new URL(`./fixtures/aac-eld/${rate}-${channels}-${frame}-tone.bin`, import.meta.url));
  const records = [];
  for (let offset = 0; offset < bytes.length;) {
    const size = bytes.readUInt32LE(offset); offset += 4;
    assert.ok(size > 0 && offset + size <= bytes.length);
    records.push(bytes.subarray(offset, offset + size)); offset += size;
  }
  return records;
}

test('the bundled ELD decoder and real worker handler produce owned nonzero PCM for every shipped raw profile', async () => {
  for (const rate of [44100, 48000]) for (const channels of [1, 2]) for (const frame of [480, 512]) {
    const records = accessUnits(rate, channels, frame), value = config(rate, channels, frame);
    assert.deepEqual([...records.shift()], value.asc);
    const outputs = [], errors = [];
    const decoder = createAirPlayAudioDecoder({ onPcm: output => outputs.push(output), onError: error => errors.push(error),
      AudioDecoder: null, EncodedAudioChunk: null,
      softwareEldFactory: source => createSoftwareEldDecoder(source, { Worker: BrowserRealmWorker }) });
    try {
      assert.equal(await decoder.configure(configuration(value, 7)), true, `${rate}/${channels}/${frame} initializes`);
      for (const [index, data] of records.entries()) {
        assert.equal(await decoder.decode({ ...packet(data, index, 7), rate, channels,
          decodeTimestampUs: index * frame * 1e6 / rate, presentationMs: 9000 + index * frame * 1000 / rate }), true);
      }
      const pcm = outputs.filter(output => output.pcm.byteLength);
      assert.equal(pcm.length, 12); assert.equal(new Set(pcm.map(output => output.pcm)).size, 12);
      assert.ok(pcm.some(output => new Int16Array(output.pcm).some(sample => sample !== 0)));
      pcm.forEach((output, index) => {
        assert.equal(output.pcm.byteLength, frame * channels * 2); assert.equal(output.rate, rate);
        assert.equal(output.channels, channels); assert.equal(output.type, 6); assert.equal(output.epoch, 7);
        assert.equal(output.sequence, index); assert.equal(output.presentationMs, 9000 + index * frame * 1000 / rate);
      });
      const retained = [...new Int16Array(pcm[0].pcm)]; decoder.reset(6);
      assert.deepEqual([...new Int16Array(pcm[0].pcm)], retained); assert.deepEqual(errors, []);
    } finally { decoder.dispose(); }
  }
});

test('real software ELD preserves its codec signal across nineteen explicit NoData frames', async () => {
  const value = config(), units = accessUnits(44100, 2, 480); units.shift();
  async function render(silentFrames) {
    const outputs = [], errors = [];
    const decoder = createAirPlayAudioDecoder({ onPcm: output => { if (output.pcm.byteLength) outputs.push(output); },
      onError: error => errors.push(error), AudioDecoder: null, EncodedAudioChunk: null,
      softwareEldFactory: source => createSoftwareEldDecoder(source, { Worker: BrowserRealmWorker }) });
    try {
      decoder.debug(true); assert.equal(await decoder.configure(configuration(value, 7)), true);
      for (let input = 0; input < 4; input++) {
        if (input === 2) for (let silent = 0; silent < silentFrames; silent++)
          assert.equal(await decoder.decode(packet([0, 0x68, 0x34, 0], input + silent, 7)), true);
        const position = input + (input >= 2 ? silentFrames : 0);
        assert.equal(await decoder.decode(packet(units[input], position, 7)), true);
      }
      assert.deepEqual(errors, []);
      return { outputs, stats: decoder.stats() };
    } finally { decoder.dispose(); }
  }
  const baseline = await render(0), silent = await render(19);
  assert.equal(silent.outputs.length, 23);
  for (let index = 0; index < 23; index++) {
    const output = silent.outputs[index];
    assert.equal(output.sequence, index); assert.equal(output.epoch, 7);
    assert.equal(output.pcm.byteLength, 480 * 2 * 2);
    assert.equal(output.decodeTimestampUs, 1e6 + index * 480e6 / 44100);
    if (index >= 2 && index < 21) assert.ok(new Int16Array(output.pcm).every(sample => sample === 0));
    else assert.deepEqual(new Uint8Array(output.pcm), new Uint8Array(baseline.outputs[index < 2 ? index : index - 19].pcm));
  }
  assert.equal(silent.stats.noDataPackets, 19); assert.equal(silent.stats.noDataFrames, 9120);
  assert.equal(silent.stats.stream6.backend, 'software');
});
