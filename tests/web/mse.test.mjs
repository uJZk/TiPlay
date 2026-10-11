// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { RECORD, encodeRecord } from '../../site/play/link.js';

class FakeSource extends EventTarget {
  static instances = [];
  static isTypeSupported() { return true; }
  constructor() {
    super();
    this.listeners = new Set();
    this.buffers = [];
    FakeSource.instances.push(this);
  }
  addEventListener(type, callback, options) { super.addEventListener(type, callback, options); this.listeners.add(callback); }
  removeEventListener(type, callback) { super.removeEventListener(type, callback); this.listeners.delete(callback); }
  addSourceBuffer() {
    if (this.fail) throw new Error('source buffer failed');
    const buffer = Object.assign(new EventTarget(), {
      updating: false, buffered: { length: 0 },
      appendBuffer() { this.updating = true; },
    });
    this.buffers.push(buffer);
    return buffer;
  }
}
globalThis.window = { MediaSource: FakeSource };
const { createMsePlayer } = await import('../../site/play/mse.js');
delete globalThis.window;
const settle = () => new Promise(resolve => setImmediate(resolve));
const config = epoch => encodeRecord({ kind: RECORD.CONFIG, epoch,
  payload: new TextEncoder().encode(JSON.stringify({ codec: 'avc1.640028', width: 800, height: 480, fps: 30, record: 'AWQAKP/hAARnZAAoAQACaO4=' })),
});

function fixture(t) {
  FakeSource.instances = [];
  const revoked = [], timers = new Set(), messages = [];
  let serial = 0;
  t.mock.method(URL, 'createObjectURL', () => `blob:test-${++serial}`);
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  t.mock.method(globalThis, 'setInterval', callback => { timers.add(callback); return callback; });
  t.mock.method(globalThis, 'clearInterval', callback => timers.delete(callback));
  const video = Object.assign(new EventTarget(), {
    readyState: 0, currentTime: 0, paused: false, src: '',
    removeAttribute(name) { if (name === 'src') this.src = ''; },
    load() {}, play: () => Promise.resolve(),
  });
  const player = createMsePlayer(video, { post: message => messages.push(message) });
  t.after(() => player.dispose());
  function read(id) {
    let controller;
    const body = new ReadableStream({ start(c) { controller = c; c.enqueue(config(id)); } });
    return { body, controller, reading: player.read(id, body) };
  }
  return { player, video, revoked, timers, messages, read };
}

test('stopping pending sourceopen revokes its URL, removes listener and unblocks record reads', async t => {
  const f = fixture(t), first = f.read(1);
  await settle();
  const source = FakeSource.instances[0];
  assert.equal(source.listeners.size, 1);
  f.player.stop();
  assert.deepEqual(f.revoked, ['blob:test-1'], 'pending URL is already owned before sourceopen');
  await first.reading;
  assert.equal(first.body.locked, false);
  assert.equal(source.listeners.size, 0);
  assert.equal(f.timers.size, 0);
  source.dispatchEvent(new Event('sourceopen'));
  await settle();
  assert.equal(source.buffers.length, 0, 'late sourceopen cannot attach a stopped source');
  assert.equal(f.video.src, '');
  assert.deepEqual(f.messages.filter(m => m.type === 'end'), []);
});

test('rapid replacement ignores old sourceopen and natural EOF disposes the newest media', async t => {
  const f = fixture(t), first = f.read(1);
  await settle();
  const second = f.read(2);
  await first.reading;
  await settle();
  const [old, current] = FakeSource.instances;
  old.dispatchEvent(new Event('sourceopen'));
  current.dispatchEvent(new Event('sourceopen'));
  await settle();
  assert.equal(old.buffers.length, 0);
  assert.equal(current.buffers.length, 1);
  assert.deepEqual(f.revoked, ['blob:test-1']);
  assert.equal(f.video.src, 'blob:test-2');
  second.controller.close();
  await second.reading;
  assert.deepEqual(f.revoked, ['blob:test-1', 'blob:test-2']);
  assert.equal(f.video.src, '');
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.messages.filter(m => m.type === 'end'), [{ type: 'end', id: 2, reason: 'closed' }]);
});

test('source buffer failure releases URL and permits a fresh connection', async t => {
  const f = fixture(t), first = f.read(1);
  await settle();
  const source = FakeSource.instances[0];
  source.fail = true;
  source.dispatchEvent(new Event('sourceopen'));
  await first.reading;
  assert.deepEqual(f.revoked, ['blob:test-1']);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.messages.filter(m => m.type === 'end'), [{ type: 'end', id: 1, reason: 'error' }]);
  const next = f.read(2);
  await settle();
  FakeSource.instances[1].dispatchEvent(new Event('sourceopen'));
  await settle();
  f.video.dispatchEvent(new Event('error'));
  await next.reading;
  assert.deepEqual(f.revoked, ['blob:test-1', 'blob:test-2']);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.messages.at(-1), { type: 'end', id: 2, reason: 'media-error' });
});
