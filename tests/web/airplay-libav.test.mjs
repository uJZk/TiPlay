import test from 'node:test';
import assert from 'node:assert/strict';
import { libavAudioSettings, canDecodeCastAudio, castAudioBuffers } from '../../site/play/airplay-libav.js';
const aac = (rate = 44100, channels = 2) => ({ codec: 'mp4a.40.2', sampleRate: rate,
  numberOfChannels: channels, description: Uint8Array.of(0x12, 0x10) });
const alac = rate => { const description = new Uint8Array(24); new DataView(description.buffer).setUint32(0, 4096); description[5] = 16;
  return { codec: 'alac', sampleRate: rate, numberOfChannels: 2, description }; };
test('SIMD selection is restricted to measured beneficial configurations', () => {
  assert.equal(libavAudioSettings(aac()).simd, true);
  assert.equal(libavAudioSettings(alac(44100)).simd, true);
  assert.equal(libavAudioSettings(aac(48000)).simd, false);
  assert.equal(libavAudioSettings(alac(48000)).simd, false);
  assert.equal(libavAudioSettings(aac(), 44100).simd, false);
  assert.equal(libavAudioSettings(aac(44100, 1)).simd, false);
  const high = alac(44100); high.description[5] = 24;
  assert.equal(libavAudioSettings(high).simd, false);
  assert.equal(libavAudioSettings({ ...aac(), codec: 'mp4a.40.39' }), null);
});
test('native capability success does not initialize or inspect software decoding', async () => {
  const track = { canDecode: async () => true, getDecoderConfig: () => { throw Error('unexpected'); } };
  assert.equal(await canDecodeCastAudio(track), true);
  const buffer = { sampleRate: 44100, duration: 1 };
  const lib = { AudioBufferSink: class { async *buffers() { yield { timestamp: 0, buffer }; } } };
  const backend = [];
  const output = [];
  for await (const frame of castAudioBuffers(lib, track, 0, { onBackend: b => backend.push(b) })) output.push(frame);
  assert.equal(output.length, 1);
  assert.deepEqual(backend, ['webcodecs']);
});
test('unsupported audio selection accepts only implemented fallback codecs', async () => {
  assert.equal(await canDecodeCastAudio({ canDecode: async () => false, getDecoderConfig: async () => aac() }), true);
  assert.equal(await canDecodeCastAudio({ canDecode: async () => false, getDecoderConfig: async () => ({ ...aac(), codec: 'opus' }) }), false);
});
test('network errors and cancellation do not trigger another decoder or retry reads', async () => {
  const cause = Error('HTTP 503');
  const lib = { AudioBufferSink: class { async *buffers() { throw cause; } } };
  const track = { canDecode: async () => true, getDecoderConfig: () => { throw Error('unexpected'); } };
  await assert.rejects(async () => { for await (const unused of castAudioBuffers(lib, track, 0)) void unused; }, e => e === cause);
});
