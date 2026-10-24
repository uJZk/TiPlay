// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readAudioRecords } from '../../site/play/audio-protocol.js';

function packet(samples, sequence) {
  const bytes = new Uint8Array(28 + samples.length * 2), view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length - 4);
  bytes[4] = 2; bytes[6] = 1;
  view.setUint32(8, 48000); view.setUint32(12, sequence); view.setFloat64(20, 1234.5);
  samples.forEach((sample, index) => view.setInt16(28 + index * 2, sample, true));
  return bytes;
}

test('audio framing handles offset views, packed records and independently transferable PCM', async () => {
  const first = packet([-32768, 17, 32767], 7), second = packet([91, -29], 8);
  const backing = new Uint8Array(35 + first.length + second.length).fill(255);
  backing.set(first, 11); backing.set(second, 11 + first.length);
  const input = backing.subarray(11, 11 + first.length + second.length);
  const body = new ReadableStream({ start(controller) { controller.enqueue(input); controller.close(); } });
  const reader = readAudioRecords(body);
  const a = (await reader.next()).value;
  assert.deepEqual([a.sequence, a.rate, a.presentationMs], [7, 48000, 1234.5]);
  assert.deepEqual([...new Int16Array(a.pcm)], [-32768, 17, 32767]);
  structuredClone(a.pcm, { transfer: [a.pcm] });
  assert.equal(a.pcm.byteLength, 0);
  assert.equal(input.byteLength, first.length + second.length, 'transferring PCM cannot detach the unread next record');
  const b = (await reader.next()).value;
  assert.equal(b.sequence, 8); assert.deepEqual([...new Int16Array(b.pcm)], [91, -29]);
  assert.equal((await reader.next()).done, true);
  assert.equal(body.locked, false);
});

test('audio framing produces identical records for every split, including empty network chunks', async () => {
  const bytes = packet([-123, 0, 321], 0x80000001);
  for (let split = 0; split <= bytes.length; split++) {
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(bytes.subarray(0, split));
      controller.enqueue(new Uint8Array());
      controller.enqueue(bytes.subarray(split)); controller.close();
    } });
    const values = [];
    for await (const value of readAudioRecords(body)) values.push(value);
    assert.equal(values.length, 1, `split=${split}`);
    assert.equal(values[0].sequence, 0x80000001);
    assert.deepEqual([...new Int16Array(values[0].pcm)], [-123, 0, 321]);
    assert.equal(body.locked, false);
  }
});
