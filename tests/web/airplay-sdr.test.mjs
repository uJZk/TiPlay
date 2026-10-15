import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSdrResponse, hasHdrTransfer, requireSdrTrack, sdrPlaylist } from '../../site/play/airplay-sdr.js';

test('SDR masters exclude PQ/HLG/DolbyVision and prefer explicit SDR before any variant fetch', () => {
  const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="sound",NAME="English",URI="en.m3u8"\n'
    + '#EXT-X-STREAM-INF:BANDWIDTH=9000000,VIDEO-RANGE=PQ,CODECS="hvc1.2.4.L153.B0",AUDIO="sound"\npq.m3u8\n'
    + '#EXT-X-STREAM-INF:BANDWIDTH=8000000,VIDEO-RANGE=HLG\nhlg.m3u8\n'
    + '#EXT-X-STREAM-INF:BANDWIDTH=7000000,CODECS="dvhe.05.06,mp4a.40.2"\ndolby.m3u8\n'
    + '#EXT-X-STREAM-INF:BANDWIDTH=6000000,CODECS="hvc1.1.6.L120.B0"\nunknown.m3u8\n'
    + '#EXT-X-STREAM-INF:BANDWIDTH=2000000,VIDEO-RANGE=SDR,CODECS="avc1.64002a,mp4a.40.2",AUDIO="sound"\nsdr.m3u8\n';
  const filtered = sdrPlaylist(master);
  assert.match(filtered, /sdr\.m3u8/); assert.match(filtered, /en\.m3u8/); assert.match(filtered, /AUDIO="sound"/);
  for (const unsupported of ['pq.m3u8', 'hlg.m3u8', 'dolby.m3u8', 'unknown.m3u8']) assert.ok(!filtered.includes(unsupported));
  assert.throws(() => sdrPlaylist('#EXTM3U\n#EXT-X-STREAM-INF:VIDEO-RANGE=PQ\npq.m3u8'), { name: 'NotSupportedError' });
  assert.equal(sdrPlaylist('#EXTM3U\n#EXTINF:1,\nsegment.ts'), '#EXTM3U\n#EXTINF:1,\nsegment.ts');
});

test('partial manifests reread in full and preserve the redirect base after filtering', async () => {
  let fullReads = 0;
  const partial = new Response('#EXT', { status: 206, headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Range': 'bytes 0-3/100' } });
  const result = await filterSdrResponse(partial, 'https://example.test/master.m3u8', async () => {
    fullReads++; const response = new Response('#EXTM3U\n#EXT-X-STREAM-INF:VIDEO-RANGE=HLG\nhdr.m3u8\n#EXT-X-STREAM-INF:VIDEO-RANGE=SDR\nsdr.m3u8');
    Object.defineProperty(response, 'url', { value: 'https://example.test/moved/master.m3u8' }); return response;
  });
  assert.equal(fullReads, 1); assert.equal(result.status, 200); assert.equal(result.headers.has('Content-Range'), false);
  assert.equal(result.url, 'https://example.test/moved/master.m3u8'); assert.ok(!(await result.text()).includes('hdr.m3u8'));
});

test('track decoder configurations and late sample transfer changes reject HDR explicitly', async () => {
  await assert.rejects(requireSdrTrack({ getColorSpace: async () => ({ transfer: 'pq' }) }), { name: 'NotSupportedError' });
  await assert.rejects(requireSdrTrack({ getDecoderConfig: async () => ({ codec: 'hvc1.2.4.L153.B0', colorSpace: { transfer: 'hlg' } }) }), { name: 'NotSupportedError' });
  await assert.rejects(requireSdrTrack({ getCodecParameterString: async () => 'dvh1.08.06' }), { name: 'NotSupportedError' });
  await requireSdrTrack({ getColorSpace: async () => ({ transfer: 'bt709' }) });
  assert.equal(hasHdrTransfer({ transfer: 'smpte2084' }), true); assert.equal(hasHdrTransfer({ transfer: 'bt709' }), false);
});
