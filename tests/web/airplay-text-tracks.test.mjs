import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaTextTracks, resolveSubtitleUrl } from '../../site/play/airplay-text-tracks.js';

const vtt = (start, end, text, map = '') => `WEBVTT\n${map}\n\n${start} --> ${end}\n${text}\n`;
const clock = seconds => `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.000`;
async function until(check) {
  for (let turn = 0; turn < 100; turn++) {
    if (check()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Subtitle work did not settle');
}
function harness(t, resources) {
  const requests = [];
  const subtitles = createMediaTextTracks({ fetchResource: async (url, init) => {
    requests.push({ url, init });
    assert.equal(init.referrerPolicy, 'no-referrer');
    const content = resources.get(url);
    assert.notEqual(content, undefined, `Unexpected subtitle resource: ${url}`);
    return content instanceof Function ? content(init) : new Response(content);
  } });
  t.after(() => subtitles.dispose());
  return { subtitles, requests };
}

test('standalone WebVTT follows the TiPlay clock, keeps literal text safe and clears disabled cues', async t => {
  const source = 'https://media.test/captions.vtt';
  const { subtitles } = harness(t, new Map([[source,
    'WEBVTT\n\nNOTE this block is ignored\nno cue\n\nfirst\n00:00:01.000 --> 00:00:03.000 align:start\n<b>Safe</b> &amp; <img src=x>\nSecond line\n\n00:00:04.000 --> 00:00:05.000\nLater\n',
  ]]));
  const events = [];
  subtitles.tracks.addEventListener('addtrack', event => events.push(event.track));
  await subtitles.load(source, 'text/vtt');
  await until(() => subtitles.tracks[0].cues.length === 2);
  const track = subtitles.tracks[0];
  assert.equal(subtitles.tracks.length, 1);
  assert.equal(subtitles.tracks.getTrackById(track.id), track);
  assert.deepEqual([...subtitles.tracks], [track]);
  assert.deepEqual(events, [track]);
  assert.equal(track.cues[0].text, 'Safe & <img src=x>\nSecond line');
  let changes = 0;
  track.addEventListener('cuechange', () => changes++);
  subtitles.update(1); assert.equal(track.activeCues[0].id, 'first');
  subtitles.update(2); assert.equal(changes, 1);
  subtitles.update(3); assert.equal(track.activeCues.length, 0);
  subtitles.update(4); assert.equal(track.activeCues[0].text, 'Later');
  track.mode = 'disabled'; assert.equal(track.activeCues.length, 0);
  track.mode = 'hidden'; assert.equal(track.activeCues[0].text, 'Later');
  subtitles.update(1); assert.equal(track.activeCues[0].id, 'first');
});

test('HLS subtitle discovery retains authenticated routes and handles MPEGTS wrap and discontinuities', async t => {
  const base = 'https://phone.test/airplay-resource?id=7&r=root&c=pair&s=session';
  const child = resource => resolveSubtitleUrl(`?r=${resource}`, base);
  const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="text",NAME="English, CC",LANGUAGE="en",DEFAULT=YES,URI="?r=track"\n';
  const playlist = '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\n?r=part0\n#EXTINF:10,\n?r=part1\n#EXT-X-DISCONTINUITY\n#EXTINF:10,\n?r=part2\n#EXT-X-ENDLIST\n';
  const beforeWrap = 2 ** 33 - 450000;
  const resources = new Map([[base, master], [child('track'), playlist],
    [child('part0'), vtt(clock(1), clock(3), 'First', `X-TIMESTAMP-MAP=LOCAL:00:00.000,MPEGTS:${beforeWrap}`)],
    [child('part1'), vtt(clock(11), clock(13), 'Wrapped', 'X-TIMESTAMP-MAP=LOCAL:00:10.000,MPEGTS:450000')],
    [child('part2'), vtt(clock(1), clock(3), 'After discontinuity', 'X-TIMESTAMP-MAP=LOCAL:00:00.000,MPEGTS:100000')],
  ]);
  const { subtitles, requests } = harness(t, resources);
  await subtitles.load(base, 'application/vnd.apple.mpegurl');
  const track = subtitles.tracks[0];
  assert.equal(track.label, 'English, CC'); assert.equal(track.language, 'en'); assert.equal(track.mode, 'showing');
  await until(() => track.cues.length === 2);
  assert.deepEqual(track.cues.map(cue => [cue.startTime, cue.endTime]), [[1, 3], [11, 13]]);
  subtitles.update(11); assert.equal(track.activeCues[0].text, 'Wrapped');
  subtitles.update(21);
  await until(() => track.activeCues.some(cue => cue.text === 'After discontinuity'));
  assert.equal(track.activeCues[0].startTime, 21);
  for (const { url } of requests) {
    const resource = new URL(url);
    assert.equal(resource.searchParams.get('c'), 'pair');
    assert.equal(resource.searchParams.get('s'), 'session');
    assert.equal(resource.searchParams.get('id'), '7');
  }
  assert.equal(new URL(resolveSubtitleUrl('https://other.test/captions.vtt', base)).searchParams.has('c'), false);
  assert.throws(() => resolveSubtitleUrl('javascript:alert(1)', base), /Unsupported/);
});

test('segmented WebVTT requests honor explicit and implicit byte ranges', async t => {
  const master = 'https://media.test/master.m3u8', playlist = 'https://media.test/subtitles.m3u8', source = 'https://media.test/subtitles.vtt';
  const first = vtt(clock(1), clock(3), 'First range'), second = vtt(clock(11), clock(13), 'Second range');
  const firstLength = new TextEncoder().encode(first).length, secondLength = new TextEncoder().encode(second).length;
  const resources = new Map([[master, '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="English",DEFAULT=YES,URI="subtitles.m3u8"\n'],
    [playlist, `#EXTM3U\n#EXTINF:10,\n#EXT-X-BYTERANGE:${firstLength}@0\nsubtitles.vtt\n#EXTINF:10,\n#EXT-X-BYTERANGE:${secondLength}\nsubtitles.vtt\n#EXT-X-ENDLIST\n`],
    [source, init => new Response(init.headers.Range === `bytes=0-${firstLength - 1}` ? first : second, { status: 206 })],
  ]);
  const { subtitles, requests } = harness(t, resources);
  await subtitles.load(master, 'application/x-mpegurl');
  await until(() => subtitles.tracks[0].cues.length === 2);
  assert.deepEqual(requests.filter(request => request.url === source).map(request => request.init.headers.Range),
    [`bytes=0-${firstLength - 1}`, `bytes=${firstLength}-${firstLength + secondLength - 1}`]);
  subtitles.update(11); assert.equal(subtitles.tracks[0].activeCues[0].text, 'Second range');
});

test('source replacement and disposal isolate late subtitle fetch callbacks', async t => {
  let complete;
  const delayed = new Promise(resolve => { complete = resolve; });
  const old = 'https://media.test/old.m3u8', current = 'https://media.test/current.vtt';
  const { subtitles } = harness(t, new Map([[old, () => delayed], [current, vtt(clock(0), clock(5), 'Current')]]));
  const loading = subtitles.load(old, 'application/x-mpegurl');
  const rejected = assert.rejects(loading, error => error.name === 'AbortError');
  await subtitles.load(current, 'text/vtt');
  await until(() => subtitles.tracks[0].cues.length === 1);
  complete(new Response('#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="Old",DEFAULT=YES,URI="stale.m3u8"\n'));
  await rejected;
  assert.equal(subtitles.tracks.length, 1);
  assert.equal(subtitles.tracks[0].cues[0].text, 'Current');
  subtitles.update(1); assert.equal(subtitles.tracks[0].activeCues.length, 1);
  const track = subtitles.tracks[0];
  subtitles.dispose(); subtitles.update(2);
  assert.equal(track.activeCues.length, 0); assert.equal(subtitles.tracks.length, 0);
  track.mode = 'showing'; assert.equal(subtitles.tracks.length, 0);
});

test('oversized and encrypted subtitle resources report track errors without stopping media', async t => {
  const source = 'https://media.test/big.vtt';
  const { subtitles } = harness(t, new Map([[source, () => new Response('WEBVTT\n', { headers: { 'Content-Length': String(2 * 1024 * 1024) } })]]));
  const errors = [];
  subtitles.tracks.addEventListener('error', event => errors.push(event.error));
  await subtitles.load(source, 'text/vtt');
  await until(() => errors.length === 1);
  assert.match(errors[0].message, /too large/);
  assert.equal(subtitles.tracks[0].cues.length, 0);
  const count = errors.length; subtitles.update(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(errors.length, count);
  const master = 'https://media.test/master.m3u8', playlist = 'https://media.test/encrypted.m3u8';
  const encrypted = harness(t, new Map([[master, '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="Text",DEFAULT=YES,URI="encrypted.m3u8"\n'],
    [playlist, '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:2,\ntext.vtt\n#EXT-X-ENDLIST\n'],
  ]));
  await encrypted.subtitles.load(master, 'application/x-mpegurl');
  await until(() => encrypted.subtitles.tracks[0].error);
  assert.match(encrypted.subtitles.tracks[0].error.message, /Encrypted/);
  encrypted.subtitles.update(1);
  assert.equal(encrypted.requests.length, 2);
});

test('manual text tracks notify the adapter and update active cues without loading media', () => {
  const subtitles = createMediaTextTracks({ fetchResource: assert.fail });
  const events = [];
  subtitles.tracks.addEventListener('addtrack', event => events.push(event.track));
  const track = subtitles.addTextTrack('captions', 'Manual', 'en');
  assert.equal(track.mode, 'hidden'); assert.deepEqual(events, [track]);
  const cue = { id: 'cue', startTime: 1, endTime: 3, text: '<b>Manual</b> &amp; safe' };
  track.addCue(cue); subtitles.update(2);
  assert.equal(track.activeCues[0].text, 'Manual & safe');
  track.removeCue(cue); assert.equal(track.activeCues.length, 0);
  subtitles.dispose();
});

test('subtitle segment cache stays bounded and re-fetches an evicted seek target', async t => {
  const master = 'https://media.test/master.m3u8', playlist = 'https://media.test/text.m3u8';
  const resources = new Map([[master, '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="Text",DEFAULT=YES,URI="text.m3u8"\n']]);
  resources.set(playlist, '#EXTM3U\n' + Array.from({ length: 20 }, (_, index) => `#EXTINF:2,\npart${index}.vtt\n`).join('') + '#EXT-X-ENDLIST\n');
  for (let index = 0; index < 20; index++) resources.set(`https://media.test/part${index}.vtt`, vtt(clock(index * 2), clock(index * 2 + 1), `Cue ${index}`));
  const { subtitles, requests } = harness(t, resources);
  await subtitles.load(master, 'application/x-mpegurl');
  const track = subtitles.tracks[0];
  await until(() => track.cues.length === 2);
  for (let index = 2; index < 20; index++) {
    subtitles.update(index * 2);
    await until(() => track.activeCues[0]?.text === `Cue ${index}`);
  }
  assert.ok(track.cues.length <= 6);
  assert.equal(track.cues.some(cue => cue.text === 'Cue 0'), false);
  const before = requests.filter(request => request.url === 'https://media.test/part0.vtt').length;
  subtitles.update(0);
  await until(() => track.activeCues[0]?.text === 'Cue 0');
  assert.equal(requests.filter(request => request.url === 'https://media.test/part0.vtt').length, before + 1);
});

test('subtitle fetches are limited to two concurrent requests and session cancellation drains queued work', async t => {
  const master = 'https://media.test/master.m3u8', pending = [], calls = [];
  let active = 0, maximum = 0;
  const abort = new AbortController();
  const subtitles = createMediaTextTracks({ signal: abort.signal, fetchResource: async (url, init) => {
    calls.push(url);
    if (url === master) return new Response('#EXTM3U\n' + Array.from({ length: 5 }, (_, index) =>
      `#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="Text ${index}",URI="text${index}.m3u8"\n`).join(''));
    active++; maximum = Math.max(maximum, active);
    return new Promise((resolve, reject) => {
      const cancel = () => { active--; reject(new DOMException('Cancelled', 'AbortError')); };
      init.signal.addEventListener('abort', cancel, { once: true });
      pending.push(() => {
        init.signal.removeEventListener('abort', cancel); active--;
        resolve(new Response('#EXTM3U\n#EXT-X-ENDLIST\n'));
      });
    });
  } });
  t.after(() => subtitles.dispose());
  await subtitles.load(master, 'application/x-mpegurl');
  for (const track of subtitles.tracks) track.mode = 'hidden';
  await until(() => pending.length === 2);
  assert.equal(maximum, 2); assert.equal(calls.length, 3);
  abort.abort();
  await until(() => active === 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 3); assert.equal(subtitles.tracks.length, 0);
});

test('live subtitle refresh preserves overlap timestamps instead of resetting the sliding window to zero', async t => {
  const master = 'https://media.test/master.m3u8', playlist = 'https://media.test/live.m3u8';
  let refresh = 0, now = Date.now();
  const realDateNow = Date.now;
  Date.now = () => now;
  t.after(() => { Date.now = realDateNow; });
  const resources = new Map([[master, '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="Text",DEFAULT=YES,URI="live.m3u8"\n'],
    [playlist, () => new Response(++refresh === 1
      ? '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:10\n#EXTINF:2,\npart10.vtt\n#EXTINF:2,\npart11.vtt\n'
      : '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:11\n#EXTINF:2,\npart11.vtt\n#EXTINF:2,\npart12.vtt\n')],
    ['https://media.test/part10.vtt', vtt(clock(0), clock(1), 'Old')],
    ['https://media.test/part11.vtt', vtt(clock(2), clock(3), 'Overlap')],
    ['https://media.test/part12.vtt', vtt(clock(4), clock(5), 'New')],
  ]);
  const { subtitles } = harness(t, resources);
  await subtitles.load(master, 'application/x-mpegurl');
  const track = subtitles.tracks[0];
  await until(() => track.cues.length === 2);
  now += 3000; subtitles.update(4);
  await until(() => track.activeCues[0]?.text === 'New');
  assert.equal(track.activeCues[0].startTime, 4);
  assert.equal(refresh, 2);
});

test('redirected HLS subtitle playlists resolve children against the final response URL', async t => {
  const master = 'https://media.test/master.m3u8', playlist = 'https://media.test/moved/text.m3u8', segment = 'https://media.test/moved/part.vtt';
  const response = new Response('#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="Text",DEFAULT=YES,URI="text.m3u8"\n');
  Object.defineProperty(response, 'url', { value: 'https://media.test/moved/master.m3u8' });
  const resources = new Map([[master, () => response], [playlist, '#EXTM3U\n#EXTINF:2,\npart.vtt\n#EXT-X-ENDLIST\n'],
    [segment, vtt(clock(0), clock(1), 'Redirected')],
  ]);
  const { subtitles } = harness(t, resources);
  await subtitles.load(master, 'application/x-mpegurl');
  await until(() => subtitles.tracks[0].cues.length === 1);
  assert.equal(subtitles.tracks[0].cues[0].text, 'Redirected');
});

test('high frequency clock updates activate short cues and reuse the loaded caption window', async t => {
  const master = 'https://media.test/master.m3u8', playlist = 'https://media.test/text.m3u8', segment = 'https://media.test/part.vtt';
  const { subtitles, requests } = harness(t, new Map([[master, '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="Text",DEFAULT=YES,URI="text.m3u8"\n'],
    [playlist, '#EXTM3U\n#EXTINF:2,\npart.vtt\n#EXT-X-ENDLIST\n'], [segment, vtt('00:00:00.100', '00:00:00.150', 'Brief')],
  ]));
  await subtitles.load(master, 'application/x-mpegurl');
  const track = subtitles.tracks[0];
  await until(() => track.cues.length === 1);
  const cues = track.cues;
  subtitles.update(0.1); assert.equal(track.activeCues[0].text, 'Brief');
  subtitles.update(0.15); assert.equal(track.activeCues.length, 0);
  for (let index = 0; index < 60; index++) subtitles.update(index / 60);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 3);
  assert.equal(track.cues, cues, 'Clock updates must not rebuild unchanged cue collections');
});

test('a large seek cancels slow caption work for the abandoned playback window', async t => {
  const master = 'https://media.test/master.m3u8', playlist = 'https://media.test/text.m3u8';
  let oldRequested = false, cancelled = false;
  const resources = new Map([[master, '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="Text",DEFAULT=YES,URI="text.m3u8"\n'],
    [playlist, '#EXTM3U\n#EXT-X-TARGETDURATION:1\n' + Array.from({ length: 30 }, (_, index) => `#EXTINF:1,\npart${index}.vtt\n`).join('') + '#EXT-X-ENDLIST\n'],
  ]);
  for (let index = 0; index < 30; index++) resources.set(`https://media.test/part${index}.vtt`, vtt(clock(index), clock(index + 1), `Cue ${index}`));
  resources.set('https://media.test/part0.vtt', init => {
    if (oldRequested) return new Response(vtt(clock(0), clock(1), 'Cue 0'));
    oldRequested = true;
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => {
      cancelled = true; reject(new DOMException('Cancelled', 'AbortError'));
    }, { once: true }));
  });
  const { subtitles } = harness(t, resources);
  await subtitles.load(master, 'application/x-mpegurl');
  await until(() => oldRequested);
  subtitles.update(20);
  await until(() => subtitles.tracks[0].activeCues[0]?.text === 'Cue 20');
  assert.equal(cancelled, true); assert.equal(subtitles.tracks[0].error, null);
});
