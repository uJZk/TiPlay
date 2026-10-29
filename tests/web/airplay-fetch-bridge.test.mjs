// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createAirPlayFetchBridge } from '../../site/play/airplay-fetch-bridge.js';

const source = await readFile(new URL('../../site/play/vendor/libmedia/upstream.js', import.meta.url), 'utf8');
const start = source.indexOf('((url, init) => {'), end = source.indexOf('\n})', start);
assert.ok(start >= 0 && end > start);
const adapter = runInNewContext(source.slice(start, end + 3), {
  URL, Headers, DOMException, Response, ReadableStream, BroadcastChannel, crypto,
  fetch: () => { throw new Error('Worker network must not be used for this Android resource'); },
  location: { href: 'https://car.test/play/' },
});

test('production worker adapter streams Android ranges on the document thread', async () => {
  let request, pulls = 0, cancelled = 0;
  const broker = createAirPlayFetchBridge('http://192.168.1.2:8080', { fetchResource: async (url, init) => {
    request = { url, init };
    return new Response(new ReadableStream({ pull(controller) {
      pulls++; if (pulls === 1) controller.enqueue(new Uint8Array([1, 2]));
      else if (pulls === 2) controller.enqueue(new Uint8Array([3, 4]));
      else controller.close();
    }, cancel() { cancelled++; } }), { status: 206, headers: { 'Content-Range': 'bytes 0-3/9' } });
  } });
  try {
    const response = await adapter('http://192.168.1.2:8080/airplay-resource?id=1', {
      headers: { 'X-TiPlay-Fetch-Bridge': broker.name, 'X-TiPlay-Proxy-Origin': 'http://192.168.1.2:8080', Range: 'bytes=0-3' },
    });
    assert.equal(response.status, 206); assert.equal(response.headers.get('Content-Range'), 'bytes 0-3/9');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3, 4]);
    assert.equal(request.init.headers.get('Range'), 'bytes=0-3');
    assert.equal(request.init.headers.get('X-TiPlay-Fetch-Bridge'), null);
    assert.equal(request.init.redirect, 'error'); assert.equal(cancelled, 0);
  } finally { broker.dispose(); }
});

test('bridge aborts pending requests and rejects other destinations', async () => {
  let signal;
  const broker = createAirPlayFetchBridge('http://192.168.1.2:8080', { fetchResource: (_, init) => {
    signal = init.signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  } });
  try {
    const stop = new AbortController();
    const pending = adapter('http://192.168.1.2:8080/airplay-resource?id=1', {
      signal: stop.signal, headers: { 'X-TiPlay-Fetch-Bridge': broker.name },
    });
    while (!signal) await new Promise(resolve => setTimeout(resolve, 1));
    stop.abort(); await assert.rejects(pending, { name: 'AbortError' });
    await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(signal.aborted, true);
    await assert.rejects(adapter('http://192.168.1.3:8080/airplay-resource', {
      headers: { 'X-TiPlay-Fetch-Bridge': broker.name },
    }), { name: 'SecurityError' });
  } finally { broker.dispose(); }
});

test('cancelling a response stream releases the document reader', async () => {
  let cancelled = false;
  const broker = createAirPlayFetchBridge('http://192.168.1.2:8080', { fetchResource: async () =>
    new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array([9])); },
      cancel() { cancelled = true; } })) });
  try {
    const response = await adapter('http://192.168.1.2:8080/airplay-resource', {
      headers: { 'X-TiPlay-Fetch-Bridge': broker.name },
    });
    const reader = response.body.getReader();
    assert.deepEqual([...((await reader.read()).value)], [9]);
    await reader.cancel();
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(cancelled, true);
  } finally { broker.dispose(); }
});

test('HLS request option adaptation retains the final comma expression', async () => {
  const code = await readFile(new URL('../../site/play/vendor/libmedia/272.avplayer.js', import.meta.url), 'utf8');
  assert.match(code, /__tiplaySourceSignal:t\.__tiplaySourceSignal\}\)\)\(\(null!==/);
  assert.match(code, /referrerPolicy=t\.httpOptions\.referrerPolicy\),a\)\)\}async function A\(/);
});
