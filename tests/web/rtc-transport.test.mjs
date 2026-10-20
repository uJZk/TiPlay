// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectRtc, gatherLocalOffer, createRtcRecordStream, createRtcAudioSource, RTC_MAGIC } from '../../site/play/rtc-transport.js';

const PUBLIC_OFFER = 'v=0\r\na=candidate:1 1 udp 1 192.168.43.10 5555 typ host\r\n';

function fragment({ session = 7, record = 1, total, offset = 0, payload }) {
  const bytes = new Uint8Array(24 + payload.length), view = new DataView(bytes.buffer);
  [RTC_MAGIC, session, record, total ?? payload.length, offset, payload.length].forEach((value, index) => view.setUint32(index * 4, value, true));
  bytes.set(payload, 24); return bytes;
}
function receiver(options = {}) {
  const acks = [], failures = [];
  const value = createRtcRecordStream({ session: 7, channel: 'video', credit: 16, maxRecordBytes: 12,
    acknowledge: ack => acks.push(ack), fail: error => failures.push(error), ...options });
  return { ...value, acks, failures };
}

test('RTC ordered fragments reassemble intact and acknowledge consumption rather than reception', async () => {
  const rx = receiver();
  rx.push(fragment({ total: 6, payload: Uint8Array.of(1, 2) }));
  rx.push(fragment({ total: 6, offset: 2, payload: Uint8Array.of(3, 4, 5, 6) }));
  assert.equal(rx.acks.length, 0);
  assert.equal(rx.stats().retainedBytes, 6);
  const reader = rx.stream.getReader();
  assert.deepEqual((await reader.read()).value, Uint8Array.of(1, 2, 3, 4, 5, 6));
  assert.deepEqual(rx.acks, [{ type: 'rtc-ack', channel: 'video', consumed: 6 }]);
  rx.push(fragment({ record: 2, payload: Uint8Array.of(8) }));
  assert.deepEqual((await reader.read()).value, Uint8Array.of(8));
  assert.equal(rx.acks[1].consumed, 7);
  rx.close(); assert.equal((await reader.read()).done, true);
});

test('RTC rejects stale identity, duplicate records, invalid offsets and oversized records before decoding', () => {
  for (const data of [
    fragment({ session: 8, payload: Uint8Array.of(1) }),
    fragment({ record: 2, payload: Uint8Array.of(1) }),
    fragment({ total: 3, offset: 1, payload: Uint8Array.of(1) }),
    fragment({ total: 13, payload: Uint8Array.of(1) }),
    new Uint8Array(4),
  ]) {
    const rx = receiver(); rx.push(data);
    assert.equal(rx.failures.length, 1); assert.equal(rx.acks.length, 0);
    rx.close();
  }
  const rx = receiver();
  rx.push(fragment({ total: 4, payload: Uint8Array.of(1, 2) }));
  rx.push(fragment({ total: 4, offset: 1, payload: Uint8Array.of(3) }));
  assert.match(rx.failures[0].message, /noncontiguous/); rx.close();
});

test('RTC receiver refuses excessive queued bytes and propagates transport failure to readers', async () => {
  const rx = receiver({ credit: 4 });
  rx.push(fragment({ payload: Uint8Array.of(1, 2, 3) }));
  rx.push(fragment({ record: 2, payload: Uint8Array.of(4, 5) }));
  assert.match(rx.failures[0].message, /credit exceeded/);
  const reader = rx.stream.getReader();
  rx.close(new Error('overload'));
  await assert.rejects(reader.read(), /overload/);
});

class Channel extends EventTarget {
  constructor(label, peer) { super(); this.label = label; this.peer = peer; this.readyState = 'connecting'; this.bufferedAmount = 0; }
  close() { this.readyState = 'closed'; }
  send(data) {
    const message = JSON.parse(data); this.peer.sent.push(message);
    if (!message.id) return;
    const result = message.type === 'auth' ? { app: 'TiPlay', protocol: 1, audio: true } : { clockMs: 1234 };
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: message.id, ok: true, result }) }));
  }
}
class Peer extends EventTarget {
  constructor(options) {
    super(); Peer.last = this; this.options = options; this.channels = []; this.sent = [];
    this.connectionState = 'new'; this.iceGatheringState = 'complete'; this.sctp = { maxMessageSize: 65536 };
  }
  createDataChannel(label, options) { this.channels.push({ label, options, channel: new Channel(label, this) }); return this.channels.at(-1).channel; }
  async createOffer() { return { type: 'offer', sdp: PUBLIC_OFFER }; }
  async setLocalDescription(value) { this.localDescription = value; }
  async setRemoteDescription(value) {
    assert.equal(this.verified, true, 'authentication precedes remote SDP');
    this.remoteDescription = value;
    for (const { channel } of this.channels) { channel.readyState = 'open'; channel.dispatchEvent(new Event('open')); }
  }
  close() { this.closed = true; }
}

