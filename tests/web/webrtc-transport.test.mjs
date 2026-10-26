// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRtcMediaTransport, RTC_FRAGMENT_BYTES, RTC_HEADER_BYTES, RTC_MAGIC, RTC_TRANSPORT } from '../../site/play/webrtc-transport.js';

class Channel {
  constructor(label, options) { this.label = label; this.options = options; this.readyState = 'connecting'; this.bufferedAmount = 0; this.sent = []; }
  send(value) {
    const message = JSON.parse(value); this.sent.push(message);
    if (message.k === 'auth') queueMicrotask(() => this.receive(JSON.stringify({ q: message.q, app: 'TiPlay', protocol: 1,
      clockMs: 100, audio: true, transport: RTC_TRANSPORT, resourceToken: 'r'.repeat(43) })));
  }
  close() { this.readyState = 'closed'; this.onclose?.(); }
  receive(value) { this.onmessage?.({ data: value }); }
}
class Peer extends EventTarget {
  static latest;
  constructor(options) { super(); Peer.latest = this; this.options = options; this.channels = {}; this.iceGatheringState = 'complete'; this.iceConnectionState = 'new'; this.connectionState = 'new'; }
  createDataChannel(label, options) { return this.channels[label] = new Channel(label, options); }
  async createOffer() { return { type: 'offer', sdp: 'local-offer\r\na=candidate:1 1 udp 1 192.0.2.1 5000 typ host\r\n' }; }
  async setLocalDescription(description) { this.localDescription = description; }
  async setRemoteDescription(description) {
    this.remoteDescription = description;
    for (const channel of Object.values(this.channels)) { channel.readyState = 'open'; channel.onopen(); }
  }
  close() { this.closed = true; }
}
function fragment(bytes, { epoch = 7, q = 0, total = bytes.length, offset = 0 } = {}) {
  const result = new Uint8Array(RTC_HEADER_BYTES + bytes.length), header = new DataView(result.buffer);
  [RTC_MAGIC, epoch, q, total, offset, bytes.length].forEach((value, index) => header.setUint32(index * 4, value, true));
  result.set(bytes, RTC_HEADER_BYTES); return result.buffer;
}
async function fixture(options = {}) {
  const errors = [], abort = new AbortController();
  const media = createRtcMediaTransport({ signal: abort.signal, PeerConnection: Peer, credentials: () => ({ code: '1234', session: 'safe' }),
    onError: error => errors.push(error), exchange: async () => ({ type: 'answer', sdp: 'remote-answer\r\na=candidate:1 1 udp 1 192.0.2.2 5001 typ host\r\n', epoch: 7, fragmentBytes: RTC_FRAGMENT_BYTES, transport: RTC_TRANSPORT }), ...options });
  await media.connect();
  return { media, peer: Peer.latest, channels: Peer.latest.channels, errors, abort };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const audioAnswer = (request, fields = {}) => JSON.stringify({ q: request.q, generation: request.generation, sdp: 'native-audio-answer', ...fields });

test('audio-only signaling shares authenticated control without colliding with application RPCs or retiring media', async () => {
  const f = await fixture();
  try {
    const native = f.media.audioOffer({ sdp: 'native-audio-offer', generation: 1 });
    const ordinary = f.media.control(2, [{ k: 'heartbeat' }]);
    const offer = f.channels.control.sent.find(message => message.k === 'audio-offer');
    assert.ok(offer.q > 2 ** 40);
    f.channels.control.receive(JSON.stringify({ q: 2, state: 'ok' }));
    assert.equal((await ordinary).state, 'ok');
    f.channels.control.receive(audioAnswer(offer));
    assert.equal((await native).sdp, 'native-audio-answer');
    assert.equal(f.media.isConnected(), true);
    assert.equal(f.channels.audio.readyState, 'open'); assert.equal(f.channels.video.readyState, 'open');
  } finally { f.media.close(); }
});

test('native audio offers reject empty SDP, UTF-8 overflow and invalid generations before sending', async () => {
  const f = await fixture();
  try {
    for (const value of [null, {}, { sdp: '', generation: 1 }, { sdp: ' \r\n', generation: 1 },
      { sdp: '界'.repeat(17000), generation: 1 }, ...[0, -1, 1.5, 0x80000000, Number.NaN].map(generation => ({ sdp: 'offer', generation }))])
      await assert.rejects(f.media.audioOffer(value), error => error.reason === 'audio-offer-format');
    assert.equal(f.channels.control.sent.some(message => message.k === 'audio-offer'), false);
    const pending = f.media.audioOffer({ sdp: 'offer', generation: 1 });
    const offer = f.channels.control.sent.find(message => message.k === 'audio-offer');
    f.channels.control.receive(audioAnswer(offer)); await pending;
    await assert.rejects(f.media.audioOffer({ sdp: 'offer', generation: 1 }), error => error.reason === 'audio-offer-generation');
    assert.equal(f.media.isConnected(), true);
  } finally { f.media.close(); }
});

test('bad native audio answers reject only their RPC and preserve fallback/video transport', async () => {
  for (const fields of [{ sdp: '' }, { sdp: ' \r\n' }, { sdp: '界'.repeat(17000) }, { generation: 2 }]) {
    const f = await fixture();
    try {
      const pending = f.media.audioOffer({ sdp: 'offer', generation: 1 });
      const rejected = assert.rejects(pending, error => error.reason === 'audio-answer-format');
      const offer = f.channels.control.sent.find(message => message.k === 'audio-offer');
      f.channels.control.receive(audioAnswer(offer, fields)); await rejected;
      assert.equal(f.media.isConnected(), true); assert.deepEqual(f.errors, []);
    } finally { f.media.close(); }
  }
});

test('native audio deadline and old replies cannot settle a later peer generation', async () => {
  const f = await fixture({ audioTimeoutMs: 15 });
  try {
    await assert.rejects(f.media.audioOffer({ sdp: 'offer-1', generation: 1 }), error => error.reason === 'control-timeout');
    const old = f.channels.control.sent.find(message => message.k === 'audio-offer');
    let settled = false;
    const pending = f.media.audioOffer({ sdp: 'offer-2', generation: 2 }).then(value => { settled = true; return value; });
    const current = f.channels.control.sent.filter(message => message.k === 'audio-offer').at(-1);
    f.channels.control.receive(audioAnswer(old)); await settle();
    assert.equal(settled, false);
    f.channels.control.receive(audioAnswer(current)); assert.equal((await pending).generation, 2);
    assert.equal(f.media.isConnected(), true);
  } finally { f.media.close(); }
});

test('native audio events are generation-bound, sanitized, isolated from listener errors and removable', async () => {
  const f = await fixture(), events = [];
  const remove = f.media.audioEvents(value => events.push(value));
  const throwing = f.media.audioEvents(() => { throw Error('output observer failed'); });
  const send = fields => f.channels.control.receive(JSON.stringify({ k: 'audio-error', generation: 1, reason: 'audio-source-failed', ...fields }));
  try {
    send({}); assert.deepEqual(events, [], 'no native generation has been negotiated');
    const pending = f.media.audioOffer({ sdp: 'offer', generation: 1 });
    const offer = f.channels.control.sent.find(message => message.k === 'audio-offer');
    f.channels.control.receive(audioAnswer(offer)); await pending;
    for (const fields of [{ generation: 0 }, { generation: 0x80000000 }, { generation: 1.5 },
      { generation: 2 }, { reason: 'x'.repeat(101) }, { reason: { invalid: true } }]) send(fields);
    assert.deepEqual(events, []);
    send({ extra: 'not-a-public-event-field' });
    assert.deepEqual(events, [{ k: 'audio-error', generation: 1, reason: 'audio-source-failed' }]);
    send({ k: 'audio-restart-required', reason: undefined }); assert.equal(events.length, 2);
    assert.equal(f.media.isConnected(), true); assert.deepEqual(f.errors, []);
    remove(); throwing(); send({}); assert.equal(events.length, 2);
    f.media.close(); send({}); assert.equal(events.length, 2, 'closed peers cannot dispatch retained callbacks');
  } finally { remove(); throwing(); f.media.close(); }
});

test('native audio signaling requires authentication and closing retires pending negotiation without affecting later owners', async () => {
  const media = createRtcMediaTransport({ PeerConnection: Peer });
  try { await assert.rejects(media.audioOffer({ sdp: 'offer', generation: 1 }), error => error.reason === 'audio-unavailable'); }
  finally { media.close(); }
  const f = await fixture();
  const pending = f.media.audioOffer({ sdp: 'offer', generation: 1 });
  const rejected = assert.rejects(pending, error => error.reason === 'transport-closed');
  const offer = f.channels.control.sent.find(message => message.k === 'audio-offer');
  f.media.close(); await rejected;
  f.channels.control.receive(audioAnswer(offer)); assert.equal(f.media.stats().state, 'closed');
});

test('pre-auth native audio events cannot bypass authentication or tear down the main peer', async () => {
  const f = await fixture({ exchange: async () => {
    Peer.latest.channels.control.receive(JSON.stringify({ k: 'audio-error', generation: 1, reason: 'not-authenticated' }));
    return { type: 'answer', sdp: 'remote-answer\r\na=candidate:1 1 udp 1 192.0.2.2 5001 typ host\r\n',
      epoch: 7, fragmentBytes: RTC_FRAGMENT_BYTES, transport: RTC_TRANSPORT };
  } });
  try { assert.equal(f.media.isConnected(), true); assert.deepEqual(f.errors, []); assert.equal(f.media.stats().nativeAudioInvalidEvents, 1); }
  finally { f.media.close(); }
});

test('native slot-ready control is exact-owner, generation-bound and independent of media payloads', async () => {
  const f = await fixture();
  try {
    const owner = { rtcGeneration: 1, rtpSlot: 'slot_0', rtcOwnerEpoch: 0xffffffff, type: 255, mode: 'carplay' };
    assert.throws(() => f.media.audioTrackReady(owner), error => error.reason === 'audio-track-ready-format');
    const pending = f.media.audioOffer({ sdp: 'offer', generation: 1 });
    const offer = f.channels.control.sent.find(message => message.k === 'audio-offer');
    f.channels.control.receive(audioAnswer(offer)); await pending;
    for (const value of [{ ...owner, rtcGeneration: 2 }, { ...owner, rtpSlot: '' }, { ...owner, rtpSlot: 0 },
      { ...owner, rtcOwnerEpoch: -1 }, { ...owner, rtcOwnerEpoch: 0x100000000 }, { ...owner, type: 5 },
      { ...owner, type: 256 }, { ...owner, mode: 'invalid' }])
      assert.throws(() => f.media.audioTrackReady(value), error => error.reason === 'audio-track-ready-format');
    f.media.audioTrackReady({ ...owner, extra: 'discarded' });
    assert.deepEqual(f.channels.control.sent.at(-1), { k: 'audio-track-ready', ...owner });
    assert.equal(f.media.isConnected(), true);
  } finally { f.media.close(); }
});

test('native video uses a recvonly transceiver and withholds remote track until authentication', async () => {
  const received = [], video = { kind: 'video', stopped: 0, stop() { this.stopped++; } };
  class TrackPeer extends Peer {
    addTransceiver(kind, options) {
      this.videoTransceiver = { kind, ...options, setCodecPreferences: codecs => { this.preferredCodecs = codecs; } };
      return this.videoTransceiver;
    }
    async setRemoteDescription(description) {
      this.ontrack({ track: video });
      assert.equal(received.length, 0, 'an SDP track event is not an authenticated media session');
      await super.setRemoteDescription(description);
    }
  }
  const codecs = [{ mimeType: 'video/H264', clockRate: 90000 }];
  const f = await fixture({ PeerConnection: TrackPeer, videoTrack: true, videoCodecs: codecs, onVideoTrack: track => received.push(track) });
  assert.equal(f.peer.videoTransceiver.kind, 'video'); assert.equal(f.peer.videoTransceiver.direction, 'recvonly');
  assert.deepEqual(f.peer.preferredCodecs, codecs); assert.deepEqual(received, [video]);
  assert.equal(f.media.fallbackVideo, undefined, 'live video cannot fall back to a compressed DataChannel decoder');
  assert.equal(f.media.isConnected(), true);
  assert.equal(f.channels.audio.readyState, 'open');
  assert.equal(f.media.videoTrack(), video); f.media.close(); assert.equal(video.stopped, 1);
  const late = { kind: 'video', stopped: false, stop() { this.stopped = true; } };
  f.peer.ontrack({ track: late }); assert.equal(late.stopped, true); assert.equal(received.length, 1);
});

test('legacy peers never request a media transceiver', async () => {
  const f = await fixture();
  assert.equal(f.peer.videoTransceiver, undefined); assert.equal(f.media.videoTrack(), null);
  f.media.close();
});

class RenegotiatingPeer extends Peer {
  constructor(options) { super(options); this.transceivers = []; }
  addTransceiver(kind, options) {
    const transceiver = { kind, ...options, stopped: false, stop() { this.stopped = true; }, setCodecPreferences(codecs) { this.codecs = codecs; } };
    this.transceivers.push(transceiver); return transceiver;
  }
  async setRemoteDescription(description) {
    if (!this.remoteDescription) await super.setRemoteDescription(description);
    else this.remoteDescription = description;
    const track = { kind: 'video', stopped: false, stop() { this.stopped = true; } };
    this.ontrack({ track, transceiver: this.transceivers.at(-1) });
  }
}
const videoOptions = { PeerConnection: RenegotiatingPeer, videoTrack: true, videoCodecs: [{ mimeType: 'video/H264', clockRate: 90000 }] };
const videoAnswer = request => JSON.stringify({ k: 'video-answer', q: request.q, generation: request.generation,
  videoTransport: 'webrtc-track-v1', sdp: 'new-answer\r\na=candidate:1 1 udp 1 192.0.2.2 5001 typ host\r\n' });

test('video-only renegotiation waits for generation preparation and retains audio/control and metadata', async () => {
  let prepare, prepared = false;
  const tracks = [], generations = [];
  const f = await fixture({ ...videoOptions, onVideoTrack: (track, generation) => tracks.push({ track, generation }),
    onVideoGeneration: generation => { generations.push(generation); return new Promise(resolve => { prepare = () => { prepared = true; resolve(); }; }); } });
  try {
    const original = tracks[0].track;
    const pending = f.media.restartVideo();
    assert.equal(f.media.restartVideo(), pending, 'only one negotiation can be in flight');
    await settle();
    const offer = f.channels.control.sent.find(value => value.k === 'video-offer');
    assert.equal(offer.generation, 2); assert.equal(original.stopped, true); assert.equal(f.peer.transceivers[0].stopped, true);
    f.channels.control.receive(videoAnswer(offer)); await settle();
    assert.deepEqual(generations, [2]); assert.equal(tracks.length, 1);
    assert.equal(f.channels.control.sent.some(value => value.k === 'video-ready'), false);
    prepare(); await pending;
    assert.equal(prepared, true); assert.equal(tracks.at(-1).generation, 2);
    assert.deepEqual(f.channels.control.sent.at(-1), { k: 'video-ready', generation: 2 });
    assert.equal(f.media.isConnected(), true); assert.equal(f.channels.audio.readyState, 'open'); assert.equal(f.channels.video.readyState, 'open');
    assert.equal(f.peer.options.bundlePolicy, 'max-bundle');
  } finally { f.media.close(); }
});

test('video renegotiation timeout is bounded and a late answer cannot settle a later attempt', async () => {
  const f = await fixture({ ...videoOptions, videoTimeoutMs: 15 });
  try {
    await assert.rejects(f.media.restartVideo(), error => error.reason === 'rtc-video-renegotiation-timeout');
    assert.equal(f.media.isConnected(), true);
    const old = f.channels.control.sent.find(value => value.k === 'video-offer');
    let settled = false;
    const second = f.media.restartVideo().then(() => { settled = true; });
    await settle(); const current = f.channels.control.sent.filter(value => value.k === 'video-offer').at(-1);
    assert.notEqual(current.q, old.q); assert.equal(current.generation, old.generation);
    f.channels.control.receive(videoAnswer(old)); await settle(); assert.equal(settled, false);
    f.channels.control.receive(videoAnswer(current)); await second;
    assert.equal(f.media.isConnected(), true);
  } finally { f.media.close(); }
});

test('closing a peer cancels video negotiation and cannot deliver its late track/answer to another owner', async () => {
  const f = await fixture(videoOptions);
  const pending = f.media.restartVideo(); await settle();
  const offer = f.channels.control.sent.find(value => value.k === 'video-offer');
  f.media.close(); await assert.rejects(pending);
  f.channels.control.receive(videoAnswer(offer));
  assert.equal(f.media.stats().state, 'closed');
  assert.equal(f.channels.control.sent.some(value => value.k === 'video-ready'), false);
});

test('video-only errors and stale video generations cannot retire independent audio', async () => {
  const errors = [], f = await fixture({ ...videoOptions, onVideoError: reason => errors.push(reason) });
  try {
    f.channels.control.receive(JSON.stringify({ k: 'video-error', reason: 'unsupported-codec', generation: 1 }));
    f.channels.control.receive(JSON.stringify({ k: 'video-error', reason: 'old-source', generation: 0 }));
    assert.deepEqual(errors, ['unsupported-codec']); assert.equal(f.media.isConnected(), true); assert.equal(f.errors.length, 0);
  } finally { f.media.close(); }
});

test('direct peer uses reliable ordered channels and never configures a relay or partial reliability', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(f.peer.options.iceServers, []);
    for (const channel of Object.values(f.channels)) assert.deepEqual(channel.options, { ordered: true });
    assert.equal(f.media.stats().generation, 7);
    const response = f.media.control(1, [{ k: 't', p: [[0, 0.3, 0.4, 1]] }]);
    assert.deepEqual(f.channels.control.sent.at(-1), { s: 'safe', q: 1, e: [{ k: 't', p: [[0, 0.3, 0.4, 1]] }] });
    f.channels.control.receive(JSON.stringify({ q: 1, state: 'streaming' }));
    assert.deepEqual(await response, { q: 1, state: 'streaming' });
  } finally { f.media.close(); }
});

