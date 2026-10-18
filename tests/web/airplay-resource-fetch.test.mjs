import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSerialMediaFetch } from '../../site/play/airplay-resource-fetch.js';
import { selectPlayableTrack, decodableAudioTracks } from '../../site/play/airplay-track-selection.js';
import { Input, UrlSource, ALL_FORMATS, EncodedPacketSink } from '../../site/play/vendor/mediabunny/mediabunny.min.js';

const origin = 'https://fixture.test';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(resources, { ignoreRange = false, unknownLength = false, unknownPartialTotal = false, chunkBytes = 1024, delay = 0 } = {}) {
  const state = { active: 0, peak: 0, requests: [] };
  const fetcher = async (url, init) => {
    const parsed = new URL(String(url)); assert.equal(parsed.origin, origin);
    const range = new Headers(init.headers).get('Range');
    const request = { path: parsed.pathname, range, bytes: 0 }; state.requests.push(request);
    const resource = resources[parsed.pathname];
    const bytes = Buffer.from(resource?.bytes ?? resource ?? 'Unavailable');
    let status = resource?.status ?? (resource === undefined ? 404 : 200), start = 0, end = bytes.length - 1;
    const headers = new Headers({ 'Content-Type': resource?.type ?? 'application/octet-stream' });
    const match = /^bytes=(\d*)-(\d*)$/.exec(range || '');
    if (status === 200 && match && !ignoreRange) {
      start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      status = start >= bytes.length ? 416 : 206;
      headers.set('Content-Range', status === 416 ? `bytes */${bytes.length}` : `bytes ${start}-${end}/${unknownPartialTotal ? '*' : bytes.length}`);
    }
    const bodyBytes = status === 416 ? Buffer.alloc(0) : bytes.subarray(start, end + 1);
    if (!unknownLength) headers.set('Content-Length', String(bodyBytes.length));
    state.active++; state.peak = Math.max(state.peak, state.active);
    let position = 0, finished = false, streamController;
    const finish = reason => {
      if (finished) return;
      finished = true; request.reason = reason; state.active--;
      init.signal.removeEventListener('abort', abort);
    };
    const abort = () => { finish('abort'); try { streamController?.error(init.signal.reason); } catch (_) {} };
    const body = new ReadableStream({
      start(stream) { streamController = stream; init.signal.addEventListener('abort', abort, { once: true }); },
      async pull(stream) {
        if (delay) await wait(delay);
        if (finished) return;
        if (position >= bodyBytes.length) { finish('eof'); stream.close(); return; }
        const next = bodyBytes.subarray(position, position + chunkBytes); position += next.length; request.bytes += next.length;
        stream.enqueue(next);
      },
      cancel() { finish('cancel'); },
    }, { highWaterMark: 0 });
    const response = new Response(body, { status, headers });
    Object.defineProperty(response, 'url', { value: parsed.href });
    return response;
  };
  return { state, fetcher };
}

test('finite network units serialize full body lifetimes and preserve absolute media ranges', async () => {
  const bytes = Buffer.from(Array.from({ length: 10000 }, (_, i) => i % 251));
  const { fetcher, state } = fixture({ '/movie': bytes, '/map': bytes }, { delay: 1, chunkBytes: 257 });
  const serial = createSerialMediaFetch(fetcher, { unitBytes: 1024 });
  try {
    const head = await serial(`${origin}/movie`, { headers: { Range: 'bytes=0-' } });
    assert.equal(head.status, 206); assert.equal(head.headers.get('Content-Range'), 'bytes 0-9999/10000');
    assert.equal(state.active, 0, 'First actual unit ended before the logical response is returned');
    const [tail, map] = await Promise.all([
      serial(`${origin}/movie`, { headers: { Range: 'bytes=9000-9999' } }).then(r => r.arrayBuffer()),
      serial(`${origin}/map`, { headers: { Range: 'bytes=24-39' } }).then(r => r.arrayBuffer()),
    ]);
    assert.deepEqual(Buffer.from(tail), bytes.subarray(9000)); assert.deepEqual(Buffer.from(map), bytes.subarray(24, 40));
    assert.deepEqual(Buffer.from(await head.arrayBuffer()), bytes);
    assert.equal(state.peak, 1); assert.equal(state.active, 0);
    assert.ok(state.requests.every(r => /^bytes=\d+-\d+$/.test(r.range)), 'Actual network ranges are finite');
    assert.ok(state.requests.some(r => r.path === '/map' && r.range === 'bytes=24-39'), 'MAP/BYTERANGE remains absolute');
  } finally { serial.dispose(); }
});