test('RTC sends no pairing secret over signaling and uses reliable separate channels without public ICE services', async () => {
  const connection = await connectRtc({ session: 'session', code: '9876', codecs: 'avc1', PeerConnection: Peer,
    async authenticateOffer({ fetchPhone, session, offer }) {
      const response = await fetchPhone('/test/authenticated-signaling', { body: JSON.stringify({ s: session, offer }) });
      const answer = await response.json();
      assert.equal(answer.sdp, 'authenticated-answer'); Peer.last.verified = true; return answer;
    },
    async fetchPhone(route, init) {
      assert.equal(route, '/test/authenticated-signaling'); assert.deepEqual(JSON.parse(init.body), { s: 'session', offer: PUBLIC_OFFER });
      assert.equal(init.body.includes('9876'), false);
      return new Response(JSON.stringify({ sdp: 'authenticated-answer', session: 7 }));
    },
  });
  const peer = Peer.last;
  assert.deepEqual(peer.options.iceServers, []);
  assert.deepEqual(peer.channels.map(({ label, options }) => ({ label, options })),
    ['video', 'audio', 'control'].map(label => ({ label, options: { ordered: true } })));
  assert.equal(peer.sent[0].type, 'auth'); assert.equal(peer.sent[0].c, '9876');
  assert.equal(peer.sent[1].type, 'rtc-ready');
  assert.equal((await connection.clock()).clockMs, 1234);
  connection.close(); assert.equal(peer.closed, true);
});

test('RTC authentication failure aborts before applying the answer or sending encrypted credentials', async () => {
  await assert.rejects(connectRtc({ session: 's', code: '9876', PeerConnection: Peer,
    authenticateOffer() { throw new Error('authentication failed'); },
    fetchPhone: async () => new Response(JSON.stringify({ sdp: 'attacker', session: 7 })),
  }), /authentication failed/);
  assert.equal(Peer.last.remoteDescription, undefined);
  assert.equal(Peer.last.sent.length, 0);
  assert.equal(Peer.last.closed, true);
});

test('RTC abort retires media streams and outstanding authenticated control requests', async () => {
  const abort = new AbortController();
  const connection = await connectRtc({ session: 's', code: '1234', PeerConnection: Peer, signal: abort.signal,
    async authenticateOffer() { Peer.last.verified = true; return { sdp: 'answer', session: 7 }; },
    fetchPhone: async () => new Response(JSON.stringify({ sdp: 'answer', session: 7 })),
  });
  const reader = connection.video.getReader(), read = reader.read();
  abort.abort();
  await assert.rejects(read, /stopped/);
  await assert.rejects(connection.clock(), /closed/);
});

test('RTC audio playback cancellation preserves transport and replays bounded codec metadata', async () => {
  let controller;
  const source = createRtcAudioSource(new ReadableStream({ start(value) { controller = value; } }));
  const config = new Uint8Array(30); config[4] = 6; config[5] = 1;
  controller.enqueue(config);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(source.stats().playbackDiscardedBytes, 30);
  const abort = new AbortController();
  const first = source.open(abort.signal).getReader();
  assert.deepEqual((await first.read()).value, config);
  const waiting = first.read(); abort.abort();
  await assert.rejects(waiting, /playback stopped/);
  assert.equal(source.stats().subscribed, false);
  const second = source.open().getReader();
  assert.deepEqual((await second.read()).value, config);
  const data = new Uint8Array(32); data[4] = 2; data[5] = 1;
  controller.enqueue(data);
  assert.deepEqual((await second.read()).value, data);
  controller.close(); assert.equal((await second.read()).done, true);
});

test('RTC resumed audio replays configuration before an already pending transport read resolves', async () => {
  let controller;
  const source = createRtcAudioSource(new ReadableStream({ start(value) { controller = value; } }));
  const config = new Uint8Array(30); config[4] = 6; config[5] = 255;
  controller.enqueue(config);
  await new Promise(resolve => setImmediate(resolve));
  const reader = source.open().getReader();
  const packet = new Uint8Array(32); packet[4] = 7; packet[5] = 255;
  controller.enqueue(packet);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual((await reader.read()).value, config);
  assert.deepEqual((await reader.read()).value, packet);
  controller.close(); assert.equal((await reader.read()).done, true);
});