test('a remote channel close preserves its safe label while local retirement cannot overwrite it', async () => {
  const f = await fixture();
  f.channels.audio.close();
  assert.equal(f.errors.length, 1); assert.equal(f.errors[0].reason, 'channel-closed');
  assert.equal(f.media.stats().channelClosedLabel, 'audio');
  assert.equal(f.media.stats().reason, 'channel-closed');
  assert.equal(f.errors[0].rtcDiagnostic.audioChannelState, 'closed');
  f.channels.video.close(); f.media.close();
  assert.equal(f.media.stats().channelClosedLabel, 'audio');
  assert.equal(f.errors.length, 1);
});

test('fragmented records retain bytes and credits wait for downstream consumption, including transferred buffers', async () => {
  const f = await fixture();
  const reader = f.media.video.getReader();
  try {
    const input = Uint8Array.from({ length: 40000 }, (_, i) => i % 251);
    for (let offset = 0; offset < input.length; offset += 16000) {
      f.channels.video.receive(fragment(input.subarray(offset, offset + 16000), { offset, total: input.length }));
    }
    assert.equal(f.channels.control.sent.filter(value => value.k === 'ack').length, 0);
    assert.equal(f.media.stats().queuedBytes, input.length);
    const output = (await reader.read()).value;
    assert.deepEqual(output, input);
    assert.equal(f.channels.control.sent.filter(value => value.k === 'ack').length, 0, 'offering bytes does not prove decoder admission');
    structuredClone(output, { transfer: [output.buffer] });
    assert.equal(output.byteLength, 0);
    const next = reader.read();
    await settle();
    assert.deepEqual(f.channels.control.sent.filter(value => value.k === 'ack'), [{ k: 'ack', channel: 'video', q: 0, bytes: input.length }]);
    assert.equal(f.media.stats().queuedBytes, 0, 'detaching the payload cannot lose resource accounting');
    f.channels.video.receive(fragment(Uint8Array.of(9, 8), { q: 1 }));
    assert.deepEqual((await next).value, Uint8Array.of(9, 8));
  } finally { await reader.cancel(); reader.releaseLock(); f.media.close(); }
});

