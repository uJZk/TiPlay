import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioTrackList, preferredAudioTrack } from '../../site/play/airplay-audio-tracks.js';
import { probeMirrorCapabilities } from '../../site/play/airplay-capabilities.js';
import { fetchMediaResource } from '../../site/play/airplay-fetch.js';

test('Video.js enabled setters switch once, list stays stable, and preferences match ISO language codes', () => {
  const switches = [], list = createAudioTrackList(id => { switches.push(id); list.select(id); });
  list.replace([{ id: '1', language: 'eng', label: 'English' }, { id: '2', language: 'zho', label: '中文' }], '1');
  assert.equal(preferredAudioTrack([...list], ['zh-CN']).id, '2');
  const chosen = list.getTrackById('2');
  for (const candidate of list) candidate.enabled = candidate === chosen;
  assert.deepEqual(switches, ['2']); assert.equal(list[0].enabled, false); assert.equal(chosen.enabled, true);
  list.replace([{ id: '3', language: 'jpn' }], '3');
  assert.equal(list.length, 1); assert.equal(list[1], undefined); assert.equal(list[0].enabled, true);
});

test('mirror capability probe bounds resolutions and reports HEVC only at the negotiated supported size', async () => {
  const configs = [];
  const Decoder = { async isConfigSupported(config) { configs.push(config); return { supported: config.codedWidth <= 1920 && !config.codec.startsWith('hvc1') }; } };
  assert.deepEqual(await probeMirrorCapabilities(3840, 2160, Decoder), { h264: true, hevc: false, maxWidth: 1920, maxHeight: 1080 });
  assert.ok(configs.every(config => config.codedWidth <= 3840 && config.codedHeight <= 2160 && config.hardwareAcceleration === 'prefer-hardware'));
  assert.deepEqual(await probeMirrorCapabilities(1920, 1080, {}), { h264: false, hevc: false, maxWidth: 0, maxHeight: 0 });
});

test('media fetch cancels hung requests and body reads, preserves ranges and disables stale caches', async () => {
  const hung = (_url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  await assert.rejects(fetchMediaResource(hung, 'https://example.test/live.m3u8', {}, { deadline: 5 }), { name: 'TimeoutError' });
  let request;
  const reader = await fetchMediaResource(async (_url, init) => {
    request = init;
    return new Response(new ReadableStream({ start(stream) { init.signal.addEventListener('abort', () => stream.error(init.signal.reason)); } }), { status: 206 });
  }, 'https://example.test/segment.m4s', { headers: { Range: 'bytes=8-15' } }, { deadline: 5 });
  assert.equal(request.headers.Range, 'bytes=8-15'); assert.equal(request.cache, 'no-store');
  assert.equal(reader.status, 206); await assert.rejects(reader.arrayBuffer(), { name: 'TimeoutError' });
  const redirected = new Response('manifest');
  Object.defineProperties(redirected, { url: { value: 'https://example.test/moved/live.m3u8' }, redirected: { value: true } });
  const manifest = await fetchMediaResource(async () => redirected, 'https://example.test/live.m3u8');
  assert.equal(manifest.url, redirected.url); assert.equal(manifest.redirected, true); assert.equal(await manifest.text(), 'manifest');
});


test('AirPlay mirror negotiation excludes HEVC and H.264 support available only without the hardware request', async () => {
  const calls = [];
  const Decoder = { async isConfigSupported(config) {
    calls.push(config);
    return { supported: config.codec.startsWith('avc1') || config.hardwareAcceleration !== 'prefer-hardware' };
  } };
  assert.deepEqual(await probeMirrorCapabilities(1920, 1080, Decoder), { h264: true, hevc: false, maxWidth: 1920, maxHeight: 1080 });
  assert.ok(calls.every(config => config.hardwareAcceleration === 'prefer-hardware' && config.optimizeForLatency === true));
  const softwareOnly = { async isConfigSupported(config) { return { supported: config.hardwareAcceleration !== 'prefer-hardware' }; } };
  assert.deepEqual(await probeMirrorCapabilities(1920, 1080, softwareOnly), { h264: false, hevc: false, maxWidth: 0, maxHeight: 0 });
});
