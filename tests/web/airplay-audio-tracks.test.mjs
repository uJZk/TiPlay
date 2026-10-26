import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioTrackList, preferredAudioTrack } from '../../site/play/airplay-audio-tracks.js';
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