test('extensionless split-prefix HLS learns playlist children and never strips MAP/key/segment ranges', async () => {
  const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="/audio"\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.64000a"\n/variant\n';
  const child = '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MAP:URI="/map",BYTERANGE="16@20"\n#EXT-X-KEY:METHOD=AES-128,URI="/key"\n#EXTINF:1,\n/segment\n#EXT-X-ENDLIST\n';
  const { fetcher, state } = fixture({ '/root': master, '/variant': child, '/audio': child,
    '/map': Buffer.alloc(100), '/key': Buffer.alloc(16), '/segment': Buffer.alloc(100) }, { chunkBytes: 2 });
  const serial = createSerialMediaFetch(fetcher, { unitBytes: 32 });
  try {
    assert.equal((await serial(`${origin}/root`, { headers: { Range: 'bytes=0-' } })).status, 200);
    await Promise.all(['/variant', '/audio'].map(path => serial(origin + path, { headers: { Range: 'bytes=0-' } }).then(r => r.text())));
    await serial(`${origin}/map`, { headers: { Range: 'bytes=20-35' } }).then(r => r.arrayBuffer());
    await serial(`${origin}/key`, { headers: { Range: 'bytes=0-15' } }).then(r => r.arrayBuffer());
    await serial(`${origin}/segment`, { headers: { Range: 'bytes=2-8' } }).then(r => r.arrayBuffer());
    assert.ok(state.requests.filter(r => ['/variant', '/audio'].includes(r.path)).every(r => r.range === null));
    assert.equal(state.requests.find(r => r.path === '/map').range, 'bytes=20-35');
    assert.equal(state.requests.find(r => r.path === '/key').range, 'bytes=0-15');
    assert.equal(state.peak, 1); assert.equal(state.active, 0);
  } finally { serial.dispose(); }
});

test('real Mediabunny metadata ranking and one failed candidate recover without eager child discovery or overlapping bodies', async () => {
  const segment = await readFile(new URL('./fixtures/hls-ts/index0.ts', import.meta.url));
  const rows = ['#EXTM3U', '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="/audio"'];
  const resources = { '/audio': '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n/audio.ts\n#EXT-X-ENDLIST\n', '/audio.ts': segment };
  for (let i = 0; i < 16; i++) {
    const index = Math.min(i, 13);
    rows.push(`#EXT-X-STREAM-INF:BANDWIDTH=${100 + index},RESOLUTION=32x18,CODECS="avc1.64000a,mp4a.40.2",AUDIO="a"`, `/v${index}`);
    resources[`/v${index}`] = index === 13 ? { status: 404, bytes: 'Missing preferred rendition' }
      : `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n/v${index}.ts\n#EXT-X-ENDLIST\n`;
    resources[`/v${index}.ts`] = segment;
  }
  resources['/master'] = rows.join('\n');
  const { fetcher, state } = fixture(resources, { chunkBytes: 123, delay: 1 });
  const serial = createSerialMediaFetch(fetcher, { unitBytes: 2048, busyRetries: 0 });
  const previousVideo = globalThis.VideoDecoder, previousAudio = globalThis.AudioDecoder;
  globalThis.VideoDecoder = { isConfigSupported: async config => ({ config, supported: true }) };
  globalThis.AudioDecoder = { isConfigSupported: async config => ({ config, supported: true }) };
  const input = new Input({ source: new UrlSource(`${origin}/master`, { fetchFn: serial, parallelism: 1, getRetryDelay: () => null }), formats: ALL_FORMATS });
  try {
    await input.getPrimaryVideoTrack();
    assert.ok(state.requests.every(r => r.path === '/master'), 'Default primary ranking only reads master metadata');
    const video = await selectPlayableTrack(query => input.getPrimaryVideoTrack(query), { video: true });
    const audio = await decodableAudioTracks(await video.getPairableAudioTracks());
    assert.equal(await video.getCodec(), 'avc'); assert.equal(audio.length, 1);
    const packet = await new EncodedPacketSink(video).getFirstPacket(); assert.ok(packet.data.length);
    assert.deepEqual([...new Set(state.requests.filter(r => /^\/v\d+$/.test(r.path)).map(r => r.path))], ['/v13', '/v12']);
    assert.ok(state.requests.filter(r => /^\/v\d+$/.test(r.path)).every(r => r.range === null), 'Master-declared child playlists use whole requests');
    assert.equal(state.peak, 1);
  } finally { input.dispose(); serial.dispose(); globalThis.VideoDecoder = previousVideo; globalThis.AudioDecoder = previousAudio; }
  assert.equal(state.active, 0);
});

