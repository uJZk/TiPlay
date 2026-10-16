// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { probeMirrorAudioFormats } from '../../site/play/airplay-capabilities.js';

const PCM = 0x3fffc;
const ELD = (1 << 24) | (1 << 25);
function decoder(support = () => true) {
  const calls = [];
  return { calls, async isConfigSupported(config) { calls.push(config); return { supported: await support(config) }; } };
}

test('audio offers retain every supported wire bit and use complete source codec descriptions', async () => {
  const audio = decoder();
  assert.equal(await probeMirrorAudioFormats(audio), 0x3fffffc);
  assert.equal(audio.calls.length, 8);
  const alac = audio.calls.filter(config => config.codec === 'alac');
  assert.deepEqual(alac.map(config => {
    const bytes = config.description, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(bytes.length, 36);
    assert.equal(view.getUint32(0), 36);
    assert.equal(String.fromCharCode(...bytes.slice(4, 8)), 'alac');
    assert.equal(view.getUint32(12), 352);
    assert.deepEqual([...bytes.slice(18, 22)], [40, 10, 14, 2]);
    assert.equal(view.getUint16(22), 255);
    assert.equal(view.getUint32(32), config.sampleRate);
    return [config.sampleRate, bytes[17], config.numberOfChannels];
  }), [[44100, 16, 2], [44100, 24, 2], [48000, 16, 2], [48000, 24, 2]]);
  assert.deepEqual(audio.calls.filter(config => config.codec === 'mp4a.40.2').map(config => [...config.description]),
    [[0x12, 0x10], [0x12, 0x14], [0x11, 0x90], [0x11, 0x94]]);
  assert.equal(audio.calls.filter(config => config.codec === 'mp4a.40.39').length, 0);
});

test('ALAC rates and depths are independent, and both AAC-ELD rates have a bundled fallback', async () => {
  const audio = decoder(config => config.codec === 'alac' && config.sampleRate === 48000 && config.description[17] === 24);
  assert.equal(await probeMirrorAudioFormats(audio), PCM | (1 << 21) | ELD);
});

test('native AAC-LC requires both frame-length variants while bundled ELD remains available', async () => {
  const audio = decoder(config => {
    if (config.codec === 'mp4a.40.2') return config.sampleRate === 44100 || !(config.description[1] & 4);
    return false;
  });
  assert.equal(await probeMirrorAudioFormats(audio), PCM | (1 << 22) | ELD);
});

test('missing, rejected, throwing and hung native decoders preserve PCM and software AAC-ELD', async () => {
  for (const audio of [null, {}, decoder(() => false), decoder(() => { throw new Error('unsupported'); }), decoder(() => new Promise(() => {}))]) {
    assert.equal(await probeMirrorAudioFormats(audio, 5), PCM | ELD);
  }
});

test('viewport changes reuse the same bounded audio capability probe', async () => {
  const audio = decoder();
  const first = probeMirrorAudioFormats(audio), next = probeMirrorAudioFormats(audio);
  assert.equal(first, next);
  assert.deepEqual(await Promise.all([first, next]), [0x3fffffc, 0x3fffffc]);
  assert.equal(audio.calls.length, 8);
});
