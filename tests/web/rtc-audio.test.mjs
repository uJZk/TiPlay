// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRtcAudio, rtcAudioCodecs, RTC_AUDIO_SLOTS } from '../../site/play/rtc-audio.js';

const codecs = [{ mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { mimeType: 'audio/PCMU', clockRate: 8000, channels: 1 }, { mimeType: 'audio/telephone-event', clockRate: 8000 }];
const Receiver = { getCapabilities: kind => ({ codecs: kind === 'audio' ? codecs : [] }) };
const record = (fields = {}) => ({ type: 0, mode: 'carplay', epoch: 1, channels: 2, rate: 48000,
  config: { codec: 'opus', audioTransport: 'webrtc-track-v1', rtpSlot: 'slot0', rtcGeneration: 1, semanticType: 0 }, ...fields });
function harness(options = {}) {
  const peers = [], sources = [], messages = [], exchanges = [], errors = [], anchors = [], abort = new AbortController();
  class PeerConnection {
    constructor(configuration) {
      if (options.failPeerConstruction?.()) throw Error('Native peer construction failed.');
      this.configuration = configuration; this.transceivers = []; peers.push(this);
    }
    addTransceiver(kind, options) {
      const transceiver = { kind, options, mid: null, setCodecPreferences(value) { this.codecs = value; } };
      this.transceivers.push(transceiver); return transceiver;
    }
    async createOffer() { return { type: 'offer', sdp: 'offer' }; }
    async setLocalDescription(value) {
      this.localDescription = value; this.transceivers.forEach((value, index) => { value.mid = `slot${index}`; });
    }
    async setRemoteDescription(value) { this.remoteDescription = value; }
    close() { this.closed = true; }
    track(index) {
      const track = { kind: 'audio', stop() { this.stopped = true; }, addEventListener() {} };
      this.ontrack({ track, transceiver: this.transceivers[index] }); return track;
    }
  }
  const node = { port: { postMessage: message => messages.push(message) } };
  const context = { createMediaStreamSource(stream) {
    const source = { stream, connect(...args) { this.connection = args; }, disconnect() { this.disconnected = true; } };
    sources.push(source); return source;
  } };
  const audio = createRtcAudio({ context, node, generation: 7, signal: abort.signal, Receiver, PeerConnection,
    MediaStream: class { constructor(tracks) { this.tracks = tracks; } }, gather: async () => 'gathered offer',
    createPlayout: () => { const anchor = { play() { this.played = true; return Promise.resolve(); },
      pause() { this.paused = true; }, remove() { this.removed = true; } }; anchors.push(anchor); return anchor; },
    exchange: async request => { exchanges.push(request); return { sdp: 'answer', generation: request.generation }; },
    onError: cause => errors.push(cause), ...options });
  return { audio, peers, sources, messages, exchanges, errors, anchors, abort, node };
}

test('RTP audio advertises actual codecs and negotiates sixteen receive-only audio slots without capture', async () => {
  assert.deepEqual(rtcAudioCodecs(Receiver), codecs.slice(0, 2));
  assert.deepEqual(rtcAudioCodecs({ getCapabilities() { throw Error('no API'); } }), []);
  const h = harness();
  try {
    await h.audio.start(1);
    assert.deepEqual(h.peers[0].configuration.iceServers, []);
    assert.equal(h.peers[0].transceivers.length, RTC_AUDIO_SLOTS);
    for (const transceiver of h.peers[0].transceivers) {
      assert.equal(transceiver.kind, 'audio'); assert.equal(transceiver.options.direction, 'recvonly');
      assert.deepEqual(transceiver.codecs, codecs.slice(0, 2));
    }
    assert.deepEqual(h.exchanges, [{ k: 'audio-offer', sdp: 'gathered offer', generation: 1 }]);
    h.peers[0].track(5);
    assert.equal(h.sources.length, 0, 'an unowned track cannot reach the audio graph');
    await h.audio.configure(record({ config: { ...record().config, rtpSlot: 'slot5' } }));
    assert.equal(h.sources.length, 1);
    assert.deepEqual(h.sources[0].connection, [h.node, 0, 5]);
    const binding = h.messages.find(message => message.nativeAudio).nativeAudio;
    assert.equal(binding.rtpSlot, 'slot5');
    assert.equal(binding.inputIndex, 5);
    assert.equal(binding.generation, 7);
  } finally { h.audio.close(); }
});

test('sender ready waits for source connection and exact Worklet binding acknowledgement, with no RTP dependency', async () => {
  const sent = [], h = harness({ ready: value => sent.push(value) });
  try {
    await h.audio.start(1); h.peers[0].track(0);
    let configured = false;
    const pending = h.audio.configure(record()).then(value => { configured = true; return value; });
    while (!h.messages.some(message => message.nativeAudioGraph)) await new Promise(resolve => setImmediate(resolve));
    const graph = h.messages.find(message => message.nativeAudioGraph).nativeAudioGraph;
    assert.equal(configured, false); assert.equal(sent.length, 0);
    assert.ok(h.sources[0].connection, 'graph connection precedes the render-thread barrier');
    assert.equal(h.audio.bound({ ...graph, rtcGeneration: 2 }), false);
    assert.equal(h.audio.bound({ ...graph, epoch: 2 }), false);
    assert.equal(h.audio.bound({ ...graph, epoch: 2, rtcOwnerEpoch: 2 }), false);
    assert.equal(h.audio.bound(graph), true);
    await pending;
    assert.deepEqual(sent, [{ rtcGeneration: 1, rtpSlot: 'slot0', rtcOwnerEpoch: 1, type: 0, mode: 'carplay' }]);
    h.audio.bound(graph); await h.audio.configure(record());
    assert.equal(sent.length, 1, 'duplicate binding acknowledgements cannot release a different slot');
  } finally { h.audio.close(); }
});

test('one silent playout anchor starts on the first owned slot and survives its EOS for other slots', async () => {
  const h = harness();
  try {
    await h.audio.start(1); const first = h.peers[0].track(5);
    assert.equal(h.anchors.length, 0);
    await h.audio.configure(record({ config: { ...record().config, rtpSlot: 'slot5' } }));
    const anchor = h.anchors[0];
    assert.equal(anchor.muted, true); assert.equal(anchor.defaultMuted, true); assert.equal(anchor.volume, 0);
    assert.equal(anchor.hidden, true); assert.equal(anchor.controls, false);
    assert.equal(anchor.played, true); assert.deepEqual(anchor.srcObject.tracks, [first]);
    assert.equal(h.audio.end(record({ config: { ...record().config, rtpSlot: 'slot5' } })), true);
    h.peers[0].track(9);
    await h.audio.configure(record({ type: 1, config: { ...record().config, semanticType: 1, rtpSlot: 'slot9' } }));
    assert.equal(h.anchors.length, 1); assert.equal(anchor.paused, undefined);
    assert.deepEqual(h.sources[1].connection, [h.node, 0, 9]);
    await h.audio.start(2);
    assert.equal(anchor.paused, true); assert.equal(anchor.srcObject, null); assert.equal(anchor.removed, true);
  } finally { h.audio.close(); }
});

test('native ready waits for successful silent playout as well as the Worklet barrier', async () => {
  let play;
  const sent = [], h = harness({ ready: value => sent.push(value),
    createPlayout: () => ({ play: () => new Promise(resolve => { play = resolve; }), pause() {}, remove() {} }) });
  try {
    await h.audio.start(1); h.peers[0].track(0);
    const pending = h.audio.configure(record());
    while (!play) await new Promise(resolve => setImmediate(resolve));
    const graph = h.messages.find(message => message.nativeAudioGraph).nativeAudioGraph;
    assert.equal(h.audio.bound(graph), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sent.length, 0);
    play(); await pending; assert.equal(sent.length, 1);
  } finally { h.audio.close(); }
});

test('rejected silent playout fails the native peer and releases its source without reporting ready', async () => {
  const sent = [], anchor = { play: () => Promise.reject(Error('blocked')), pause() { this.paused = true; }, remove() { this.removed = true; } };
  const h = harness({ ready: value => sent.push(value), createPlayout: () => anchor });
  try {
    await h.audio.start(1); h.peers[0].track(0);
    await assert.rejects(h.audio.configure(record()), /playout could not start/);
    assert.equal(sent.length, 0); assert.equal(h.errors.length, 1); assert.equal(h.peers[0].closed, true);
    assert.equal(anchor.paused, true); assert.equal(anchor.srcObject, null); assert.equal(anchor.removed, true);
    assert.equal(h.sources[0].disconnected, true);
  } finally { h.audio.close(); }
});

test('late playout success or rejection after cancellation cannot revive the graph or send ready', async () => {
  for (const rejected of [false, true]) {
    let settle;
    const sent = [], anchor = { play: () => new Promise((yes, no) => { settle = rejected ? no : yes; }),
      pause() { this.paused = true; }, remove() { this.removed = true; } };
    const h = harness({ ready: value => sent.push(value), createPlayout: () => anchor });
    try {
      await h.audio.start(1); h.peers[0].track(0);
      const pending = h.audio.configure(record());
      const cancelled = assert.rejects(pending, { name: 'AbortError' });
      while (!settle) await new Promise(resolve => setImmediate(resolve));
      h.audio.bound(h.messages.find(message => message.nativeAudioGraph).nativeAudioGraph);
      h.abort.abort(); await cancelled; settle(Error('late'));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(sent.length, 0); assert.equal(h.errors.length, 0);
      assert.equal(anchor.paused, true); assert.equal(anchor.srcObject, null); assert.equal(anchor.removed, true);
    } finally { h.audio.close(); }
  }
});

test('retirement between binding and the queued ready send cannot signal the old owner', async () => {
  const sent = [], h = harness({ ready: value => sent.push(value) });
  try {
    await h.audio.start(1); h.peers[0].track(0);
    const pending = h.audio.configure(record());
    const cancelled = assert.rejects(pending, { name: 'AbortError' });
    while (!h.messages.some(message => message.nativeAudioGraph)) await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    h.audio.bound(h.messages.find(message => message.nativeAudioGraph).nativeAudioGraph);
    h.audio.close(); await cancelled;
    assert.equal(sent.length, 0);
  } finally { h.audio.close(); }
});

test('EOS during delayed playout still releases the original staged tail and keeps later slots usable', async () => {
  let play;
  const sent = [], h = harness({ ready: value => sent.push(value),
    createPlayout: () => ({ play: () => new Promise(resolve => { play = resolve; }), pause() {}, remove() {} }) });
  try {
    await h.audio.start(1); h.peers[0].track(0);
    const pending = h.audio.configure(record());
    while (!play) await new Promise(resolve => setImmediate(resolve));
    const graph = h.messages.find(message => message.nativeAudioGraph).nativeAudioGraph;
    assert.equal(h.audio.end(record()), true); h.audio.bound(graph);
    play(); await pending; assert.equal(sent.length, 1);
    h.peers[0].track(3);
    const second = h.audio.configure(record({ type: 1, config: { ...record().config, rtpSlot: 'slot3', semanticType: 1 } }));
    while (!h.messages.some(message => message.nativeAudioGraph?.type === 1)) await new Promise(resolve => setImmediate(resolve));
    h.audio.bound(h.messages.find(message => message.nativeAudioGraph?.type === 1).nativeAudioGraph);
    await second; assert.equal(sent.length, 2); assert.equal(h.peers[0].closed, undefined);
  } finally { h.audio.close(); }
});

test('a missing Worklet readiness acknowledgement times out and closes only the native peer', async () => {
  const sent = [], h = harness({ ready: value => sent.push(value), trackTimeoutMs: 15 });
  try {
    await h.audio.start(1); h.peers[0].track(0);
    await assert.rejects(h.audio.configure(record()), /graph preparation timed out/);
    assert.equal(h.peers[0].closed, true); assert.equal(sent.length, 0); assert.equal(h.errors.length, 1);
  } finally { h.audio.close(); }
});

test('EOS preserves the original graph and purpose for buffered RTP tails; slot owners cannot be reused', async () => {
  const h = harness();
  try {
    await h.audio.configure(record()); h.peers[0].track(0);
    assert.equal(h.audio.end(record()), true);
    assert.equal(h.sources[0].disconnected, undefined, 'EOS must not truncate browser-buffered audio');
    assert.ok(h.messages.at(-1).nativeAudioEnd);
    assert.equal(h.audio.stats().drainUnknown, true);
    await assert.rejects(h.audio.configure(record({ epoch: 2 })), /slot reuse/);
    await assert.rejects(h.audio.configure(record()), /ended native audio slot/);
  } finally { h.audio.close(); }
});

test('advanced wire EOS uses immutable slot owner epoch and cannot end a different receiver or generation', async () => {
  const h = harness();
  try {
    const source = record({ epoch: 77, config: { ...record().config, rtcOwnerEpoch: 77 } });
    await h.audio.configure(source); h.peers[0].track(0);
    const ended = { ...source, epoch: 78, config: { ...source.config, ended: true } };
    assert.equal(h.audio.end({ ...ended, config: { ...ended.config, rtcOwnerEpoch: 76 } }), false);
    assert.equal(h.audio.end({ ...ended, config: { ...ended.config, rtpSlot: 'slot1' } }), false);
    assert.equal(h.audio.end({ ...ended, config: { ...ended.config, rtcGeneration: 2 } }), false);
    assert.equal(h.audio.end({ ...ended, epoch: 76 }), false);
    assert.equal(h.audio.end(ended), true);
    assert.equal(h.messages.at(-1).nativeAudioEnd.epoch, 77, 'the Worklet owner is not relabelled with the wire retirement epoch');
    assert.equal(h.sources[0].disconnected, undefined);
  } finally { h.audio.close(); }
});

test('EOS before ontrack still permits the original tail, while generation replacement retires all old sources', async () => {
  const h = harness();
  try {
    await h.audio.configure(record()); h.audio.end(record());
    const track = h.peers[0].track(0); assert.equal(h.sources.length, 1);
    await h.audio.start(2);
    assert.equal(h.sources[0].disconnected, true); assert.equal(track.stopped, true);
    assert.equal(h.peers[0].closed, true);
    assert.ok(h.messages.some(message => message.nativeAudioRetire?.rtcGeneration === 1));
    await assert.rejects(h.audio.start(1), /Stale/);
    await h.audio.configure(record({ epoch: 2, config: { ...record().config, rtcGeneration: 2 } }));
    h.peers[1].track(0); assert.equal(h.sources.length, 2);
  } finally { h.audio.close(); }
});

test('same-owner purpose changes and bad answers fail explicitly without transcoding or a fallback peer', async () => {
  const h = harness();
  try {
    await h.audio.configure(record());
    await assert.rejects(h.audio.configure(record({ config: { ...record().config, semanticType: 1 } })), /purpose changed/);
    assert.equal(h.peers.length, 1);
  } finally { h.audio.close(); }
  const bad = harness({ exchange: async () => ({ sdp: 'answer', generation: 99 }) });
  try { await assert.rejects(bad.audio.start(1), /Invalid native audio answer/); assert.equal(bad.errors.length, 1); }
  finally { bad.audio.close(); }
});

test('late signaling completion cannot revive an aborted audio graph', async () => {
  let answer;
  const h = harness({ exchange: () => new Promise(resolve => { answer = resolve; }) });
  const pending = h.audio.start(1);
  while (!answer) await new Promise(resolve => setImmediate(resolve));
  h.abort.abort(); answer({ sdp: 'answer', generation: 1 });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(h.peers[0].closed, true); assert.equal(h.sources.length, 0);
});

test('native peer diagnostics distinguish negotiation, ICE and graph readiness without implementation text', async () => {
  const h = harness({ ready() {} });
  try {
    assert.equal(h.audio.stats().state, 'idle');
    const initial = h.audio.start(1);
    assert.equal(h.audio.stats().state, 'connecting');
    await initial;
    const peer = h.peers[0];
    peer.connectionState = 'connecting'; peer.iceConnectionState = 'checking'; peer.iceGatheringState = 'complete';
    assert.equal(h.audio.stats().state, 'ready', 'ready only describes SDP installation');
    assert.equal(h.audio.stats().peerState, 'connecting'); assert.equal(h.audio.stats().iceState, 'checking');
    assert.equal(h.audio.stats().gatheringState, 'complete');
    assert.equal(h.audio.stats().tracks, 0); assert.equal(h.audio.stats().boundSlots, 0); assert.equal(h.audio.stats().readySlots, 0);
    peer.track(0);
    const pending = h.audio.configure(record());
    while (!h.messages.some(message => message.nativeAudioGraph)) await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.audio.stats().tracks, 1); assert.equal(h.audio.stats().streams, 1);
    assert.equal(h.audio.stats().readySlots, 0);
    h.audio.bound(h.messages.find(message => message.nativeAudioGraph).nativeAudioGraph);
    await pending;
    assert.equal(h.audio.stats().boundSlots, 1); assert.equal(h.audio.stats().readySlots, 1);
    peer.connectionState = 'connected'; peer.iceConnectionState = 'completed';
    assert.equal(h.audio.stats().peerState, 'connected'); assert.equal(h.audio.stats().iceState, 'completed');
    h.audio.end(record());
    assert.equal(h.audio.stats().readySlots, 0); assert.equal(h.audio.stats().streams, 0); assert.equal(h.audio.stats().drainUnknown, true);
    peer.connectionState = 'private-error'; peer.iceConnectionState = 'private-error'; peer.iceGatheringState = 'private-error';
    assert.equal(h.audio.stats().peerState, 'unavailable'); assert.equal(h.audio.stats().iceState, 'unavailable');
    assert.equal(h.audio.stats().gatheringState, 'unavailable');
    await h.audio.start(2);
    assert.equal(h.audio.stats().rtcGeneration, 2); assert.equal(h.audio.stats().tracks, 0); assert.equal(h.audio.stats().boundSlots, 0);
  } finally { h.audio.close(); }
});

