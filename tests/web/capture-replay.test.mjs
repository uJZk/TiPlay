import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaptureReplay } from '../web-e2e/capture-replay.mjs';
import { readAudioRecords } from '../../site/play/audio-protocol.js';

function pcm(sequence) {
  const bytes = new Uint8Array(32), view = new DataView(bytes.buffer);
  view.setUint32(0, 28); bytes[4] = 2; bytes[6] = 2;
  view.setUint32(8, 48000); view.setUint32(12, sequence); view.setUint32(16, 4);
  view.setFloat64(20, 123456 + sequence * 20); view.setInt16(28, 1000, true);
  return bytes;
}

test('capture replay preserves record order, bytes and source timestamps through the production parser', async () => {
  const packets = [pcm(8), pcm(9), pcm(10)], waits = [];
  let time = 100;
  const replay = createCaptureReplay({ events: [0, 20, 15].map((atMs, i) => ({ atMs, offset: i * 32, length: 32 })),
    readRange: async offset => packets[offset / 32], now: () => time,
    schedule: (callback, delay) => { waits.push(delay); time += delay; queueMicrotask(callback); return 1; },
    unschedule: () => {},
  });
  const records = [];
  for await (const record of readAudioRecords(replay.stream)) records.push(record);
  assert.deepEqual(records.map(r => r.sequence), [8, 9, 10]);
  assert.deepEqual(records.map(r => r.presentationMs), [123616, 123636, 123656]);
  assert.equal(new Int16Array(records[0].pcm)[0], 1000);
  assert.deepEqual(waits, [20]);
  assert.equal(replay.stats().timestampRegressions, 1);
  assert.equal(replay.stats().maxLatenessMs, 5);
});

test('abort settles a reader waiting on a distant captured event', async () => {
  const abort = new AbortController();
  const replay = createCaptureReplay({ events: [{ atMs: 100000, offset: 0, length: 1 }],
    readRange: async () => assert.fail('Must not read after abort'), signal: abort.signal });
  const reader = replay.stream.getReader(), pending = reader.read();
  await new Promise(resolve => setImmediate(resolve));
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(replay.stats().stopped, true);
});

test('short ranges fail rather than silently changing the replay bytes', async () => {
  const replay = createCaptureReplay({ events: [{ atMs: 0, offset: 0, length: 32 }], readRange: async () => new Uint8Array(1) });
  await assert.rejects(replay.stream.getReader().read(), /Truncated/);
});

test('a clipped live stream can retain its open connection until cancellation', async () => {
  const replay = createCaptureReplay({ events: [], holdOpenAtEnd: true, readRange: async () => assert.fail() });
  const reader = replay.stream.getReader(), pending = reader.read();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(replay.stats().stopped, false);
  await reader.cancel();
  assert.equal((await pending).done, true);
  assert.equal(replay.stats().stopped, true);
});

test('non-finite control timestamps survive the replay and production parser unchanged', async () => {
  const bytes = pcm(11).slice(0, 28), view = new DataView(bytes.buffer);
  view.setUint32(0, 24); bytes[5] = 5; bytes[6] = 1; view.setFloat64(20, NaN);
  const replay = createCaptureReplay({ events: [{ atMs: 0, offset: 0, length: 28 }], readRange: async () => bytes });
  const records = [];
  for await (const record of readAudioRecords(replay.stream)) records.push(record);
  assert.equal(records.length, 1);
  assert.equal(records[0].type, 5);
  assert.ok(Number.isNaN(records[0].presentationMs));
  assert.equal(records[0].pcm.byteLength, 0);
});

test('shared replay origin retains the offset of a later stream or epoch', async () => {
  let time = 110;
  const replay = createCaptureReplay({ events: [{ atMs: 40, offset: 0, length: 1 }], startAtMs: 100,
    readRange: async () => new Uint8Array([7]), now: () => time,
    schedule: (callback, delay) => { assert.equal(delay, 30); time += delay; queueMicrotask(callback); return 1; } });
  assert.deepEqual((await replay.stream.getReader().read()).value, new Uint8Array([7]));
  assert.equal(replay.stats().maxLatenessMs, 0);
});

test('cancel releases scheduled work without reading payloads', async () => {
  let scheduled = false, cancelled = false;
  const replay = createCaptureReplay({ events: [{ atMs: 1000, offset: 0, length: 1 }], readRange: async () => assert.fail(),
    now: () => 0, schedule: () => { scheduled = true; return 7; }, unschedule: id => { assert.equal(id, 7); cancelled = true; } });
  const reader = replay.stream.getReader(), pending = reader.read();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduled, true);
  await reader.cancel();
  assert.deepEqual(await pending, { value: undefined, done: true });
  assert.equal(cancelled, true);
});