test('single-fragment records retain native storage and credit accounting survives its transfer', async () => {
  const f = await fixture(), reader = f.media.video.getReader();
  try {
    const input = Uint8Array.of(4, 9, 17), message = fragment(input);
    f.channels.video.receive(message);
    const output = (await reader.read()).value;
    assert.equal(output.buffer, message);
    assert.equal(output.byteOffset, RTC_HEADER_BYTES);
    assert.deepEqual(output, input);
    structuredClone(output, { transfer: [output.buffer] });
    assert.equal(message.byteLength, 0);
    const pending = reader.read();
    await settle();
    assert.deepEqual(f.channels.control.sent.filter(value => value.k === 'ack'),
      [{ k: 'ack', channel: 'video', q: 0, bytes: 3 }]);
    assert.equal(f.media.stats().queuedBytes, 0);
    f.channels.video.receive(fragment(Uint8Array.of(20), { q: 1 }));
    assert.deepEqual((await pending).value, Uint8Array.of(20));
  } finally { await reader.cancel(); reader.releaseLock(); f.media.close(); }
});

test('audio cancellation explicitly retires queued work, retains FIFO credit and starts a fresh subscription', async () => {
  const f = await fixture();
  try {
    const body = f.media.openAudio(), reader = body.getReader();
    assert.deepEqual(f.channels.control.sent.at(-1), { k: 'audio-ready', enabled: true, generation: 1 });
    f.channels.control.receive(JSON.stringify({ k: 'audio-barrier', generation: 1, sequence: 0, epoch: 7 }));
    f.channels.audio.receive(fragment(Uint8Array.of(1, 2)));
    await reader.read();
    f.channels.audio.receive(fragment(Uint8Array.of(3, 4), { q: 1 }));
    await reader.cancel(); reader.releaseLock();
    assert.deepEqual(f.channels.control.sent.slice(-3), [
      { k: 'ack', channel: 'audio', q: 0, bytes: 2 }, { k: 'ack', channel: 'audio', q: 1, bytes: 2 }, { k: 'audio-ready', enabled: false, generation: 1 },
    ]);
    assert.equal(f.media.stats().queuedBytes, 0);
    const next = f.media.openAudio().getReader();
    f.channels.control.receive(JSON.stringify({ k: 'audio-barrier', generation: 2, sequence: 2, epoch: 7 }));
    f.channels.audio.receive(fragment(Uint8Array.of(5, 6), { q: 2 }));
    assert.deepEqual((await next.read()).value, Uint8Array.of(5, 6));
    await next.cancel();
  } finally { f.media.close(); }
});

