import test from 'node:test';
import assert from 'node:assert/strict';
import { decodableAudioTracks, selectPlayableTrack } from '../../site/play/airplay-track-selection.js';

const rank = tracks => async ({ filter }) => tracks.find(filter) || null;
const track = (overrides = {}) => ({ canDecode: async () => true, ...overrides });

test('failed preferred HLS rendition falls back without hydrating unused variants', async () => {
  const reads = [];
  const broken = track({ getDecoderConfig: async () => { reads.push('404'); throw new Error('HTTP 404'); } });
  const working = track({ getDecoderConfig: async () => { reads.push('working'); return { codec: 'avc1.640028' }; } });
  const unused = track({ getDecoderConfig: async () => { reads.push('unused'); throw new Error('HTTP 503'); } });
  assert.equal(await selectPlayableTrack(rank([broken, working, unused]), { video: true }), working);
  assert.deepEqual(reads, ['404', 'working']);
});

test('SDR and actual decoder support remain required when choosing the fallback', async () => {
  const hdr = track({ getColorSpace: async () => ({ transfer: 'pq' }) });
  const unsupported = track({ canDecode: async () => false });
  const sdr = track();
  assert.equal(await selectPlayableTrack(rank([hdr, unsupported, sdr]), { video: true }), sdr);
  await assert.rejects(selectPlayableTrack(rank([hdr]), { video: true }), { name: 'NotSupportedError' });
});

test('all unavailable variants report a resource failure and an empty video list permits audio-only media', async () => {
  const failure = new Error('HTTP 404: unavailable playlist');
  await assert.rejects(selectPlayableTrack(rank([track({ getDecoderConfig: async () => { throw failure; } })]), { video: true }), cause => cause === failure);
  assert.equal(await selectPlayableTrack(rank([]), { video: true }), null);
});

test('cancellation during a decoder probe cannot open another variant even when canDecode swallows abort', async () => {
  const controller = new AbortController(), reads = [];
  const first = track({ canDecode: async () => { controller.abort(); return false; } });
  const second = track({ canDecode: async () => { reads.push('second'); return true; } });
  await assert.rejects(selectPlayableTrack(rank([first, second]), { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(reads, []);
});

test('audio rendition discovery waits for each probe and isolates unavailable alternatives', async () => {
  let active = 0, peak = 0;
  const make = supported => track({ canDecode: async () => {
    peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 1)); active--;
    if (supported === null) throw new TypeError('fetch failed'); return supported;
  } });
  const first = make(true), broken = make(null), unsupported = make(false), last = make(true);
  assert.deepEqual(await decodableAudioTracks([first, broken, unsupported, last]), [first, last]);
  assert.equal(peak, 1);
});