test('RTC reports selected ICE candidate properties without exposing addresses or candidate identities', async () => {
  class StatsPeer extends Peer {
    async getStats() {
      this.statsCalls = (this.statsCalls ?? 0) + 1;
      return new Map([
        ['transport-id-secret', { type: 'transport', selectedCandidatePairId: 'selected-id-secret' }],
        ['selected-id-secret', { type: 'candidate-pair', state: 'succeeded', localCandidateId: 'local-id-secret', remoteCandidateId: 'remote-id-secret',
          currentRoundTripTime: 0.008, availableOutgoingBitrate: 1234567, requestsSent: 10, requestsReceived: 8,
          responsesSent: 8, responsesReceived: 10, bytesSent: 1234, bytesReceived: 5678 }],
        ['local-id-secret', { type: 'local-candidate', candidateType: 'host', protocol: 'udp', address: '169.254.111.111', port: 49152 }],
        ['remote-id-secret', { type: 'remote-candidate', candidateType: 'host', protocol: 'udp', address: '192.168.43.10', port: 49153 }],
      ]);
    }
  }
  const connection = await connectRtc({ session: 's', code: '1234', PeerConnection: StatsPeer,
    async authenticateOffer() { Peer.last.verified = true; return { sdp: 'answer', session: 7 }; },
  });
  await new Promise(resolve => setImmediate(resolve));
  const ice = connection.stats().ice;
  assert.equal(ice.state, 'selected');
  assert.equal(ice.localCandidateType, 'host'); assert.equal(ice.remoteCandidateType, 'host'); assert.equal(ice.protocol, 'udp');
  assert.equal(ice.currentRoundTripTimeMs, 8); assert.equal(ice.availableOutgoingBitrate, 1234567);
  assert.equal(ice.requestsSent, 10); assert.equal(ice.responsesReceived, 10);
  assert.equal(ice.bytesSent, 1234); assert.equal(ice.bytesReceived, 5678);
  assert.ok(ice.sampleAgeMs >= 0); assert.equal(Peer.last.statsCalls, 1);
  assert.doesNotMatch(JSON.stringify(ice), /169\.254|192\.168|secret|49152|49153/);
  connection.close();
});

test('RTC ignores a pending ICE stats result after the connection closes', async () => {
  let resolveStats;
  class PendingStatsPeer extends Peer {
    getStats() { return new Promise(resolve => { resolveStats = resolve; }); }
  }
  const connection = await connectRtc({ session: 's', code: '1234', PeerConnection: PendingStatsPeer,
    async authenticateOffer() { Peer.last.verified = true; return { sdp: 'answer', session: 7 }; },
  });
  assert.equal(connection.stats().ice.state, 'collecting');
  connection.close(); resolveStats(new Map());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(connection.stats().ice.state, 'collecting');
  assert.equal(connection.stats().ice.sampleAgeMs, null);
});

test('RTC reports local ICE, authenticated signaling, remote ICE and encrypted authentication in order', async () => {
  class CandidatePeer extends Peer {
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\na=candidate:1 1 udp 1 169.254.111.111 5555 typ host\r\n' }; }
  }
  const progress = [];
  const connection = await connectRtc({ session: 'secret-browser-session', code: '9876', PeerConnection: CandidatePeer,
    onProgress: value => progress.push(value),
    async authenticateOffer() {
      Peer.last.verified = true;
      return { sdp: 'v=0\r\na=candidate:2 1 udp 1 192.168.43.1 6666 typ host\r\n', session: 7 };
    },
  });
  assert.deepEqual(progress.map(value => value.stage).filter((stage, i, stages) => stage !== stages[i - 1]),
    ['local-ice', 'pairing', 'remote-ice', 'dc-auth', 'connected']);
  assert.equal(progress[1].localCandidates, 1); assert.equal(progress[1].localLinkLocalCandidates, 1);
  assert.equal(progress[2].remoteCandidates, 1); assert.equal(progress[2].remoteLinkLocalCandidates, 0);
  assert.doesNotMatch(JSON.stringify(progress), /169\.254\.111|192\.168\.43|5555|6666|9876|secret-browser-session|a=candidate/);
  connection.close();
});