test('stale epochs, malformed bounds, duplicate fragments and receiver overflow fail before decoding', async () => {
  const bad = [
    () => fragment(Uint8Array.of(1), { epoch: 6 }),
    () => fragment(Uint8Array.of(1), { total: 8 * 1024 * 1024 + 25 }),
    () => fragment(Uint8Array.of(1), { offset: 1, total: 2 }),
    () => fragment(Uint8Array.of(1), { q: 1 }),
  ];
  for (const make of bad) {
    const f = await fixture(), reader = f.media.video.getReader();
    f.channels.video.receive(make());
    await assert.rejects(reader.read(), { name: 'RtcTransportError' });
    assert.equal(f.media.stats().reassemblyErrors, 1);
    assert.equal(f.media.stats().queuedBytes, 0);
    assert.equal(f.errors.length, 1);
    f.media.close(); reader.releaseLock();
  }
  const f = await fixture(), reader = f.media.video.getReader();
  const first = fragment(Uint8Array.of(1), { total: 2 });
  f.channels.video.receive(first); f.channels.video.receive(first);
  await assert.rejects(reader.read(), /fragment-order/);
  assert.equal(f.media.stats().reason, 'fragment-order'); f.media.close(); reader.releaseLock();
});

test('aborting or timing out interrupts an unresolved signaling exchange and closes resources', async () => {
  const abort = new AbortController();
  const media = createRtcMediaTransport({ PeerConnection: Peer, signal: abort.signal, exchange: () => new Promise(() => {}), timeoutMs: 200 });
  const pending = media.connect(); await settle(); abort.abort();
  await assert.rejects(pending, /stopped/);
  assert.equal(Peer.latest.closed, true);
  const stuck = createRtcMediaTransport({ PeerConnection: Peer, exchange: () => new Promise(() => {}), timeoutMs: 10 });
  await assert.rejects(stuck.connect(), /connect-timeout/);
  assert.equal(stuck.stats().reason, 'connect-timeout');
});

