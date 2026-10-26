import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAirPlayAudioDecoder, decodePcmPacket } from '../../site/play/airplay-audio-decoder.js';
import { createLiveAudioDecoder } from '../../site/play/live-audio-software.js';
import { SoftwareWorker } from './live-worker.mjs';
import { loadFixtures } from '../bench/libav/fixtures.mjs';
const fixtures = await loadFixtures();
fixtures.push(JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./fixtures/live-alac24.json', import.meta.url), 'utf8')));
const config = f => ({ codec: f.name.includes('ELD') ? 'aac-eld' : f.codec === 'alac' ? 'alac' : 'aac-lc',
  sampleRate: f.rate, channels: f.channels, bitDepth: f.bitDepth ?? 16, samplesPerFrame: f.name.includes('ELD') ? Number(f.name.split(' ').at(-1)) : f.codec === 'alac' ? 4096 : 1024,
  ...(f.codec === 'alac' ? { cookie: Array.from(f.asc) } : { asc: Array.from(f.asc) }) });
const setup = c => ({ type: 0, epoch: 1, mode: 'airplay-mirror', flags: 2, rate: c.sampleRate, channels: c.channels, config: c });
const softwareFactory = c => createLiveAudioDecoder(c, { Worker: SoftwareWorker });

test('actual software decoders normalize every compressed fixture to a continuous 48 kHz timeline and flush EOF', async () => {
  for (const f of fixtures) {
    const c = config(f), records = [], errors = [];
    const decoder = createAirPlayAudioDecoder({ onPcm: r => records.push(r), onError: e => errors.push(e), softwareFactory });
    try {
      assert.equal(await decoder.configure(setup(c)), true, f.name);
      for (let i = 0; i < f.packets.length; i++) assert.equal(await decoder.decode({ ...setup(c), flags: 1,
        decodeTimestampUs: 1e6 + i * c.samplesPerFrame * 1e6 / f.rate,
        presentationMs: 10000 + i * c.samplesPerFrame * 1000 / f.rate,
        payload: Uint8Array.from(f.packets[i]).buffer }), true, f.name);
      assert.equal(await decoder.configure({ ...setup(c), config: { ended: true } }), true);
      assert.deepEqual(errors, [], f.name);
      const pcm = records.filter(r => r.pcm.byteLength);
      assert.ok(pcm.length > 0);
      let end = null;
      for (const r of pcm) {
        assert.equal(r.rate, 48000); assert.equal(r.channels, f.channels);
        if (end !== null) assert.ok(Math.abs(r.decodeTimestampUs - end) < 25, f.name);
        end = r.decodeTimestampUs + r.pcm.byteLength / 2 / r.channels * 1e6 / r.rate;
      }
      assert.equal(records.at(-1).ended, true);
      assert.ok(pcm.some(r => new Int16Array(r.pcm).some(value => value !== 0)));
    } finally { decoder.dispose(); }
  }
});

test('Opus uses NetEq even if a browser decoder is supplied; stale epochs never submit packets', async () => {
  const encoded = [], errors = [];
  const decoder = createAirPlayAudioDecoder({ onPcm() {}, onEncoded: r => encoded.push(r), onError: e => errors.push(e),
    AudioDecoder: class { constructor() { throw Error('Must never construct'); } },
    softwareFactory() { throw Error('Opus must not reach libav'); } });
  const record = setup({ codec: 'opus', sampleRate: 48000, channels: 1 });
  assert.equal(await decoder.configure(record), true);
  assert.equal(encoded[0].neteqConfig.codec, 'opus');
  const opus = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./fixtures/neteq-opus.json', import.meta.url), 'utf8'));
  const payload = Uint8Array.from(Buffer.from(opus.packets[0], 'base64')).buffer;
  assert.equal(await decoder.decode({ ...record, flags: 0, decodeTimestampUs: 0, payload }), true);
  assert.equal(await decoder.decode({ ...record, epoch: 0, flags: 0, decodeTimestampUs: 0, payload }), false);
  assert.equal(encoded.length, 2); assert.deepEqual(errors, []); decoder.dispose();
});

test('PCM24 unpack preserves sign and drops only the low eight bits', () => {
  const bytes = Uint8Array.of(0x80,0,0, 0x7f,0xff,0xff, 0xff,0xff,0xff, 0,0,0);
  assert.deepEqual([...new Int16Array(decodePcmPacket(bytes.buffer, { bitDepth: 24, channels: 1 }))], [-32768,32767,-1,0]);
});

test('raw PCM resampling keeps fractional duration across small packets and exact EOS sample count', async () => {
  for (const rate of [8000,16000,22050,24000,32000,44100,48000]) {
    const outputs = [], decoder = createAirPlayAudioDecoder({ onPcm: r => outputs.push(r), softwareFactory, onError: e => { throw e; } });
    try {
      const c = { codec: 'pcm', bitDepth: 16, littleEndian: true, sampleRate: rate, channels: 1 };
      assert.equal(await decoder.configure(setup(c)), true);
      for (let first = 0; first < rate; first += 221) {
        const samples = Int16Array.from({ length: Math.min(221, rate - first) }, (_, i) => Math.sin((first + i) * 2 * Math.PI * 997 / rate) * 9000);
        assert.equal(await decoder.decode({ ...setup(c), flags: 0, payload: samples.buffer, decodeTimestampUs: first * 1e6 / rate }), true);
      }
      await decoder.configure({ ...setup(c), config: { ended: true } });
      assert.equal(outputs.reduce((n, r) => n + r.pcm.byteLength / 2, 0), 48000, String(rate));
    } finally { decoder.dispose(); }
  }
});

test('source gaps remain gaps and do not carry the previous resampling signal into a new run', async () => {
  const outputs = [], errors = [], decoder = createAirPlayAudioDecoder({ onPcm: r => { if (r.pcm.byteLength) outputs.push(r); }, onError: e => errors.push(e), softwareFactory });
  const c = { codec: 'pcm', bitDepth: 16, littleEndian: true, sampleRate: 44100, channels: 1 };
  try {
    await decoder.configure(setup(c));
    await decoder.decode({ ...setup(c), flags: 0, decodeTimestampUs: 0, payload: new Int16Array(4410).fill(10000).buffer });
    await decoder.decode({ ...setup(c), flags: 0, decodeTimestampUs: 500000, payload: new Int16Array(4410).buffer });
    await decoder.configure({ ...setup(c), config: { ended: true } });
    assert.deepEqual(errors, []);
    const second = outputs.filter(r => r.decodeTimestampUs >= 500000);
    assert.ok(second.length); assert.ok(second.every(r => new Int16Array(r.pcm).every(v => v === 0)));
    assert.ok(outputs.filter(r => r.decodeTimestampUs < 500000).every(r => r.decodeTimestampUs + r.pcm.byteLength / 2 / 48000 * 1e6 < 100025));
  } finally { decoder.dispose(); }
});

test('reset settles pending initialization and a retired worker cannot output into its replacement', async () => {
  let close, resolveReady;
  const ready = new Promise(resolve => resolveReady = resolve);
  const outputs = [], decoder = createAirPlayAudioDecoder({ onPcm: r => outputs.push(r), softwareFactory: () => ({ ready, close() { close = true; resolveReady(); } }) });
  const c = config(fixtures[0]);
  const pending = decoder.configure(setup(c));
  await new Promise(r => setImmediate(r)); decoder.reset();
  assert.equal(await pending, false); assert.equal(close, true); assert.equal(outputs.length, 0);
  decoder.dispose();
});

test('four simultaneous software streams are bounded and releasing them permits a new epoch', async () => {
  const chosen = [fixtures[0], fixtures.find(f => f.name === 'ALAC 44100 stereo'), fixtures.find(f => f.name === 'AAC-ELD 48000 2ch 512')];
  const clients = chosen.map(f => softwareFactory(config(f)));
  const pcm = { codec: 'pcm', sampleRate: 32000, channels: 1, bitDepth: 16 };
  clients.push(softwareFactory(pcm));
  try {
    await Promise.all(clients.map(c => c.ready));
    assert.throws(() => softwareFactory(pcm), /limit/);
    for (let i = 0; i < chosen.length; i++) {
      await clients[i].decode(Uint8Array.from(chosen[i].packets[0]), 0);
      await clients[i].flush();
    }
    await clients[3].decode(new Int16Array(3200).buffer, 0); await clients[3].flush();
  } finally { for (const client of clients) client.close(); }
  const replacement = softwareFactory(pcm);
  try { await replacement.ready; } finally { replacement.close(); }
});

test('late legacy PCM cannot implicitly recreate an ended epoch, while a newer epoch can start', async () => {
  const output = [], decoder = createAirPlayAudioDecoder({ onPcm: r => { if (r.pcm.byteLength) output.push(r); } });
  const record = { type: 0, mode: 'carplay', epoch: 1, flags: 0, rate: 48000, channels: 1, pcm: new Int16Array([1000,1000]).buffer };
  try {
    assert.equal(await decoder.pcm(record), true);
    await decoder.pcm({ ...record, flags: 2, pcm: new ArrayBuffer(0) });
    const count = output.length;
    assert.equal(await decoder.pcm(record), false);
    assert.equal(output.length, count);
    assert.equal(await decoder.pcm({ ...record, mode: 'airplay-mirror' }), true, 'mode ownership is independent');
    assert.equal(await decoder.pcm(record), false, 'late CarPlay cannot enter the mirror owner');
    assert.equal(await decoder.pcm({ ...record, flags: 2 }), true, 'an explicit producer reset permits a new owner');
    assert.equal(await decoder.pcm({ ...record, epoch: 2 }), true);
    assert.equal(output.length, count + 3);
    decoder.reset();
    assert.equal(await decoder.pcm(record), true, 'an explicit owner reset permits a fresh subscription');
  } finally { decoder.dispose(); }
});
