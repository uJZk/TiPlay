import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Input, UrlSource, HLS_FORMATS, EncodedPacketSink } from '../../site/play/vendor/mediabunny/mediabunny.min.js';
import { fetchSdrMediaResource } from '../../site/play/airplay-sdr.js';

for (const container of ['hls-ts', 'hls-cmaf']) test(`real ${container} fixtures demux video/audio packets on the same normalized timeline`, async () => {
  const input = new Input({ source: new UrlSource(`https://fixture.test/${container}/index.m3u8`, {
    async fetchFn(url, init) {
      const path = new URL(url).pathname.split('/').pop();
      const full = new Uint8Array(await readFile(new URL(`./fixtures/${container}/${path}`, import.meta.url)));
      const range = new Headers(init?.headers).get('Range');
      if (!range) return new Response(full, { headers: { 'Content-Length': String(full.length) } });
      const match = range.match(/bytes=(\d+)-(\d*)/);
      const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), full.length - 1) : full.length - 1;
      return new Response(full.slice(start, end + 1), { status: 206, headers: {
        'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${full.length}`,
      } });
    },
  }), formats: HLS_FORMATS, formatOptions: { hls: { offsetTimestampsByDateTime: false } } });
  try {
    const video = await input.getPrimaryVideoTrack(), audio = await video.getPrimaryPairableAudioTrack();
    assert.equal(await video.getCodec(), 'avc'); assert.equal(await audio.getCodec(), 'aac');
    assert.equal(await video.getDisplayWidth(), 32); assert.equal(await video.getDisplayHeight(), 18);
    const first = await input.getFirstTimestamp([video, audio]);
    const videoPacket = await new EncodedPacketSink(video).getFirstPacket();
    const audioPacket = await new EncodedPacketSink(audio).getFirstPacket();
    assert.ok(videoPacket.data.length > 0); assert.ok(audioPacket.data.length > 0);
    assert.ok(Math.abs(videoPacket.timestamp - first) < 0.5); assert.ok(Math.abs(audioPacket.timestamp - first) < 0.5);
    assert.ok(await input.getDurationFromMetadata([video, audio]) > 0.9);
  } finally { input.dispose(); }
});

test('real HLS variant discovery never requests HDR manifests or segments when explicit SDR exists', async () => {
  const requested = [], controller = new AbortController();
  const fetchFixture = async (url, init) => {
    const path = new URL(url).pathname; requested.push(path);
    assert.ok(!path.startsWith('/hdr'), `HDR resource requested: ${path}`);
    if (path === '/master.m3u8') return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=9000000,VIDEO-RANGE=PQ,CODECS="hvc1.2.4.L153.B0"\nhdr.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=100000,VIDEO-RANGE=SDR,CODECS="avc1.64000a,mp4a.40.2"\nhls-ts/index.m3u8', { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
    const filename = path.split('/').pop();
    const full = new Uint8Array(await readFile(new URL(`./fixtures/hls-ts/${filename}`, import.meta.url)));
    const range = new Headers(init?.headers).get('Range')?.match(/bytes=(\d+)-(\d*)/);
    if (!range) return new Response(full, { headers: { 'Content-Length': String(full.length) } });
    const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), full.length - 1) : full.length - 1;
    return new Response(full.slice(start, end + 1), { status: 206, headers: { 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${full.length}` } });
  };
  const input = new Input({ source: new UrlSource('https://fixture.test/master.m3u8', {
    fetchFn: (url, init) => fetchSdrMediaResource(fetchFixture, url, init, { signal: controller.signal }),
  }), formats: HLS_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack(); assert.equal(await video.getCodec(), 'avc');
    assert.ok((await new EncodedPacketSink(video).getFirstPacket()).data.length > 0);
    assert.ok(requested.includes('/hls-ts/index.m3u8')); assert.ok(requested.includes('/hls-ts/index0.ts'));
    assert.ok(!requested.some(path => path.startsWith('/hdr')));
  } finally { controller.abort(); input.dispose(); }
});
