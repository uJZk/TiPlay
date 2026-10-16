import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerialMediaFetch } from '../../site/play/airplay-resource-fetch.js';
import { fetchSdrMediaResource } from '../../site/play/airplay-sdr.js';

test('a Request signal cancels media fetching and an explicit init signal can replace it', async () => {
  const parent = new AbortController(); parent.abort();
  const serial = createSerialMediaFetch(async () => new Response('ok'));
  const request = new Request('https://fixture.test/movie', { signal: parent.signal });
  try {
    await assert.rejects(serial(request), { name: 'AbortError' });
    assert.equal(await (await serial(request, { signal: new AbortController().signal })).text(), 'ok');
    assert.equal(await (await serial(request, { signal: null })).text(), 'ok');
  } finally { serial.dispose(); }
});

test('serial network deadlines permit an idle virtual MP4 response and still preserve source cancellation', async () => {
  const source = new AbortController(), data = new Uint8Array(48).map((_, i) => i), signals = [];
  const serial = createSerialMediaFetch(async (_, init) => {
    signals.push(init.signal);
    const range = new Headers(init.headers).get('Range').match(/bytes=(\d+)-(\d+)/);
    const start = +range[1], end = Math.min(+range[2], data.length - 1);
    return new Response(data.slice(start, end + 1), { status: 206, headers: {
      'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': String(end - start + 1),
    } });
  }, { deadline: 20, unitBytes: 4 });
  try {
    const response = await fetchSdrMediaResource(serial, 'https://fixture.test/movie', { headers: { Range: 'bytes=0-' } },
      { signal: source.signal, deadline: null });
    const reader = response.body.getReader(), chunks = [];
    chunks.push((await reader.read()).value);
    await new Promise(resolve => setTimeout(resolve, 60));
    while (true) { const { value, done } = await reader.read(); if (done) break; chunks.push(value); }
    assert.deepEqual(Buffer.concat(chunks), Buffer.from(data));
    assert.ok(signals.length > 1, 'Actual network units continued after idle time exceeded their deadline');
    const canceled = await fetchSdrMediaResource(serial, 'https://fixture.test/movie', { headers: { Range: 'bytes=0-' } },
      { signal: source.signal, deadline: null });
    source.abort();
    await assert.rejects(canceled.arrayBuffer(), { name: 'AbortError' });
  } finally { serial.dispose(); }
});
