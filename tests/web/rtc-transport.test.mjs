// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectRtc, createRtcRecordStream, createRtcAudioSource, RTC_MAGIC } from '../../site/play/rtc-transport.js';

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
  async createOffer() { return { type: 'offer', sdp: 'public-offer' }; }
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
      assert.equal(route, '/test/authenticated-signaling'); assert.deepEqual(JSON.parse(init.body), { s: 'session', offer: 'public-offer' });
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
