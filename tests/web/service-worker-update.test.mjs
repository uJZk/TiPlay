// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../site/play/sw.js', import.meta.url), 'utf8');
const currentCache = 'tiplay-play-' + /const VERSION = '([^']+)'/.exec(source)[1];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture() {
  const listeners = {}, keys = new Set(['tiplay-play-previous', 'unrelated-cache']), installed = deferred();
  let takeovers = 0, installs = 0;
  const worker = { location: new URL('https://example.test/TiPlay/sw.js'), addEventListener: (name, callback) => listeners[name] = callback,
    skipWaiting() { takeovers++; }, clients: { claim() { takeovers++; } } };
  class Request { constructor(path, options) { this.url = new URL(path, worker.location).href; this.cache = options.cache; } }
  const caches = { keys: async () => [...keys], delete: async name => keys.delete(name), open: async name => {
    keys.add(name); return { addAll(requests) { installs++; assert.ok(requests.every(request => request.cache === 'reload')); return installed.promise; } };
  } };
  new Function('self', 'caches', 'Request', source)(worker, caches, Request);
  const dispatch = name => { let completion; listeners[name]({ waitUntil(value) { completion = value; } }); return completion; };
  return { keys, installed, dispatch, takeovers: () => takeovers, installs: () => installs };
}

test('installing an update leaves legacy active clients and their cache untouched until normal activation', async () => {
  const h = fixture(), installing = h.dispatch('install');
  await Promise.resolve(); assert.equal(h.installs(), 1); assert.ok(h.keys.has('tiplay-play-previous'));
  h.installed.resolve(); await installing;
  assert.ok(h.keys.has(currentCache)); assert.ok(h.keys.has('tiplay-play-previous'));
  assert.equal(h.takeovers(), 0, 'the new install must not override a legacy controller that previously forced activation');
  // The browser dispatches activate only after the previous controlled pages exit.
  await h.dispatch('activate');
  assert.ok(!h.keys.has('tiplay-play-previous')); assert.ok(h.keys.has(currentCache)); assert.ok(h.keys.has('unrelated-cache'));
  assert.equal(h.takeovers(), 0, 'uncontrolled documents are not claimed after activation');
});

test('failed precaching cannot retire a healthy active cache or force a page takeover', async () => {
  const h = fixture(), installing = h.dispatch('install'); h.installed.reject(Error('temporary download failure'));
  await assert.rejects(installing, /temporary download failure/);
  assert.ok(h.keys.has('tiplay-play-previous')); assert.equal(h.takeovers(), 0);
});
