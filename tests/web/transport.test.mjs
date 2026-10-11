// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CHUNK_BYTES, createChunkStream, createFrameDelivery, pumpChunkStream } from '../../site/play/transport.js';

const settle = () => new Promise(resolve => setTimeout(resolve, 10));

test('worker byte transport waits for demand, bounds transfers and preserves configuration/frame order', async () => {
  const { port1, port2 } = new MessageChannel();
  const abort = new AbortController();
  const input = Uint8Array.from({ length: MAX_CHUNK_BYTES * 3 + 17 }, (_, i) => i % 251);
  let reads = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (++reads === 1) controller.enqueue(input);
      else controller.close();
    },
  }, { highWaterMark: 0 });
  const stream = createChunkStream(port2), pumping = pumpChunkStream(body, port1, abort.signal);
  await settle();
  assert.equal(reads, 0, 'a blocked worker/configuration does not pull the network body');
  const reader = stream.getReader(), chunks = [];
  chunks.push((await reader.read()).value);
  await settle();
  assert.equal(reads, 1);
  assert.equal(chunks[0].length, MAX_CHUNK_BYTES);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    assert.ok(value.length <= MAX_CHUNK_BYTES);
    chunks.push(value);
  }
  await pumping;
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(input));
  assert.equal(body.locked, false);
  reader.releaseLock();
});

test('worker cancellation interrupts an outstanding network read and releases its lock', async () => {
  const { port1, port2 } = new MessageChannel(), abort = new AbortController();
  let cancelled = 0;
  const body = new ReadableStream({ cancel() { cancelled++; } });
  const reader = createChunkStream(port2).getReader();
  const pumping = pumpChunkStream(body, port1, abort.signal);
  const reading = reader.read();
  await settle();
  await reader.cancel();
  await pumping;
  await reading;
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});

test('page stop interrupts a sender blocked waiting for worker credit', async () => {
  const { port1, port2 } = new MessageChannel(), abort = new AbortController();
  const stream = createChunkStream(port2);
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const pumping = pumpChunkStream(body, port1, abort.signal);
  abort.abort();
  await pumping;
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
  await assert.rejects(stream.getReader().read(), /stopped/);
});

test('frame delivery keeps one transferred and one latest pending frame across stop/reconnect', () => {
  const sent = [], closed = [];
  const frame = n => ({ n, close() { closed.push(n); } });
  const delivery = createFrameDelivery(message => sent.push(message));
  delivery.present(frame(1), { epoch: 1 }, 1);
  for (let n = 2; n <= 100; n++) delivery.present(frame(n), { epoch: 1 }, 1);
  assert.equal(sent.length, 1, 'a blocked main thread receives no unbounded transferred frames');
  assert.deepEqual(closed, Array.from({ length: 98 }, (_, i) => i + 2));
  delivery.stop();
  assert.equal(closed.at(-1), 100);
  delivery.present(frame(101), { epoch: 2 }, 2);
  assert.equal(sent.length, 1, 'stop does not invent a credit while the old transfer is outstanding');
  delivery.acknowledge(sent[0].frameId);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].id, 2);
  assert.equal(sent[1].frame.n, 101);
  delivery.acknowledge(sent[0].frameId);
  delivery.present(frame(102), { epoch: 2 }, 2);
  assert.equal(sent.length, 2, 'a stale acknowledgement cannot release the current transfer');
  delivery.acknowledge(sent[1].frameId);
  assert.equal(sent[2].frame.n, 102);
  delivery.stop();
});