test('an authenticated answer with no remote candidates preserves its ICE timeout stage and safe counts', async t => {
  const originalTimer = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds, ...args) => originalTimer(callback, milliseconds === 12000 ? 0 : milliseconds, ...args));
  class NoRoutePeer extends Peer {
    async setRemoteDescription(value) { this.remoteDescription = value; this.connectionState = 'connecting'; this.iceConnectionState = 'checking'; }
  }
  const progress = [];
  await assert.rejects(connectRtc({ session: 'secret-session', code: '9876', PeerConnection: NoRoutePeer,
    onProgress: value => progress.push(value),
    async authenticateOffer() { return { sdp: 'v=0\r\na=ice-pwd:secret-password\r\n', session: 7 }; },
  }), error => {
    assert.equal(error.rtcReason, 'timeout'); assert.equal(error.rtcDiagnostic.stage, 'remote-ice');
    assert.equal(error.rtcDiagnostic.remoteCandidates, 0); assert.equal(error.rtcDiagnostic.remoteLinkLocalCandidates, 0);
    assert.equal(error.rtcDiagnostic.iceState, 'checking');
    assert.doesNotMatch(JSON.stringify(error.rtcDiagnostic), /secret|9876|ice-pwd|v=0/);
    return true;
  });
  assert.equal(progress.at(-1).stage, 'remote-ice');
  assert.equal(Peer.last.sent.length, 0, 'no encrypted auth is attempted before the channels open');
  assert.equal(Peer.last.closed, true);
});

test('signaling failure retains the pairing stage instead of becoming an unspecified lost connection', async () => {
  await assert.rejects(connectRtc({ session: 's', code: '9876', PeerConnection: Peer,
    async authenticateOffer() { throw Object.assign(new TypeError('Failed to fetch'), { rtcReason: 'fetch' }); },
  }), error => {
    assert.equal(error.rtcReason, 'fetch'); assert.equal(error.rtcDiagnostic.stage, 'pairing');
    assert.equal(error.rtcDiagnostic.remoteCandidates, 0); return true;
  });
});

test('a browser that never completes gathering signals its unmodified current SDP after the candidate window', async () => {
  let nativeSnapshot;
  class GatheringPeer extends Peer {
    constructor(options) { super(options); this.iceGatheringState = 'gathering'; }
    async createOffer() { return { type: 'offer', sdp: PUBLIC_OFFER + 'a=ice-ufrag:original\r\na=fingerprint:sha-256 ORIGINAL\r\n' }; }
    async setLocalDescription(value) {
      this.localDescription = value;
      setTimeout(() => {
        this.localDescription = { ...value, sdp: value.sdp + 'a=candidate:2 1 udp 1 169.254.111.111 6666 typ host\r\n' };
        nativeSnapshot = this.localDescription.sdp;
        this.dispatchEvent(new Event('icecandidate'));
      }, 20);
    }
  }
  let exchanges = 0;
  const connection = await connectRtc({ session: 's', code: '1234', PeerConnection: GatheringPeer,
    async authenticateOffer({ offer }) {
      exchanges++; assert.equal(Peer.last.iceGatheringState, 'gathering');
      assert.equal(offer, nativeSnapshot, 'the current browser SDP is passed intact into authenticated signaling');
      assert.doesNotMatch(offer, /end-of-candidates/);
      assert.match(offer, /ice-ufrag:original/); assert.match(offer, /fingerprint:sha-256 ORIGINAL/);
      Peer.last.verified = true; return { sdp: 'answer', session: 7 };
    },
  });
  assert.equal(exchanges, 1); assert.equal(connection.hello.app, 'TiPlay');
  connection.close();
});

test('normal completed ICE gathering immediately uses the exact browser SDP', async () => {
  const peer = new Peer({}); peer.localDescription = { type: 'offer', sdp: PUBLIC_OFFER };
  assert.equal(await gatherLocalOffer(peer), PUBLIC_OFFER);
});

test('ICE complete before the short candidate window immediately finishes and clears both timers', async t => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, timers = new Set();
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {
    const id = originalSet(callback, ms, ...args); timers.add(id); return id;
  });
  t.mock.method(globalThis, 'clearTimeout', id => { timers.delete(id); return originalClear(id); });
  const peer = new Peer({}); peer.iceGatheringState = 'gathering'; peer.localDescription = { sdp: PUBLIC_OFFER };
  const offer = gatherLocalOffer(peer);
  assert.equal(timers.size, 2);
  peer.iceGatheringState = 'complete'; peer.dispatchEvent(new Event('icegatheringstatechange'));
  assert.equal(await offer, PUBLIC_OFFER); assert.equal(timers.size, 0);
});