test('cancelling the video consumer closes the peer instead of leaving sender credit stalled', async () => {
  const f = await fixture();
  await f.media.video.cancel();
  assert.equal(f.peer.closed, true);
  assert.equal(f.media.isConnected(), false);
  assert.equal(f.media.stats().state, 'closed');
});


test('an unconsumed media stream cannot allocate beyond its receiver credit window', async () => {
  const f = await fixture(), reader = f.media.video.getReader();
  const bytes = new Uint8Array(8 * 1024 * 1024);
  for (let q = 0; q < 2; q++) {
    for (let offset = 0; offset < bytes.length; offset += 16000) {
      f.channels.video.receive(fragment(bytes.subarray(offset, offset + 16000), { q, offset, total: bytes.length }));
    }
  }
  assert.equal(f.media.stats().queuedBytes, 16 * 1024 * 1024);
  f.channels.video.receive(fragment(Uint8Array.of(1), { q: 2 }));
  await assert.rejects(reader.read(), /receiver-overflow/);
  assert.equal(f.media.stats().highWaterBytes, 16 * 1024 * 1024);
  assert.equal(f.media.stats().queuedBytes, 0);
  assert.equal(f.peer.closed, true);
  f.media.close(); reader.releaseLock();
});


test('missing host candidates fail with a distinct interface or policy diagnosis before signaling', async () => {
  class NoCandidates extends Peer { async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; } }
  let exchanges = 0;
  const media = createRtcMediaTransport({ PeerConnection: NoCandidates, exchange: async () => { exchanges++; } });
  await assert.rejects(media.connect(), /no-local-candidates/);
  assert.equal(exchanges, 0);
  assert.equal(media.stats().localCandidates, 0);
  assert.equal(media.stats().stage, 'ice-gathering');
  assert.equal(media.stats().reason, 'no-local-candidates');
});