function tailMoov(fastStart, padding = 1024 * 1024) {
  const boxes = []; for (let at = 0; at < fastStart.length;) { const size = fastStart.readUInt32BE(at); boxes.push({ at, type: fastStart.toString('ascii', at + 4, at + 8), bytes: fastStart.subarray(at, at + size) }); at += size; }
  const ftyp = boxes.find(b => b.type === 'ftyp').bytes, oldMdat = boxes.find(b => b.type === 'mdat');
  const moov = Buffer.from(boxes.find(b => b.type === 'moov').bytes), free = Buffer.alloc(padding);
  free.writeUInt32BE(padding); free.write('free', 4);
  const delta = ftyp.length + free.length - oldMdat.at;
  for (let at = moov.indexOf('stco'); at >= 0; at = moov.indexOf('stco', at + 4)) {
    const count = moov.readUInt32BE(at + 8);
    for (let i = 0; i < count; i++) moov.writeUInt32BE(moov.readUInt32BE(at + 12 + i * 4) + delta, at + 12 + i * 4);
  }
  return Buffer.concat([ftyp, free, oldMdat.bytes, moov]);
}
for (const ignoreRange of [false, true]) test(`real tail-moov MP4 demux and packet seek make progress with ignored Range=${ignoreRange}`, async () => {
  const data = tailMoov(await readFile(new URL('./fixtures/embedded-tx3g.mp4', import.meta.url)));
  const { fetcher, state } = fixture({ '/movie': data }, { ignoreRange, chunkBytes: 8192 });
  const serial = createSerialMediaFetch(fetcher, { unitBytes: 32768 });
  const input = new Input({ source: new UrlSource(`${origin}/movie`, { fetchFn: serial, parallelism: 1, getRetryDelay: () => null }), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack(); assert.equal(await video.getDisplayWidth(), 16);
    const packets = new EncodedPacketSink(video);
    assert.ok((await packets.getFirstPacket()).data.length);
    assert.ok((await packets.getPacket(2)).data.length);
    if (ignoreRange) {
      assert.ok(state.requests.reduce((total, request) => total + request.bytes, 0) <= data.length * 2,
        'A sequential source does not redownload each old prefix for every network unit');
    } else assert.ok(state.requests.some(r => Number(/^bytes=(\d+)-/.exec(r.range)?.[1]) > 1000000), 'Demuxer requested the remote moov/media region');
    assert.equal(state.peak, 1); assert.equal(state.active, 0);
    assert.ok(state.requests.every(r => /bytes=\d+-\d+$/.test(r.range)));
  } finally { input.dispose(); serial.dispose(); }
});

test('a large source ignoring Range is consumed once with bounded units instead of repeatedly downloading its prefix', async () => {
  const bytes = Buffer.alloc(16 * 1024 * 1024, 42);
  const { fetcher, state } = fixture({ '/movie': bytes }, { ignoreRange: true, chunkBytes: 8192 });
  const serial = createSerialMediaFetch(fetcher);
  try {
    assert.deepEqual(Buffer.from(await (await serial(`${origin}/movie`, { headers: { Range: 'bytes=0-' } })).arrayBuffer()), bytes);
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].bytes, bytes.length);
    assert.equal(state.peak, 1); assert.equal(state.active, 0);
  } finally { serial.dispose(); }
});

