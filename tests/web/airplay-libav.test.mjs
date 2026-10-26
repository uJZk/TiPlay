import test from 'node:test';
import assert from 'node:assert/strict';
import { libavAudioSettings } from '../../site/play/airplay-libav.js';
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
