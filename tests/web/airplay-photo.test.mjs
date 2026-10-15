// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { photoMetadata, readPhotoResource } from '../../site/play/airplay-photo.js';

const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jAwAAAABJRU5ErkJggg==', 'base64'));

test('original PNG and JPEG dimensions are read without decoding or re-encoding', () => {
  assert.deepEqual(photoMetadata(png), { width: 1, height: 1, type: 'image/png' });
  const jpeg = new Uint8Array([255,216,255,224,0,4,0,0,255,192,0,8,8,0,10,0,20,1,255,217]);
  assert.deepEqual(photoMetadata(jpeg), { width: 20, height: 10, type: 'image/jpeg' });
});

test('unsupported payloads, truncated JPEG and excessive image dimensions are refused before decode', () => {
  assert.throws(() => photoMetadata(new TextEncoder().encode('<svg width="1"/>')));
  assert.throws(() => photoMetadata(new Uint8Array([255,216,255,224,255,255,0,0])));
  const large = png.slice();
  new DataView(large.buffer).setUint32(16, 16385);
  assert.throws(() => photoMetadata(large));
  new DataView(large.buffer).setUint32(16, 16000);
  new DataView(large.buffer).setUint32(20, 16000);
  assert.throws(() => photoMetadata(large));
});

test('streamed photos retain their exact original bytes and unknown-length responses are bounded', async () => {
  assert.deepEqual(await readPhotoResource(new Response(png), new AbortController().signal), png);
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readPhotoResource(new Response(stream), new AbortController().signal), /too large/);
  assert.equal(cancelled, true);
});

test('photo body reads abort and cancel the upstream stream when the casting session ends', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const pending = readPhotoResource(new Response(stream), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancelled, true);
});