test('a reopened audio subscription holds cross-channel arrivals until its generation barrier and retires old guidance', async () => {
  const f = await fixture();
  try {
    const old = f.media.openAudio().getReader();
    f.channels.control.receive(JSON.stringify({ k: 'audio-barrier', generation: 1, sequence: 0, epoch: 7 }));
    await old.cancel(); old.releaseLock();
    const next = f.media.openAudio().getReader();
    let delivered = false;
    const reading = next.read().then(value => { delivered = true; return value; });
    // Both messages arrive after reopening. Only the barrier identifies which subscription sent them.
    f.channels.audio.receive(fragment(Uint8Array.of(10), { q: 0 }));
    f.channels.audio.receive(fragment(Uint8Array.of(20), { q: 1 }));
    await settle(); assert.equal(delivered, false);
    f.channels.control.receive(JSON.stringify({ k: 'audio-barrier', generation: 1, sequence: 0, epoch: 7 }));
    await settle(); assert.equal(delivered, false, 'a delayed old-generation barrier cannot unlock a new consumer');
    f.channels.control.receive(JSON.stringify({ k: 'audio-barrier', generation: 2, sequence: 1, epoch: 7 }));
    assert.deepEqual((await reading).value, Uint8Array.of(20));
    assert.deepEqual(f.channels.control.sent.filter(message => message.k === 'ack'), [{ k: 'ack', channel: 'audio', q: 0, bytes: 1 }]);
    await next.cancel();
    assert.deepEqual(f.channels.control.sent.filter(message => message.k === 'ack'), [
      { k: 'ack', channel: 'audio', q: 0, bytes: 1 }, { k: 'ack', channel: 'audio', q: 1, bytes: 1 },
    ]);
  } finally { f.media.close(); }
});