test('no local candidates still fail at the local ICE stage without contacting Android', async t => {
  const originalTimer = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => originalTimer(callback, ms === 12000 ? 1 : ms, ...args));
  class EmptyPeer extends Peer {
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
  }
  let contacted = false;
  await assert.rejects(connectRtc({ session: 's', code: '1234', PeerConnection: EmptyPeer,
    async authenticateOffer() { contacted = true; throw new Error('must not contact phone'); },
  }), error => error.rtcReason === 'timeout' && error.rtcDiagnostic.stage === 'local-ice' && error.rtcDiagnostic.localCandidates === 0);
  assert.equal(contacted, false); assert.equal(Peer.last.closed, true);
});

test('abort during the candidate window clears every gather timer and ignores later candidate events', async t => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, timers = new Set();
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {
    const id = originalSet(callback, ms, ...args); timers.add(id); return id;
  });
  t.mock.method(globalThis, 'clearTimeout', id => { timers.delete(id); return originalClear(id); });
  const peer = new Peer({}); peer.iceGatheringState = 'gathering'; peer.localDescription = { sdp: PUBLIC_OFFER };
  const abort = new AbortController(), pending = gatherLocalOffer(peer, abort.signal);
  assert.equal(timers.size, 2); abort.abort();
  await assert.rejects(pending, /stopped/);
  assert.equal(timers.size, 0);
  peer.dispatchEvent(new Event('icecandidate')); peer.dispatchEvent(new Event('icegatheringstatechange'));
  assert.equal(timers.size, 0);
});

test('a late real candidate is used at the total deadline even when its 500 ms window is still pending', async t => {
  const callbacks = new Map();
  t.mock.method(globalThis, 'setTimeout', (callback, ms) => { callbacks.set(ms, callback); return ms; });
  t.mock.method(globalThis, 'clearTimeout', id => { callbacks.delete(id); });
  const peer = new Peer({}); peer.iceGatheringState = 'gathering'; peer.localDescription = { sdp: 'v=0\r\n' };
  const pending = gatherLocalOffer(peer);
  const deadline = callbacks.get(12000);
  const actualSdp = PUBLIC_OFFER + 'a=ice-ufrag:late-original\r\na=fingerprint:sha-256 UNCHANGED\r\n';
  peer.localDescription = { sdp: actualSdp };
  peer.dispatchEvent(new Event('icecandidate'));
  assert.equal(typeof callbacks.get(500), 'function');
  deadline();
  assert.equal(await pending, actualSdp);
  assert.equal(callbacks.size, 0);
  assert.doesNotMatch(actualSdp, /end-of-candidates/);
});

test('progress snapshots distinguish ICE from peer and individual data-channel opening', async () => {
  class StatePeer extends Peer {
    async createOffer() { return { type: 'offer', sdp: PUBLIC_OFFER + 'a=candidate:2 1 tcp 1 100.111.111.111 6666 typ host\r\n' }; }
    async setRemoteDescription(value) {
      this.remoteDescription = value; this.iceConnectionState = 'connected'; this.connectionState = 'connecting';
      this.dispatchEvent(new Event('iceconnectionstatechange'));
      for (const { channel } of this.channels) { channel.readyState = 'open'; channel.dispatchEvent(new Event('open')); }
      this.connectionState = 'connected'; this.dispatchEvent(new Event('connectionstatechange'));
    }
  }
  const progress = [];
  const connection = await connectRtc({ session: 'private-session', code: '9876', PeerConnection: StatePeer,
    onProgress: value => progress.push(value),
    async authenticateOffer() { return { sdp: 'v=0\r\na=candidate:3 1 udp 1 hidden.local 7777 typ host\r\n', session: 7 }; },
  });
  const opening = progress.find(value => value.videoChannelState === 'open' && value.audioChannelState === 'connecting');
  assert.equal(opening.iceState, 'connected'); assert.equal(opening.connectionState, 'connecting');
  assert.equal(opening.controlChannelState, 'connecting');
  const final = progress.at(-1);
  assert.equal(final.localCandidates, 2); assert.equal(final.localUdpCandidates, 1); assert.equal(final.localTcpCandidates, 1);
  assert.equal(final.localCgnatIpv4Candidates, 1); assert.equal(final.remoteMdnsCandidates, 1);
  assert.equal(final.connectionState, 'connected'); assert.equal(final.controlChannelState, 'open');
  assert.doesNotMatch(JSON.stringify(progress), /100\.111|hidden\.local|192\.168|private-session|9876|6666|7777/);
  connection.close();
});