test('failed and closed native peers expose no live graph counts or pending drain', async () => {
  const h = harness({ ready() {} });
  try {
    await h.audio.start(1); h.peers[0].track(0);
    const configuring = h.audio.configure(record());
    while (!h.messages.some(message => message.nativeAudioGraph)) await new Promise(resolve => setImmediate(resolve));
    h.audio.bound(h.messages.find(message => message.nativeAudioGraph).nativeAudioGraph); await configuring;
    assert.equal(h.audio.stats().readySlots, 1); assert.equal(h.audio.stats().streams, 1);
    assert.equal(h.audio.active({ ...record(), rtcGeneration: 1 }), true);
    h.audio.fail(Error('Transport failed.'));
    assert.equal(h.audio.stats().state, 'failed'); assert.equal(h.audio.active({ ...record(), rtcGeneration: 1 }), false);
    for (const field of ['tracks', 'boundSlots', 'readySlots', 'streams']) assert.equal(h.audio.stats()[field], 0, field);
    assert.equal(h.audio.stats().drainUnknown, false);
    h.audio.close(); assert.equal(h.audio.stats().state, 'closed');
    for (const field of ['tracks', 'boundSlots', 'readySlots', 'streams']) assert.equal(h.audio.stats()[field], 0, field);
  } finally { h.audio.close(); }
});

test('replacement peer construction failure cannot report the retired ready peer as live', async () => {
  let failCreate = false;
  const h = harness({ failPeerConstruction: () => failCreate });
  try {
    await h.audio.start(1); h.peers[0].track(0); await h.audio.configure(record());
    assert.equal(h.audio.stats().state, 'ready'); assert.equal(h.audio.stats().tracks, 1); assert.equal(h.audio.stats().streams, 1);
    h.audio.end(record()); assert.equal(h.audio.stats().drainUnknown, true);
    failCreate = true;
    await assert.rejects(h.audio.start(2), /construction failed/);
    assert.equal(h.peers.length, 1); assert.equal(h.peers[0].closed, true);
    assert.equal(h.audio.stats().state, 'closed'); assert.equal(h.audio.stats().rtcGeneration, 1);
    for (const field of ['tracks', 'boundSlots', 'readySlots', 'streams']) assert.equal(h.audio.stats()[field], 0, field);
    assert.equal(h.audio.stats().drainUnknown, false); assert.equal(h.audio.active({ ...record(), rtcGeneration: 1 }), false);
  } finally { h.audio.close(); }
});
