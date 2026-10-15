import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMediaTextTracks } from '../../site/play/airplay-text-tracks.js';
import { parseSubtitleInit, parseSubtitleFragment, decodeSubtitleSample } from '../../site/play/airplay-subtitle-bmff.js';
import { captionTriples, DigitalCaptionParser } from '../../site/play/airplay-caption-data.js';
const enc = text => new TextEncoder().encode(text);
const cat = (...arrays) => { const result = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0)); let at = 0; for (const a of arrays) { result.set(a, at); at += a.length; } return result; };
const uint = n => { const d = new Uint8Array(4); new DataView(d.buffer).setUint32(0, n); return d; };
const box = (type, ...data) => { const payload = cat(...data); return cat(uint(payload.length + 8), enc(type), payload); };
const full = (flags, ...data) => cat(uint(flags), ...data);
const init = codec => box('moov', box('trak', box('tkhd', full(0, uint(0), uint(0), uint(1))), box('mdia', box('mdhd', full(0, uint(0), uint(0), uint(1000), uint(0), new Uint8Array([0x15, 0xc7, 0, 0]))), box('minf', box('stbl', box('stsd', full(0, uint(1), box(codec, new Uint8Array(8)))))))), box('mvex', box('trex', full(0, uint(1), uint(1), uint(2000), uint(0), uint(0)))));
function fragment(data, time = 10000) {
  const header = offset => box('moof', box('mfhd', full(0, uint(1))), box('traf', box('tfhd', full(0x20000, uint(1))), box('tfdt', full(0, uint(time))), box('trun', full(0x301, uint(1), uint(offset), uint(2000), uint(data.length)))));
  const moof = header(0); return cat(header(moof.length + 8), box('mdat', data));
}
async function until(check) { for (let turn = 0; turn < 2000; turn++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Subtitle work did not settle'); }
const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="English",LANGUAGE="en",DEFAULT=YES,URI="text.m3u8"\n';
function harness(t, resources) {
  const calls = [], subtitles = createMediaTextTracks({ fetchResource: async (url, options) => {
    calls.push({ url, options }); const data = resources.get(url); assert.notEqual(data, undefined, url);
    return typeof data === 'function' ? data(options) : new Response(data);
  } }); t.after(() => subtitles.dispose()); return { subtitles, calls };
}
async function aes(data, key, iv) { return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['encrypt']), data)); }