test('a competing seek or resource retires an idle sequential body before opening the next body', async () => {
  const bytes = Buffer.from(Array.from({ length: 8192 }, (_, i) => i % 251));
  const { fetcher, state } = fixture({ '/movie': bytes, '/map': Buffer.alloc(32, 7) }, { ignoreRange: true, chunkBytes: 257 });
  const serial = createSerialMediaFetch(fetcher, { unitBytes: 1024 });
  try {
    const response = await serial(`${origin}/movie`, { headers: { Range: 'bytes=0-' } });
    const reader = response.body.getReader();
    assert.deepEqual(Buffer.from((await reader.read()).value), bytes.subarray(0, 1024));
    assert.equal(state.active, 1, 'The sequential reader is retained between units');
    assert.equal((await (await serial(`${origin}/map`)).arrayBuffer()).byteLength, 32);
    assert.deepEqual(Buffer.from((await reader.read()).value), bytes.subarray(1024, 2048));
    const footer = await serial(`${origin}/movie`, { headers: { Range: 'bytes=8000-8191' } });
    assert.deepEqual(Buffer.from(await footer.arrayBuffer()), bytes.subarray(8000));
    const backward = await serial(`${origin}/movie`, { headers: { Range: 'bytes=10-29' } });
    assert.deepEqual(Buffer.from(await backward.arrayBuffer()), bytes.subarray(10, 30));
    await reader.cancel();
    assert.equal(state.peak, 1);
  } finally { serial.dispose(); }
  assert.equal(state.active, 0);
});

test('sequential network deadlines restart per unit and cancellation releases the retained body', async () => {
  const { fetcher, state } = fixture({ '/movie': Buffer.alloc(8192, 42) }, { ignoreRange: true, chunkBytes: 257, delay: 1 });
  const serial = createSerialMediaFetch(fetcher, { unitBytes: 1024, deadline: 30 });
  try {
    const response = await serial(`${origin}/movie`, { headers: { Range: 'bytes=0-' } });
    const reader = response.body.getReader();
    for (let i = 0; i < 4; i++) { assert.equal((await reader.read()).value.length, 1024); await wait(15); }
    await reader.cancel();
    assert.equal(state.active, 0); assert.equal(state.peak, 1);
  } finally { serial.dispose(); }
});

test('retiring an initial whole 200 does not disable Range on a source which supports it', async () => {
  const bytes = Buffer.from(Array.from({ length: 8192 }, (_, i) => i % 251));
  const { fetcher, state } = fixture({ '/movie': bytes, '/map': Buffer.alloc(32) }, { chunkBytes: 257 });
  const serial = createSerialMediaFetch(fetcher, { unitBytes: 1024 });
  try {
    const reader = (await serial(`${origin}/movie`)).body.getReader();
    assert.deepEqual(Buffer.from((await reader.read()).value), bytes.subarray(0, 1024));
    await (await serial(`${origin}/map`)).arrayBuffer();
    assert.deepEqual(Buffer.from((await reader.read()).value), bytes.subarray(1024, 2048));
    assert.deepEqual(state.requests.filter(request => request.path === '/movie').map(request => request.range),
      [null, 'bytes=1024-2047']);
    await reader.cancel();
    assert.equal(state.peak, 1); assert.equal(state.active, 0);
  } finally { serial.dispose(); }
});

test('a competing network request waits for asynchronous sequential-reader cancellation', async () => {
  const requests = []; let releaseCancellation;
  const canceled = new Promise(resolve => { releaseCancellation = resolve; });
  const serial = createSerialMediaFetch(async url => {
    requests.push(String(url));
    return new Response(new ReadableStream({
      pull(stream) { stream.enqueue(new Uint8Array(1024).fill(42)); },
      cancel() { return String(url).endsWith('/movie') ? canceled : undefined; },
    }), { headers: { 'Content-Length': '8192' } });
  }, { unitBytes: 1024 });
  try {
    await serial(`${origin}/movie`);
    const next = serial(`${origin}/map`);
    await wait(0);
    assert.deepEqual(requests, [`${origin}/movie`]);
    releaseCancellation();
    const response = await next;
    assert.deepEqual(requests, [`${origin}/movie`, `${origin}/map`]);
    await response.body.cancel();
  } finally { releaseCancellation(); serial.dispose(); }
});

