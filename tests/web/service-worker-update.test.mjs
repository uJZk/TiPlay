// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../site/play/sw.js', import.meta.url), 'utf8');
const currentCache = 'tiplay-play-' + /const VERSION = '([^']+)'/.exec(source)[1];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture({ existing = true, clients = [] } = {}) {
  const listeners = {}, keys = new Set(existing ? ['tiplay-play-previous', 'unrelated-cache'] : ['unrelated-cache']), installed = deferred();
  let takeovers = 0, installs = 0;
  const worker = { location: new URL('https://example.test/TiPlay/sw.js'), addEventListener: (name, callback) => listeners[name] = callback,
    skipWaiting() { takeovers++; return Promise.resolve(); }, clients: { matchAll: async () => clients } };
  class Request { constructor(path, options) { this.url = new URL(path, worker.location).href; this.cache = options.cache; } }
  const caches = { keys: async () => [...keys], delete: async name => keys.delete(name), open: async name => {
    keys.add(name); return { addAll(requests) { installs++; assert.ok(requests.every(request => request.cache === 'reload')); return installed.promise; } };
  } };
  new Function('self', 'caches', 'Request', source)(worker, caches, Request);
  const dispatch = name => { let completion; listeners[name]({ waitUntil(value) { completion = value; } }); return completion; };
  return { keys, installed, dispatch, takeovers: () => takeovers, installs: () => installs };
}

test('a fully cached update takes over and reloads only TiPlay pages', async () => {
  const navigated = [];
  const client = url => ({ url, navigate: async value => { navigated.push(value); } });
  const h = fixture({ clients: [client('https://example.test/TiPlay/?t=phone#c=1234'),
    client('https://example.test/TiPlay/download/')] });
  const installing = h.dispatch('install');
  await Promise.resolve(); assert.equal(h.installs(), 1); assert.equal(h.takeovers(), 0);
  h.installed.resolve(); await installing;
  assert.equal(h.takeovers(), 1); assert.ok(h.keys.has('tiplay-play-previous'));
  await h.dispatch('activate');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(navigated, ['https://example.test/TiPlay/?t=phone#c=1234']);
  assert.ok(!h.keys.has('tiplay-play-previous')); assert.ok(h.keys.has(currentCache)); assert.ok(h.keys.has('unrelated-cache'));
});

test('failed precaching does not force takeover or remove the previous cache', async () => {
  const h = fixture(), installing = h.dispatch('install'); h.installed.reject(Error('temporary download failure'));
  await assert.rejects(installing, /temporary download failure/);
  assert.ok(h.keys.has('tiplay-play-previous')); assert.equal(h.takeovers(), 0);
});

test('first installation does not navigate open windows', async () => {
  let navigations = 0;
  const h = fixture({ existing: false, clients: [{ url: 'https://example.test/TiPlay/', navigate: async () => { navigations++; } }] });
  const installing = h.dispatch('install'); h.installed.resolve(); await installing; await h.dispatch('activate');
  assert.equal(navigations, 0);
});