test('an audio barrier can precede old in-flight fragments without corrupting FIFO credits or the next complete record', async () => {
  const f = await fixture();
  try {
    const old = f.media.openAudio().getReader(); await old.cancel();
    const next = f.media.openAudio().getReader(), reading = next.read();
    f.channels.control.receive(JSON.stringify({ k: 'audio-barrier', generation: 2, sequence: 1, epoch: 7 }));
    f.channels.audio.receive(fragment(Uint8Array.of(1), { q: 0, total: 2 }));
    f.channels.audio.receive(fragment(Uint8Array.of(2), { q: 0, total: 2, offset: 1 }));
    f.channels.audio.receive(fragment(Uint8Array.of(3), { q: 1 }));
    assert.deepEqual((await reading).value, Uint8Array.of(3));
    assert.deepEqual(f.channels.control.sent.filter(message => message.k === 'ack'), [{ k: 'ack', channel: 'audio', q: 0, bytes: 2 }]);
    await next.cancel();
  } finally { f.media.close(); }
});


test('cancelling audio while waiting for its barrier settles a pending reader and cannot retire a later consumer', async () => {
  const f = await fixture();
  try {
    const old = f.media.openAudio().getReader();
    const pending = old.read();
    await old.cancel();
    assert.equal((await pending).done, true);
    const next = f.media.openAudio().getReader(), reading = next.read();
    f.channels.control.receive(JSON.stringify({ k: 'audio-barrier', generation: 1, sequence: 0, epoch: 7 }));
    assert.equal(f.media.stats().audioBarrierPending, true);
    f.channels.audio.receive(fragment(Uint8Array.of(3), { q: 0 }));
    f.channels.control.receive(JSON.stringify({ k: 'audio-barrier', generation: 2, sequence: 0, epoch: 7 }));
    assert.deepEqual((await reading).value, Uint8Array.of(3));
    await next.cancel();
    assert.equal(f.media.stats().audioBarrierPending, false);
  } finally { f.media.close(); }
});

test('a partial record retired during cancellation cannot leak into the reopened audio subscription', async () => {
  const f = await fixture();
  try {
    const old = f.media.openAudio().getReader();
    f.channels.audio.receive(fragment(Uint8Array.of(1), { q: 0, total: 2 }));
    await old.cancel();
    const next = f.media.openAudio().getReader(), reading = next.read();
    f.channels.audio.receive(fragment(Uint8Array.of(2), { q: 0, total: 2, offset: 1 }));
    f.channels.audio.receive(fragment(Uint8Array.of(3), { q: 1 }));
    f.channels.control.receive(JSON.stringify({ k: 'audio-barrier', generation: 2, sequence: 1, epoch: 7 }));
    assert.deepEqual((await reading).value, Uint8Array.of(3));
    assert.deepEqual(f.channels.control.sent.filter(message => message.k === 'ack'), [{ k: 'ack', channel: 'audio', q: 0, bytes: 2 }]);
    await next.cancel();
  } finally { f.media.close(); }
});
