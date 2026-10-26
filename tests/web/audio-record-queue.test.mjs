// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioRecordQueue } from '../../site/play/audio-record-queue.js';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const packet = (type, sequence = 0) => ({ type, sequence, pcm: new ArrayBuffer(36) });

test('slow stream keeps FIFO while another stream completes independently', async () => {
  const held = deferred(), events = [];
  const queue = createAudioRecordQueue({ process: async record => {
    events.push(`start:${record.type}:${record.sequence}`);
    if (!record.type && !record.sequence) await held.promise;
    events.push(`done:${record.type}:${record.sequence}`);
  } });
  try {
    await queue.enqueue(packet(0)); await queue.enqueue(packet(0, 1)); await queue.enqueue(packet(1));
    await turn();
    assert.deepEqual(events, ['start:0:0', 'start:1:0', 'done:1:0']);
    held.resolve(); await queue.drain();
    assert.deepEqual(events.slice(-3), ['done:0:0', 'start:0:1', 'done:0:1']);
  } finally { held.resolve(); queue.close(); }
});

test('active and queued payloads share bounded per-stream and global admission', async () => {
  const holds = [deferred(), deferred()], events = [];
  const queue = createAudioRecordQueue({ maxBytes: 200, maxStreamBytes: 100, maxRecords: 2, maxStreamRecords: 1,
    process: async record => { events.push(record.type); await holds[record.type].promise; } });
  try {
    await queue.enqueue(packet(0));
    let admitted = false;
    const pending = queue.enqueue(packet(0, 1)).then(() => { admitted = true; });
    await queue.enqueue(packet(1)); await turn();
    assert.equal(admitted, false); assert.deepEqual(events, [0, 1]);
    assert.deepEqual(queue.stats(), { bytes: 200, records: 2, streams: 2 });
    holds[0].resolve(); await pending;
    holds[1].resolve(); await queue.drain();
    assert.deepEqual(queue.stats(), { bytes: 0, records: 0, streams: 0 });
    await assert.rejects(queue.enqueue({ type: 0, pcm: new ArrayBuffer(37) }), /dispatch memory limit/);
  } finally { holds.forEach(hold => hold.resolve()); queue.close(); }
});

test('reset cancels old work and capacity waits without poisoning a replacement stream', async () => {
  const hold = deferred(), signals = [], processed = [];
  const queue = createAudioRecordQueue({ maxRecords: 1, process: async (record, signal) => {
    signals.push(signal);
    if (!record.sequence) await hold.promise;
    if (!signal.aborted) processed.push(record.sequence);
  } });
  try {
    await queue.enqueue(packet(0));
    const waiting = queue.enqueue(packet(0, 1));
    const rejected = assert.rejects(waiting, { name: 'AbortError' });
    queue.reset(); await rejected;
    assert.equal(signals[0].aborted, true);
    await queue.enqueue(packet(0, 2)); await queue.drain();
    hold.resolve(); await turn();
    assert.deepEqual(processed, [2]);
    assert.deepEqual(queue.stats(), { bytes: 0, records: 0, streams: 0 });
  } finally { hold.resolve(); queue.close(); }
});

test('task failures abort sibling work and settle blocked admission and drain', async () => {
  const hold = deferred(), errors = [];
  const queue = createAudioRecordQueue({ maxRecords: 1, onError: cause => errors.push(cause.message),
    process: async () => { await hold.promise; throw Error('decoder failed'); } });
  await queue.enqueue(packet(0));
  const waiting = assert.rejects(queue.enqueue(packet(1)), /decoder failed/);
  const drained = assert.rejects(queue.drain(), /decoder failed/);
  hold.resolve(); await Promise.all([waiting, drained]);
  assert.deepEqual(errors, ['decoder failed']);
  queue.close();
});

test('abort cancels blocked admission promptly even if an active codec never returns', async () => {
  const abort = new AbortController();
  const queue = createAudioRecordQueue({ signal: abort.signal, maxRecords: 1, process: () => new Promise(() => {}) });
  await queue.enqueue(packet(0));
  const waiting = assert.rejects(queue.enqueue(packet(1)), { name: 'AbortError' });
  const drained = assert.rejects(queue.drain(), { name: 'AbortError' });
  abort.abort(); await Promise.all([waiting, drained]);
  assert.equal(queue.stats().records, 0);
});
