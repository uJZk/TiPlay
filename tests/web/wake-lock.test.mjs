// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../site/play/app.js', import.meta.url), 'utf8');
const extract = name => new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`, 'm').exec(source)[0];
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function sentinel({ delayedRelease = false, released = false } = {}) {
  let onRelease;
  return { released, releases: 0, addEventListener(_name, listener) { onRelease = listener; },
    emitRelease() { this.released = true; onRelease?.(); },
    async release() { this.releases++; if (!delayedRelease) this.emitRelease(); } };
}
function fixture() {
  const requests = [], document = { hidden: false };
  const navigator = { wakeLock: { request(type) { assert.equal(type, 'screen'); const pending = deferred(); requests.push(pending); return pending.promise; } } };
  const page = new Function('navigator', 'document', `
    let active = true, wakeLock = null, notice, phase, streamId = 0, resourceToken, controlClock, outbox, status, live;
    let retryTimer, heartbeatTimer, retryCountdownTimer, statsTimer, videoAbort, rtcMedia, sink;
    const cancelViewport = () => {}, faultDiagnostics = { reset() {} }, browserAudio = { stop() {} };
    const airplayControls = { update() {} }, airplayTrust = { clear() {} }, controlWaiters = new Set();
    const cancelMove = () => {}, slots = { releaseAll() {} }, browserLocation = { stop() {} };
    const $ = () => ({}), stage = {}, render = () => {};
    ${extract('keepScreenOn')}
    ${extract('stop')}
    return { request: keepScreenOn, stop, start() { active = true; }, owner: () => wakeLock };
  `)(navigator, document);
  return { ...page, requests, document, navigator };
}

test('a late grant from a retired session releases only itself and leaves the replacement lock owned', async () => {
  const h = fixture(), old = sentinel(), current = sentinel();
  h.request(); h.stop(); h.start(); h.request();
  h.requests[1].resolve(current); await turn(); const owner = h.owner();
  h.requests[0].resolve(old); await turn();
  assert.equal(old.releases, 1); assert.equal(h.owner(), owner); assert.equal(current.releases, 0);
  h.stop(); await turn(); assert.equal(current.releases, 1);
});

test('a late rejection or release event from a retired session cannot clear the replacement request', async () => {
  for (const rejected of [true, false]) {
    const h = fixture(), old = sentinel({ delayedRelease: true }), current = sentinel();
    h.request();
    if (!rejected) { h.requests[0].resolve(old); await turn(); }
    h.stop(); h.start(); h.request(); h.requests[1].resolve(current); await turn();
    const owner = h.owner();
    if (rejected) h.requests[0].reject(Error('denied')); else old.emitRelease();
    await turn(); assert.equal(h.owner(), owner);
    h.stop(); await turn(); assert.equal(current.releases, 1);
  }
});

test('a grant arriving after the page becomes hidden is released and does not prevent reacquisition', async () => {
  const h = fixture(), hidden = sentinel();
  h.request(); h.document.hidden = true; h.requests[0].resolve(hidden); await turn();
  assert.equal(hidden.releases, 1); assert.equal(h.owner(), null);
  h.document.hidden = false; h.request(); const current = sentinel(); h.requests[1].resolve(current); await turn();
  current.emitRelease(); assert.equal(h.owner(), null);
  h.request(); assert.equal(h.requests.length, 3); h.stop(); h.requests[2].resolve(sentinel()); await turn();
});

test('platform refusal, synchronous API failure and an already released sentinel leave no stale owner', async () => {
  const h = fixture();
  h.request(); h.requests[0].reject(Error('denied')); await turn(); assert.equal(h.owner(), null);
  h.request(); const released = sentinel({ released: true }); h.requests[1].resolve(released); await turn();
  assert.equal(h.owner(), null); assert.equal(released.releases, 0);
  h.navigator.wakeLock.request = () => { throw Error('unavailable'); };
  assert.doesNotThrow(h.request); assert.equal(h.owner(), null);
});