test('abandoned sequential bodies expire while idle and dispose releases an unread response', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fetcher, state } = fixture({ '/movie': Buffer.alloc(8192, 42) }, { ignoreRange: true });
  const serial = createSerialMediaFetch(fetcher, { unitBytes: 1024 });
  const response = await serial(`${origin}/movie`);
  assert.equal(state.active, 1);
  t.mock.timers.tick(5000);
  assert.equal(state.active, 0);
  const reader = response.body.getReader();
  assert.equal((await reader.read()).value.length, 1024);
  assert.equal((await reader.read()).value.length, 1024, 'An expired idle body reopens at the logical cursor');
  assert.equal(state.active, 1);
  serial.dispose();
  assert.equal(state.active, 0);
  await assert.rejects(reader.read(), { name: 'AbortError' });
});

test('unknown total ranges fall back to honest sequential 200 and finish exact-unit EOF without a fabricated 206', async () => {
  const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));
  const { fetcher, state } = fixture({ '/unknown': bytes }, { unknownLength: true, unknownPartialTotal: true, chunkBytes: 257 });
  const serial = createSerialMediaFetch(fetcher, { unitBytes: 1024 });
  try {
    const response = await serial(`${origin}/unknown`, { headers: { Range: 'bytes=0-' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Range'), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal(state.peak, 1); assert.equal(state.active, 0);
    assert.ok(state.requests.slice(1).every(r => r.range === null));
  } finally { serial.dispose(); }
});

test('an unknown-length server ignoring a finite Range still returns the entire sequential representation', async () => {
  const bytes = Buffer.alloc(3072, 97);
  const { fetcher, state } = fixture({ '/unknown': bytes }, { unknownLength: true, ignoreRange: true, chunkBytes: 131 });
  const serial = createSerialMediaFetch(fetcher, { unitBytes: 1024 });
  try {
    const response = await serial(`${origin}/unknown`, { headers: { Range: 'bytes=100-200' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Range'), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal(state.peak, 1); assert.equal(state.active, 0);
  } finally { serial.dispose(); }
});

test('a new forward Range cannot turn a retained unknown-length 200 into a truncated whole response', async () => {
  const bytes = Buffer.from(Array.from({ length: 8192 }, (_, i) => i % 251));
  const { fetcher, state } = fixture({ '/unknown': bytes }, { unknownLength: true, ignoreRange: true, chunkBytes: 131 });
  const serial = createSerialMediaFetch(fetcher, { unitBytes: 1024 });
  try {
    const first = (await serial(`${origin}/unknown`)).body.getReader();
    assert.deepEqual(Buffer.from((await first.read()).value), bytes.subarray(0, 1024));
    const response = await serial(`${origin}/unknown`, { headers: { Range: 'bytes=2048-2057' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Range'), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes,
      'An ignored Range still returns the whole resource from offset zero');
    assert.equal(state.requests.length, 2, 'The new logical request restarts once, then reuses its own sequential reader');
    assert.equal(state.peak, 1); assert.equal(state.active, 0);
    await first.cancel();
  } finally { serial.dispose(); }
});

test('suffix ranges retain their true absolute coordinates even when a server ignores Range', async () => {
  const bytes = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
  const { fetcher, state } = fixture({ '/movie': bytes }, { ignoreRange: true });
  const serial = createSerialMediaFetch(fetcher, { unitBytes: 4 });
  try {
    const response = await serial(`${origin}/movie`, { headers: { Range: 'bytes=-8' } });
    assert.equal(response.headers.get('Content-Range'), 'bytes 28-35/36');
    assert.equal(await response.text(), 'stuvwxyz'); assert.equal(state.active, 0);
  } finally { serial.dispose(); }
});

test('unsafe or contradictory Content-Range and truncated range bodies fail explicitly and unblock later jobs', async () => {
  for (const contentRange of ['bytes 9007199254740993-9007199254740999/9007199254741000', 'bytes 8-4/10', 'bytes 0-10/10', 'bytes 0-15/100']) {
    const serial = createSerialMediaFetch(async () => new Response('short', { status: 206, headers: { 'Content-Range': contentRange } }), { unitBytes: 16 });
    try { await assert.rejects(serial(`${origin}/bad`, { headers: { Range: 'bytes=0-' } }), /Invalid media range|Incomplete media resource/); }
    finally { serial.dispose(); }
  }
  const serial = createSerialMediaFetch(async () => new Response(Buffer.alloc(100), { status: 206, headers: { 'Content-Range': 'bytes 0-99/10000' } }));
  try { await assert.rejects(serial(`${origin}/old-range`, { headers: { Range: 'bytes=100-' } }), /range ends before/); }
  finally { serial.dispose(); }
});

test('abort while queued/body reading, logical response cancel, errors and dispose release resources without poisoning the next job', async () => {
  const { fetcher, state } = fixture({ '/slow': Buffer.alloc(10000), '/good': 'Available', '/bad': { status: 502, bytes: 'upstream error' } }, { chunkBytes: 2, delay: 1 });
  const serial = createSerialMediaFetch(fetcher, { unitBytes: 32, busyRetries: 0 });
  const active = new AbortController(), queued = new AbortController();
  const first = serial(`${origin}/slow`, { signal: active.signal });
  const second = serial(`${origin}/good`, { signal: queued.signal });
  queued.abort(); await assert.rejects(second, { name: 'AbortError' });
  active.abort(); await assert.rejects(first, { name: 'AbortError' });
  assert.equal(await (await serial(`${origin}/good`)).text(), 'Available');
  const bad = await serial(`${origin}/bad`); assert.equal(bad.status, 502); assert.equal(state.active, 0);
  const response = await serial(`${origin}/slow`, { headers: { Range: 'bytes=0-' } });
  await response.body.cancel(); assert.equal(state.active, 0);
  const pending = serial(`${origin}/slow`); serial.dispose(); await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(serial(`${origin}/good`), { name: 'AbortError' });
  assert.equal(state.peak, 1); assert.equal(state.active, 0);
});

test('an actual body deadline and bounded busy retry cancel the old body before the next resource', async () => {
  let canceled = 0, calls = 0;
  const serial = createSerialMediaFetch(async (_url, init) => {
    calls++;
    if (calls === 1) return new Response(new ReadableStream({ cancel() { canceled++; } }), { status: 503 });
    return new Response('Recovered');
  }, { unitBytes: 16, busyRetries: 1 });
  try { assert.equal(await (await serial(`${origin}/busy`)).text(), 'Recovered'); assert.equal(calls, 2); assert.equal(canceled, 1); }
  finally { serial.dispose(); }
  let bodyCanceled = false;
  const timeout = createSerialMediaFetch(async url => String(url).endsWith('/hung')
    ? new Response(new ReadableStream({ cancel() { bodyCanceled = true; } })) : new Response('Next request'), { deadline: 10 });
  try {
    await assert.rejects(timeout(`${origin}/hung`), { name: 'TimeoutError' });
    assert.ok(bodyCanceled); assert.equal(await (await timeout(`${origin}/good`)).text(), 'Next request');
  } finally { timeout.dispose(); }
});

test('CORS-hidden Content-Range is retried as a complete resource instead of inventing a partial length', async () => {
  const requests = [], bytes = Buffer.from('A complete media representation');
  const serial = createSerialMediaFetch(async (_url, init) => {
    const range = new Headers(init.headers).get('Range'); requests.push(range);
    return new Response(bytes, { status: range ? 206 : 200, headers: { 'Content-Length': String(bytes.length) } });
  }, { unitBytes: 64 });
  try {
    const response = await serial(`${origin}/cors`, { headers: { Range: 'bytes=0-' } });
    assert.equal(response.status, 206); assert.equal(response.headers.get('Content-Range'), `bytes 0-${bytes.length - 1}/${bytes.length}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes); assert.deepEqual(requests, ['bytes=0-63', null]);
  } finally { serial.dispose(); }
});
