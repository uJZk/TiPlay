// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, get } from 'node:http';
import { History, listen, closeServer } from './resources.mjs';
import { startFakePhone } from './fake-phone.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('bounded evidence retains original marks and makes dropped assertions an explicit failure', () => {
  const history = new History(3);
  history.push('first-error');
  const mark = history.length;
  for (let i = 0; i < 10000; i++) history.push(i);
  assert.equal(history.length, 3);
  assert.equal(history.total, 10001);
  assert.deepEqual(history.slice(mark), [0, 1]);
  assert.equal(history[0], 'first-error');
  assert.throws(() => history.assertComplete(), /exceeded 3 entries/);
});

test('listen rejects startup failure and closes acquired server resources', async () => {
  const server = createServer();
  const started = listen(server, 'not an address.invalid');
  await assert.rejects(started);
  assert.equal(server.listening, false);
  await closeServer(server);
});

test('bounded session accounting preserves control deduplication across a bye', async () => {
  const phone = await startFakePhone({ code: '123456', width: 16, height: 16,
    frames: [{ key: true, data: new Uint8Array(10) }] });
  const body = { c: '123456', s: 'abcdefghijklmnop', q: 1, e: [{ k: 'fit' }] };
  const post = path => fetch(`http://127.0.0.1:${phone.port}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await post('control')).status, 200);
    assert.equal((await post('bye')).status, 204);
    assert.equal((await post('control')).status, 200);
    assert.equal(phone.events.filter(entry => entry.event.k === 'fit').length, 1);
    phone.assertHistories();
  } finally { await phone.close(); }
});

test('a stalled fake video consumer stops producing until drain and closes its stream', async () => {
  const phone = await startFakePhone({ code: '123456', width: 16, height: 16, fps: 1000,
    frames: [{ key: true, data: new Uint8Array(1024 * 1024) }] });
  let request, response;
  try {
    response = await new Promise((resolve, reject) => {
      request = get(`http://127.0.0.1:${phone.port}/video?c=123456&s=abcdefghijklmnop`, resolve);
      request.on('error', reject);
    });
    response.pause();
    const until = Date.now() + 3000;
    while (!phone.streamStats.blocked && Date.now() < until) await delay(10);
    assert.equal(phone.streamStats.blocked, true);
    const before = phone.streamStats.framesWritten;
    await delay(100);
    assert.ok(phone.streamStats.framesWritten <= before + 4, 'writes plateau when the peer stops reading');
    assert.ok(phone.streamStats.bufferedBytes <= 1024 * 1024 + 65536, 'at most one frame is buffered after a false write');
    response.resume();
    const resumed = Date.now() + 3000;
    while (phone.streamStats.framesWritten <= before + 4 && Date.now() < resumed) await delay(10);
    assert.ok(phone.streamStats.framesWritten > before + 4, 'the drain listener resumes the same stream');
    phone.dropVideo();
    const stopped = phone.streamStats.framesWritten;
    await delay(30);
    assert.equal(phone.streamStats.active, false);
    assert.equal(phone.streamStats.framesWritten, stopped);
    phone.assertHistories();
  } finally {
    response?.destroy();
    request?.destroy();
    await phone.close();
  }
});