test('real FFmpeg MP4 tx3g sample tables support enabled-track range loading and seeking', async t => {
  const data = new Uint8Array(readFileSync(new URL('./fixtures/embedded-tx3g.mp4', import.meta.url))), url = 'https://media.test/embedded.mp4';
  const info = parseSubtitleInit(data)[0]; assert.equal(info.codec, 'tx3g'); assert.equal(info.language, 'eng');
  const actual = info.samples.flatMap(sample => decodeSubtitleSample(data.subarray(sample.offset, sample.offset + sample.size), info.codec, sample.startTime, sample.endTime));
  assert.deepEqual(actual.map(cue => [cue.startTime, cue.endTime, cue.text]), [[.5, 1.5, 'Embedded & safe'], [2, 3, 'Second line']]);
  const { subtitles, calls } = harness(t, new Map([[url, options => {
    const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range); const start = Number(from), end = Number(to);
    return new Response(data.slice(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${Math.min(end, data.length - 1)}/${data.length}` } });
  }]]));
  await subtitles.load(url, 'video/mp4', { mediaOrigin: () => 0 });
  assert.equal(subtitles.tracks.length, 1); const track = subtitles.tracks[0]; assert.equal(track.cues.length, 0);
  const changes = []; subtitles.tracks.addEventListener('change', () => changes.push(track.cues.length));
  track.mode = 'showing'; await until(() => track.cues.length === 2);
  subtitles.update(.75); assert.equal(track.activeCues[0].text, 'Embedded & safe');
  subtitles.update(2); assert.equal(track.activeCues[0].text, 'Second line'); assert.ok(changes.includes(2));
  assert.ok(calls.every(call => call.options.headers.Range));
});

test('CMAF wvtt initialization and fragment sample timing work in HLS EXT-X-MAP with byte ranges', async t => {
  const payload = box('vttc', box('iden', enc('cue-one')), box('payl', enc('<b>CMAF</b> &amp; text'))), initialization = init('wvtt'), media = fragment(payload);
  const infos = parseSubtitleInit(initialization), samples = parseSubtitleFragment(media, infos);
  assert.equal(infos[0].codec, 'wvtt'); assert.equal(samples[0].startTime, 10); assert.equal(samples[0].endTime, 12);
  const base = 'https://media.test/', resources = new Map([[base + 'master.m3u8', master], [base + 'text.m3u8', `#EXTM3U\n#EXT-X-MAP:URI="text.mp4",BYTERANGE="${initialization.length}@0"\n#EXTINF:2,\n#EXT-X-BYTERANGE:${media.length}@${initialization.length}\ntext.mp4\n#EXT-X-ENDLIST\n`],
    [base + 'text.mp4', options => new Response(options.headers.Range.startsWith('bytes=0-') ? initialization : media, { status: 206 })]]);
  const { subtitles } = harness(t, resources); await subtitles.load(base + 'master.m3u8', 'application/x-mpegurl');
  await until(() => subtitles.tracks[0].cues.length === 1); const cue = subtitles.tracks[0].cues[0];
  assert.deepEqual([cue.startTime, cue.endTime, cue.id, cue.text], [0, 2, 'cue-one', 'CMAF & text']);
  subtitles.update(1); assert.equal(subtitles.tracks[0].activeCues.length, 1);
});

test('embedded wvtt and IMSC1 fragments are observed as real tracks on the media clock', async t => {
  const { subtitles } = harness(t, new Map()); await subtitles.load('https://media.test/video.bin');
  const xml = '<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="10s" end="12s">IMSC &amp; safe<br/>Next</p></div></body></tt>';
  await subtitles.inspectMediaResource('https://media.test/init.mp4', new Response(init('stpp')));
  await subtitles.inspectMediaResource('https://media.test/part.m4s', new Response(fragment(enc(xml))), { origin: 10 });
  assert.equal(subtitles.tracks.length, 1); const track = subtitles.tracks[0]; track.mode = 'showing'; subtitles.update(1);
  assert.equal(track.activeCues[0].text, 'IMSC & safe\nNext'); assert.equal(track.activeCues[0].startTime, 0);
});

test('AES128 HLS subtitles decrypt sequence IV and explicit IV across key rotation on authenticated proxy URLs', async t => {
  const base = 'https://phone.test/airplay-resource?id=1&r=master&c=pair&s=session';
  const route = name => `https://phone.test/airplay-resource?r=${name}&id=1&c=pair&s=session`;
  const key1 = new Uint8Array(16).fill(7), key2 = new Uint8Array(16).fill(9), sequenceIV = new Uint8Array(16); sequenceIV[15] = 42;
  const explicitIV = new Uint8Array(16).fill(2);
  const resources = new Map([[base, master.replace('text.m3u8', '?r=text')], [route('text'), '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:42\n#EXT-X-KEY:METHOD=AES-128,URI="?r=key1"\n#EXTINF:2,\n?r=part1\n#EXT-X-KEY:METHOD=AES-128,URI="?r=key2",IV=0x02020202020202020202020202020202\n#EXTINF:2,\n?r=part2\n#EXT-X-ENDLIST\n'],
    [route('key1'), key1], [route('key2'), key2],
    [route('part1'), await aes(enc('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFirst encrypted\n'), key1, sequenceIV)],
    [route('part2'), await aes(enc('WEBVTT\n\n00:00:02.000 --> 00:00:03.000\nRotated key\n'), key2, explicitIV)],
  ]);
  const { subtitles, calls } = harness(t, resources); await subtitles.load(base, 'application/x-mpegurl');
  await until(() => subtitles.tracks[0].cues.length === 2); subtitles.update(2);
  assert.equal(subtitles.tracks[0].activeCues[0].text, 'Rotated key');
  assert.equal(calls.filter(call => call.url === route('key1')).length, 1);
  for (const call of calls) { const url = new URL(call.url); assert.equal(url.searchParams.get('c'), 'pair'); assert.equal(url.searchParams.get('s'), 'session'); assert.equal(call.options.referrerPolicy, 'no-referrer'); }
});

test('AES key rotation re-reads a repeated URI instead of reusing the previous declaration', async t => {
  const base = 'https://media.test/', first = new Uint8Array(16).fill(11), second = new Uint8Array(16).fill(19);
  const iv1 = new Uint8Array(16), iv2 = new Uint8Array(16); iv2[15] = 1;
  let keyReads = 0;
  const resources = new Map([[base + 'master.m3u8', master],
    [base + 'text.m3u8', '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:2,\npart1\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:2,\npart2\n#EXT-X-ENDLIST\n'],
    [base + 'key', () => new Response(++keyReads === 1 ? first : second)],
    [base + 'part1', await aes(enc('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nBefore rotation\n'), first, iv1)],
    [base + 'part2', await aes(enc('WEBVTT\n\n00:00:02.000 --> 00:00:03.000\nSame URI new key\n'), second, iv2)],
  ]);
  const { subtitles } = harness(t, resources);
  await subtitles.load(base + 'master.m3u8', 'application/x-mpegurl');
  await until(() => subtitles.tracks[0].cues.length === 2);
  subtitles.update(2);
  assert.equal(subtitles.tracks[0].activeCues[0].text, 'Same URI new key');
  assert.equal(keyReads, 2);
});

test('encrypted CMAF initialization requires IV and both init and samples decrypt', async t => {
  const base = 'https://media.test/', key = new Uint8Array(16).fill(3), iv = new Uint8Array(16), initialization = init('wvtt'), media = fragment(box('vttc', box('payl', enc('Encrypted CMAF'))));
  const { subtitles } = harness(t, new Map([[base + 'master.m3u8', master], [base + 'text.m3u8', '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key",IV=0x00000000000000000000000000000000\n#EXT-X-MAP:URI="init"\n#EXTINF:2,\npart\n#EXT-X-ENDLIST\n'],
    [base + 'key', key], [base + 'init', await aes(initialization, key, iv)], [base + 'part', await aes(media, key, iv)]]));
  await subtitles.load(base + 'master.m3u8', 'application/x-mpegurl'); await until(() => subtitles.tracks[0].cues.length === 1);
  assert.equal(subtitles.tracks[0].cues[0].text, 'Encrypted CMAF');
});

function sei(triples) {
  const payload = cat(new Uint8Array([181, 0, 49]), enc('GA94'), new Uint8Array([3, 0x40 | triples.length, 255]), ...triples.map(([type,a,b]) => new Uint8Array([0xfc | type, a, b])), new Uint8Array([255]));
  const nal = cat(new Uint8Array([6, 4, payload.length]), payload, new Uint8Array([128]));
  return cat(uint(nal.length), nal);
}
test('AVC SEI CEA608 caption bytes use maintained decoder and create actual captions only after text', async t => {
  const { subtitles } = harness(t, new Map()); await subtitles.load('https://media.test/video.bin');
  const packet = sei([[0, 0x14, 0x20], [0, 0x14, 0x40], [0, 0x48, 0x49], [0, 0x14, 0x2f]]);
  assert.equal(captionTriples(packet, 1).length, 4); subtitles.appendCaptionPacket(packet, 1, 'avc1'); subtitles.update(1.1);
  assert.equal(subtitles.tracks.length, 1); const track = subtitles.tracks[0]; track.mode = 'showing'; subtitles.update(1.2);
  assert.equal(track.activeCues[0].text, 'HI');
  subtitles.appendCaptionPacket(sei([[0, 0x14, 0x2c]]), 2, 'avc1'); subtitles.update(2);
  assert.equal(track.activeCues.length, 0);
});

test('CEA708 service packet assembly defines visible windows and clears them', () => {
  const events = [], parser = new DigitalCaptionParser((id, text, time) => events.push([id,text,time]));
  const bytes = [0x2b, 0x98, 0x20,0,0,0,0,0, 0x48,0x49, 0x03, 0x00]; // Service 1, 11-byte window/text block.
  parser.add({ type: 3, a: 7, b: bytes[0], timestamp: 1 });
  for (let i = 1; i < 13; i += 2) parser.add({ type: 2, a: bytes[i] ?? 0, b: bytes[i+1] ?? 0, timestamp: 1 });
  assert.deepEqual(events[0], [1,'HI',1]);
  parser.parse([0x22, 0x88, 0x01], 2); assert.deepEqual(events.at(-1), [1,'',2]);
});

test('malformed BMFF sizes and out-of-bounds subtitle sample offsets are rejected', () => {
  assert.throws(() => parseSubtitleInit(cat(uint(99), enc('moov'))), /Truncated/);
  const data = fragment(box('vttc', box('payl', enc('cue'))));
  const broken = data.slice(); const trun = Buffer.from(broken).indexOf('trun'); new DataView(broken.buffer).setInt32(trun + 12, 999999);
  assert.throws(() => parseSubtitleFragment(broken, parseSubtitleInit(init('wvtt'))), /Truncated/);
});

test('AES key requests abort on source replacement and late keys cannot publish old cues', async t => {
  const base = 'https://media.test/', key = new Uint8Array(16).fill(8), iv = new Uint8Array(16);
  let finishKey, keyRequested = false, keyAborted = false;
  const encrypted = await aes(enc('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOld\n'), key, iv);
  const resources = new Map([[base + 'master.m3u8', master], [base + 'text.m3u8', '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key",IV=0x0\n#EXTINF:2,\npart\n#EXT-X-ENDLIST\n'], [base + 'part', encrypted],
    [base + 'key', options => { keyRequested = true; options.signal.addEventListener('abort', () => { keyAborted = true; }); return new Promise(resolve => { finishKey = () => resolve(new Response(key)); }); }],
    [base + 'new.vtt', 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nCurrent\n']]);
  const { subtitles } = harness(t, resources); await subtitles.load(base + 'master.m3u8', 'application/x-mpegurl'); await until(() => keyRequested);
  await subtitles.load(base + 'new.vtt', 'text/vtt'); await until(() => subtitles.tracks[0].cues.length === 1); finishKey();
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(keyAborted, true); assert.equal(subtitles.tracks.length, 1); assert.equal(subtitles.tracks[0].cues[0].text, 'Current');
});

test('CEA708 AVC SEI creates service text and clears it without exposing empty tracks', async t => {
  const { subtitles } = harness(t, new Map()); await subtitles.load('https://media.test/video.bin'); assert.equal(subtitles.tracks.length, 0);
  const bytes = [0x2b, 0x98, 0x20,0,0,0,0,0, 0x48,0x49, 0x03, 0x00, 0x00], triples = [[3, 7, bytes[0]]];
  for (let i = 1; i < 13; i += 2) triples.push([2,bytes[i],bytes[i+1]]);
  subtitles.appendCaptionPacket(sei(triples), 1, 'avc1'); subtitles.update(1); assert.equal(subtitles.tracks.length, 1);
  const track = subtitles.tracks[0]; track.mode = 'showing'; subtitles.update(1.5); assert.equal(track.activeCues[0].text, 'HI');
  subtitles.appendCaptionPacket(sei([[3,0x42,0x22],[2,0x88,0x01]]), 2, 'avc1'); subtitles.update(2); assert.equal(track.activeCues.length, 0);
});

test('caption SEI accepts AVCC one-byte NAL lengths and Annex B start codes', () => {
  const avcc = sei([[0,0x48,0x49]]), nal = avcc.subarray(4), config = { description: new Uint8Array([1,0,0,0,0]) };
  assert.equal(captionTriples(cat(new Uint8Array([nal.length]), nal), 1, 'avc1', config).length, 1);
  assert.equal(captionTriples(cat(new Uint8Array([0,0,0,1]), nal), 1, 'avc1').length, 1);
});

test('real MPEGTS media demux preserves embedded CEA608 SEI for the browser caption path', async t => {
  const { Input, UrlSource, ALL_FORMATS, EncodedPacketSink } = await import('../../site/play/vendor/mediabunny/mediabunny.min.js');
  const data = new Uint8Array(readFileSync(new URL('./fixtures/embedded-cea608.ts', import.meta.url)));
  const input = new Input({ source: new UrlSource('https://media.test/captions.ts', { fetchFn: async (_, options) => {
    const range = /bytes=(\d+)-(\d*)/.exec(new Headers(options.headers).get('Range') ?? '');
    if (!range) return new Response(data, { headers: { 'Content-Length': String(data.length) } });
    const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
    return new Response(data.slice(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': String(end - start + 1) } });
  } }), formats: ALL_FORMATS }); t.after(() => input.dispose());
  const track = await input.getPrimaryVideoTrack(), sink = new EncodedPacketSink(track), packet = await sink.getFirstPacket(), config = await track.getDecoderConfig();
  assert.ok(packet); assert.equal(await track.getCodec(), 'avc'); assert.equal(captionTriples(packet.data, packet.timestamp, 'avc', config).length, 4);
  const { subtitles } = harness(t, new Map()); await subtitles.load('https://media.test/captions.bin');
  subtitles.appendCaptionPacket(packet.data, 0, 'avc', config); subtitles.update(.1);
  assert.equal(subtitles.tracks[0].cues.some(cue => cue.text === 'HI'), true);
});

test('encrypted HLS mixed embedded timed text observes playlist keys without refetching AV payloads', async t => {
  const base = 'https://media.test/', key = new Uint8Array(16).fill(4), iv = new Uint8Array(16), sequenceIV = new Uint8Array(16); sequenceIV[15] = 8;
  const { subtitles, calls } = harness(t, new Map([[base + 'key', key]])); await subtitles.load(base + 'video.bin');
  const playlist = '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:8\n#EXT-X-KEY:METHOD=AES-128,URI="key",IV=0x0\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:2,\npart.m4s\n#EXT-X-ENDLIST\n';
  await subtitles.inspectMediaResource(base + 'video.m3u8', new Response(playlist, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } }));
  await subtitles.inspectMediaResource(base + 'init.mp4', new Response(await aes(init('wvtt'), key, iv)));
  await subtitles.inspectMediaResource(base + 'part.m4s', new Response(await aes(fragment(box('vttc', box('payl', enc('Mixed encrypted')))), key, sequenceIV)), { origin: 10 });
  assert.equal(subtitles.tracks.length, 1); assert.equal(subtitles.tracks[0].cues[0].text, 'Mixed encrypted'); assert.equal(subtitles.tracks[0].cues[0].startTime, 0);
  // Two key declarations may reuse a URI; re-read each while reusing observed AV bytes.
  assert.deepEqual(calls.map(call => call.url), [base + 'key', base + 'key']);
});

test('lookahead caption packets are activated only at their media timestamp', async t => {
  const { subtitles } = harness(t, new Map()); await subtitles.load('https://media.test/video.bin');
  subtitles.appendCaptionPacket(sei([[0,0x14,0x20],[0,0x14,0x40],[0,0x48,0x49],[0,0x14,0x2f]]), 3, 'avc');
  subtitles.update(1); assert.equal(subtitles.tracks.length, 0);
  subtitles.update(3.1); assert.equal(subtitles.tracks[0].cues[0].text, 'HI');
});

test('embedded cues observed before media metadata rebase when the source origin becomes known', async t => {
  const { subtitles } = harness(t, new Map()); await subtitles.load('https://media.test/video.bin');
  await subtitles.inspectMediaResource('https://media.test/init.mp4', new Response(init('wvtt')));
  await subtitles.inspectMediaResource('https://media.test/part.m4s', new Response(fragment(box('vttc', box('payl', enc('Early observation'))))), { origin: null });
  const track = subtitles.tracks[0]; assert.equal(track.cues[0].startTime, 10);
  subtitles.setMediaOrigin(10); assert.equal(track.cues[0].startTime, 0);
  track.mode = 'showing'; subtitles.update(1); assert.equal(track.activeCues[0].text, 'Early observation');
});

test('mixed HLS fragmented MP4 subtitles align raw video tfdt with the logical playlist clock', async t => {
  const { subtitles } = harness(t, new Map()); await subtitles.load('https://media.test/video.bin');
  const videoTrack = box('trak', box('tkhd', full(0,uint(0),uint(0),uint(2))), box('mdia', box('mdhd', full(0,uint(0),uint(0),uint(1000),uint(0),new Uint8Array([0x15,0xc7,0,0]))), box('hdlr', full(0,uint(0),enc('vide')))));
  const textInit = init('wvtt'); const initialization = box('moov', textInit.subarray(8), videoTrack);
  const textData = box('vttc',box('payl',enc('Shifted timeline'))), videoData = new Uint8Array([1,2,3,4]);
  const fragmentWithVideo = time => {
    const header = offset => box('moof', box('mfhd',full(0,uint(1))),
      box('traf',box('tfhd',full(0x20000,uint(2))),box('tfdt',full(0,uint(time))),box('trun',full(0x301,uint(1),uint(offset),uint(2000),uint(videoData.length)))),
      box('traf',box('tfhd',full(0x20000,uint(1))),box('tfdt',full(0,uint(time + 10))),box('trun',full(0x301,uint(1),uint(offset + videoData.length),uint(1900),uint(textData.length)))));
    const prefix = header(0); return cat(header(prefix.length + 8),box('mdat',videoData,textData));
  };
  await subtitles.inspectMediaResource('https://media.test/video.m3u8', new Response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\npart0.m4s\n#EXTINF:2,\npart1.m4s\n#EXT-X-ENDLIST\n'));
  await subtitles.inspectMediaResource('https://media.test/init.mp4',new Response(initialization));
  await subtitles.inspectMediaResource('https://media.test/part0.m4s',new Response(fragmentWithVideo(90000)),{origin:0});
  await subtitles.inspectMediaResource('https://media.test/part1.m4s',new Response(fragmentWithVideo(92000)),{origin:0});
  const track = subtitles.tracks[0]; assert.ok(Math.abs(track.cues[0].startTime - .01) < 1e-9); assert.ok(Math.abs(track.cues[1].startTime - 2.01) < 1e-9);
  track.mode='showing'; subtitles.update(.5); assert.equal(track.activeCues[0].text,'Shifted timeline');
});
