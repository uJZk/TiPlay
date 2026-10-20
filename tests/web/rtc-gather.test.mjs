// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { gatherLocalOffer } from '../../site/play/webrtc-transport.js';

const OFFER = 'v=0\r\na=ice-ufrag:original\r\na=fingerprint:sha-256 ORIGINAL\r\na=candidate:1 1 udp 1 169.254.111.111 5555 typ host\r\n';
class Peer extends EventTarget {
  constructor(sdp = OFFER, state = 'complete') { super(); this.localDescription = { sdp }; this.iceGatheringState = state; }
}

test('completed gathering signals the exact native SDP without candidate rewriting', async () => {
  assert.equal(await gatherLocalOffer(new Peer()), OFFER);
});

test('a browser that keeps gathering uses its current authentic SDP after the bounded host window', async () => {
  const peer = new Peer(OFFER, 'gathering');
  const pending = gatherLocalOffer(peer);
  peer.localDescription.sdp += 'a=candidate:2 1 udp 1 192.168.1.2 5556 typ host\r\n';
  peer.dispatchEvent(new Event('icecandidate'));
  const result = await pending;
  assert.equal(result, peer.localDescription.sdp);
  assert.doesNotMatch(result, /end-of-candidates/);
});

test('completion before the host window clears both gather timers', async t => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, timers = new Set();
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => { const id = originalSet(callback, ms, ...args); timers.add(id); return id; });
  t.mock.method(globalThis, 'clearTimeout', id => { timers.delete(id); return originalClear(id); });
  const peer = new Peer(OFFER, 'gathering'), pending = gatherLocalOffer(peer);
  assert.equal(timers.size, 2);
  peer.iceGatheringState = 'complete'; peer.dispatchEvent(new Event('icegatheringstatechange'));
  assert.equal(await pending, OFFER); assert.equal(timers.size, 0);
});

test('aborting the candidate window releases timers and later candidate events cannot reopen it', async t => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, timers = new Set();
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => { const id = originalSet(callback, ms, ...args); timers.add(id); return id; });
  t.mock.method(globalThis, 'clearTimeout', id => { timers.delete(id); return originalClear(id); });
  const peer = new Peer(OFFER, 'gathering'), abort = new AbortController(), pending = gatherLocalOffer(peer, abort.signal);
  abort.abort(); await assert.rejects(pending, /stopped/);
  peer.dispatchEvent(new Event('icecandidate')); assert.equal(timers.size, 0);
});

test('a complete candidate-free browser fails explicitly instead of starting unauthenticated signaling', async () => {
  await assert.rejects(gatherLocalOffer(new Peer('v=0\r\n')), /no-local-candidates/);
});
