// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAudio } from '../../site/play/audio.js';
import { browserDiagnosticEvents } from '../../site/play/browser-diagnostics.js';
import { createControlOutbox } from '../../site/play/link.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await turn(); } assert.fail('Native audio did not settle'); }
const opus = { codec: 'opus', sampleRate: 48000, channels: 1, audioTransport: 'webrtc-track-v1', rtpSlot: '0', rtcGeneration: 1 };
function frame(kind, payload, { type = 0, epoch = 1, rate = 48000, flags = 0 } = {}) {
  const bytes = new Uint8Array(28 + payload.byteLength), view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length - 4); bytes[4] = kind; bytes[5] = type; bytes[6] = 1; bytes[7] = flags;
  view.setUint32(8, rate); view.setUint32(16, epoch); view.setFloat64(20, NaN); bytes.set(payload, 28); return bytes;
}
const setup = (config = opus, fields = {}) => frame(6, new TextEncoder().encode(JSON.stringify(config)), { flags: 2, ...fields });
const pcm = () => frame(2, new Uint8Array(new Int16Array([123, 456]).buffer), { type: 2 });
async function harness(t, { exchange, play, getStats, connectionState = 'connected', onNativeAudioFailure = () => {} } = {}) {
  const keys = ['AudioContext', 'AudioWorkletNode', 'RTCPeerConnection', 'RTCRtpReceiver', 'MediaStream', 'document'];
  const saved = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
  const peers = [], nodes = [], contexts = [], sources = [], messages = [], offers = [], modes = [], ready = [];
  globalThis.document = { createElement: () => ({ play: () => play ? play() : Promise.resolve(), pause() {}, remove() {} }) };
  globalThis.MediaStream = class { constructor(tracks) { this.tracks = tracks; } };
  globalThis.RTCRtpReceiver = { getCapabilities: () => ({ codecs: [{ mimeType: 'audio/opus', clockRate: 48000, channels: 2 }] }) };
  globalThis.RTCPeerConnection = class extends EventTarget {
    constructor(config) { super(); this.config = config; this.transceivers = []; this.connectionState = connectionState;
      this.iceConnectionState = connectionState === 'connected' ? 'connected' : 'checking'; peers.push(this);
      if (getStats) this.getStats = () => getStats(this, peers.indexOf(this)); }
    addTransceiver(kind, options) {
      const receiver = { kind, options, mid: String(this.transceivers.length), setCodecPreferences(codecs) { this.codecs = codecs; } };
      this.transceivers.push(receiver); return receiver;
    }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\na=candidate:1 1 udp 1 127.0.0.1 10000 typ host\r\n' }; }
    async setLocalDescription(value) { this.localDescription = value; this.iceGatheringState = 'complete'; }
    async setRemoteDescription(value) {
      this.remoteDescription = value;
      for (const transceiver of this.transceivers) this.ontrack({ transceiver,
        track: { kind: 'audio', addEventListener() {}, stop() { this.stopped = true; } } });
    }
    close() { this.closed = true; }
  };
  globalThis.AudioContext = class {
    constructor() { this.state = 'suspended'; this.sampleRate = 48000; this.audioWorklet = { addModule: async () => {} }; contexts.push(this); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createMediaStreamSource(stream) {
      const source = { stream, connect(...args) { this.connection = args; }, disconnect() { this.disconnected = true; } };
      sources.push(source); return source;
    }
  };
  globalThis.AudioWorkletNode = class {
    constructor(context, name, options) {
      this.options = options; this.port = { postMessage: message => {
        messages.push(message);
        if (message.prepare) queueMicrotask(() => this.port.onmessage?.({ data: { prepared: message.prepare.id } }));
        if (message.nativeAudioGraph) queueMicrotask(() => this.port.onmessage?.({ data: { nativeAudioBound: message.nativeAudioGraph } }));
      } }; nodes.push(this);
    }
    connect() {}
  };
  let controller, eventListener, unsubscribed = 0, fetchCalls = 0;
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'test' }), onMode: mode => modes.push(mode),
    onNativeAudioFailure,
    fetchPhone: async () => { fetchCalls++; return { ok: true, body: new ReadableStream({ start(value) { controller = value; } }) }; } });
  t.after(() => { audio.dispose(); Object.assign(globalThis, saved); });
  await audio.activate();
  audio.attach(new AbortController().signal, { audio: true, audioTransport: 'webrtc-track-v1' }, null, {
    exchange: value => { offers.push(value); return exchange ? exchange(value) : Promise.resolve({ generation: value.generation, sdp: 'answer' }); },
    subscribe: listener => { eventListener = listener; return () => { unsubscribed++; }; },
    ready: value => ready.push(value),
  });
  await until(() => controller);
  return { audio, peers, sources, nodes, messages, offers, contexts, modes, ready,
    send: value => controller.enqueue(value), event: value => eventListener(value), get unsubscribed() { return unsubscribed; },
    get fetchCalls() { return fetchCalls; } };
}

test('native negotiation is background work; fallback PCM proceeds and native Opus never reaches the DC decoder', async t => {
  let answer;
  const h = await harness(t, { exchange: offer => new Promise(resolve => { answer = () => resolve({ generation: offer.generation, sdp: 'answer' }); }) });
  h.send(setup({ ...opus, rtcOwnerEpoch: 1 })); h.send(pcm());
  await until(() => answer && h.messages.some(record => record.type === 2 && record.pcm?.byteLength));
  assert.equal(h.sources.length, 0);
  answer(); await until(() => h.sources.length === 1 && h.ready.length === 1);
  assert.deepEqual(h.ready[0], { rtcGeneration: 1, rtpSlot: '0', rtcOwnerEpoch: 1, type: 0, mode: 'carplay' });
  assert.equal(h.nodes[0].options.numberOfInputs, 16);
  assert.deepEqual(h.sources[0].connection, [h.nodes[0], 0, 0]);
  assert.equal(h.messages.some(record => record.payload || record.neteqConfig), false);
  h.send(setup({ ...opus, rtcOwnerEpoch: 1, ended: true }, { epoch: 2 }));
  await until(() => h.messages.some(message => message.nativeAudioEnd));
  assert.equal(h.messages.find(message => message.nativeAudioEnd).nativeAudioEnd.epoch, 1);
  assert.equal(h.sources[0].disconnected, undefined, 'EOS retains the track tail under its original role');
});

test('native peer restart and audio disable/enable use monotonically increasing generations without stopping fallback', async t => {
  const h = await harness(t); h.send(setup()); await until(() => h.sources.length === 1);
  h.event({ k: 'audio-restart-required', generation: 1 }); await until(() => h.offers.length === 2);
  h.send(setup({ ...opus, rtcGeneration: 2 }, { epoch: 2 })); await until(() => h.sources.length === 2);
  assert.equal(h.sources[0].disconnected, true);
  h.send(pcm()); await until(() => h.messages.some(record => record.type === 2 && record.pcm?.byteLength));
  h.audio.status({ audio: false }); h.audio.status({ audio: true }); await until(() => h.offers.length === 3);
  assert.deepEqual(h.offers.map(value => value.generation), [1, 2, 3]);
  h.send(setup({ ...opus, rtcGeneration: 3 }, { epoch: 3 })); await until(() => h.sources.length === 3);
  assert.equal(h.audio.stats().error, null);
  h.audio.stop(); assert.equal(h.unsubscribed, 1);
});

test('native failures report explicitly while fallback PCM and the main media subscription remain usable', async t => {
  const h = await harness(t); h.send(setup()); await until(() => h.sources.length === 1);
  const resets = h.messages.filter(message => message.reset).length;
  h.event({ k: 'audio-error', generation: 1, reason: 'opus-packetizer-failed' });
  assert.match(h.audio.stats().error, /opus-packetizer-failed/);
  h.send(pcm()); await until(() => h.messages.some(record => record.type === 2 && record.pcm?.byteLength));
  assert.equal(h.messages.filter(message => message.reset).length, resets);
  assert.equal(h.peers[0].closed, true);
});

test('server native failure before owner metadata is visible and cannot stop independent fallback', async t => {
  const h = await harness(t);
  await until(() => h.offers.length === 1);
  h.event({ k: 'audio-error', generation: 1, reason: 'audio-native-codec-unsupported' });
  assert.match(h.audio.stats().error, /audio-native-codec-unsupported/);
  h.send(pcm()); await until(() => h.messages.some(record => record.type === 2 && record.pcm?.byteLength));
  assert.equal(h.sources.length, 0);
});

test('background native negotiation failure is visible even before a native source config and does not block PCM', async t => {
  const h = await harness(t, { exchange: async () => { throw Error('Native audio network unavailable.'); } });
  await until(() => h.audio.stats().error);
  assert.match(h.audio.stats().error, /network unavailable/);
  h.send(pcm()); await until(() => h.messages.some(record => record.type === 2 && record.pcm?.byteLength));
  assert.equal(h.peers[0].closed, true);
});

test('failed ICE retires only that generation and retries while fallback audio continues', async t => {
  const h = await harness(t); h.send(setup()); await until(() => h.sources.length === 1 && h.ready.length === 1);
  const failed = h.peers[0];
  failed.connectionState = 'failed'; failed.iceConnectionState = 'failed'; failed.onconnectionstatechange();
  assert.equal(failed.closed, true);
  assert.equal(h.audio.stats().nativeAudio.failureStage, 'transport');
  assert.equal(h.audio.stats().nativeAudio.failureIceState, 'failed');
  h.send(pcm()); await until(() => h.messages.some(record => record.type === 2 && record.pcm?.byteLength));
  await new Promise(resolve => setTimeout(resolve, 1100));
  await until(() => h.offers.length === 2);
  assert.deepEqual(h.offers.map(value => value.generation), [1, 2]);
  h.event({ k: 'audio-error', generation: 1, reason: 'stale' });
  assert.notEqual(h.peers[1].closed, true);
  h.send(setup({ ...opus, rtcGeneration: 2 }, { epoch: 2 }));
  await until(() => h.ready.length === 2);
  assert.equal(h.ready[1].rtcGeneration, 2);
  h.peers[1].connectionState = 'connected'; h.peers[1].onconnectionstatechange();
  assert.equal(h.audio.stats().nativeAudio.retryAttempts, 0);
});

test('failed-peer ICE counters and frozen sample age cannot leak into replacement browser audio stats', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finishNew;
  const pendingNew = new Promise(resolve => { finishNew = resolve; });
  const report = values => new Map([['pair', { type: 'candidate-pair', state: 'in-progress', ...values }]]);
  const h = await harness(t, { connectionState: 'connecting', getStats: (peer, index) => index === 0
    ? Promise.resolve(report({ requestsSent: 17, requestsReceived: 4 })) : pendingNew });
  await until(() => h.audio.stats().nativeAudio?.iceRequestsSent === 17);
  h.peers[0].connectionState = 'failed'; h.peers[0].iceConnectionState = 'failed'; h.peers[0].onconnectionstatechange();
  assert.equal(h.audio.stats().nativeAudio.iceRequestsSent, 17, 'the failed current peer keeps its last observation');
  assert.equal(h.audio.stats().nativeAudio.failureIceState, 'failed');
  t.mock.timers.tick(1000); await until(() => h.offers.length === 2);
  const pending = h.audio.stats().nativeAudio;
  assert.equal(pending.rtcGeneration, 2); assert.equal(pending.iceStatsState, 'pending');
  assert.equal(pending.failureIceState, 'failed', 'explicit historical failure context stays available');
  for (const field of ['iceRequestsSent', 'iceRequestsReceived', 'iceStatsSampleAgeMs', 'icePairState'])
    assert.equal(Object.hasOwn(pending, field), false, field);
  finishNew(report({ requestsSent: 0 }));
  await until(() => h.audio.stats().nativeAudio.iceStatsState === 'sampled');
  const current = h.audio.stats().nativeAudio;
  assert.equal(current.iceRequestsSent, 0, 'zero is retained only when the replacement actually reports it');
  assert.equal(Object.hasOwn(current, 'iceRequestsReceived'), false);
  assert.ok(current.iceStatsSampleAgeMs >= 0);
});

test('stopping audio cancels the pending independent peer retry', async t => {
  const h = await harness(t); await until(() => h.offers.length === 1);
  h.peers[0].connectionState = 'failed'; h.peers[0].onconnectionstatechange();
  h.audio.stop();
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(h.offers.length, 1);
});

test('native failure crosses the real snapshot formatter and protected outbox before a one-second replacement', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const posts = [], snapshots = [];
  const outbox = createControlOutbox({ send: async (q, events) => { posts.push({ q, events }); return {}; } });
  t.after(() => outbox.close());
  let finishReplacement;
  const replacement = new Promise(resolve => { finishReplacement = resolve; });
  const h = await harness(t, { connectionState: 'connecting',
    getStats: (_, index) => index === 0 ? Promise.resolve(new Map([['pair', { type: 'candidate-pair', state: 'in-progress',
      nominated: false, requestsSent: 17, responsesReceived: 0 }]])) : replacement,
    onNativeAudioFailure: snapshot => {
      snapshots.push(snapshot);
      const [event] = browserDiagnosticEvents({ transport: { generation: 123 }, audio: { nativeAudio: snapshot } }, false);
      outbox.push(event, 'audio-fault');
    } });
  await until(() => h.audio.stats().nativeAudio?.iceRequestsSent === 17);
  h.peers[0].connectionState = 'failed'; h.peers[0].onconnectionstatechange();
  assert.equal(snapshots.length, 1); assert.equal(snapshots[0].rtcGeneration, 1);
  await until(() => posts.length === 1);
  const captured = posts[0].events[0].v;
  assert.equal(captured['audio.nativeAudio.iceRequestsSent'], 17);
  assert.equal(captured['audio.nativeAudio.iceResponsesReceived'], 0);
  assert.equal(captured['audio.nativeAudio.icePairNominated'], 0);
  assert.equal(Object.hasOwn(captured, 'audio.nativeAudio.iceRequestsReceived'), false);
  t.mock.timers.tick(1000); await until(() => h.offers.length === 2);
  assert.equal(h.audio.stats().nativeAudio.iceStatsState, 'pending');
  assert.equal(Object.hasOwn(h.audio.stats().nativeAudio, 'iceRequestsSent'), false);
  finishReplacement(new Map()); await turn();
  assert.equal(captured['audio.nativeAudio.rtcGeneration'], 1);
  assert.equal(captured['audio.nativeAudio.iceRequestsSent'], 17, 'a later peer cannot rewrite the delivered failure');
});

test('failure before the first ICE sample reports pending once and cannot be rewritten by an in-flight result', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let completeOld;
  const reports = [], old = new Promise(resolve => { completeOld = resolve; });
  const h = await harness(t, { connectionState: 'connecting', getStats: (_, index) => index === 0 ? old : new Promise(() => {}),
    onNativeAudioFailure: snapshot => { reports.push(snapshot); throw new Error('diagnostic sink unavailable'); } });
  await until(() => h.offers.length === 1);
  h.peers[0].connectionState = 'failed'; h.peers[0].onconnectionstatechange();
  assert.equal(reports.length, 1); assert.equal(reports[0].iceStatsState, 'pending');
  assert.equal(Object.hasOwn(reports[0], 'iceRequestsSent'), false);
  assert.equal(Object.hasOwn(reports[0], 'iceStatsSampleAgeMs'), false);
  t.mock.timers.tick(1000); await until(() => h.offers.length === 2);
  completeOld(new Map([['late', { type: 'candidate-pair', requestsSent: 99 }]])); await turn();
  assert.equal(reports[0].iceStatsState, 'pending'); assert.equal(reports.length, 1);
  assert.equal(h.audio.stats().nativeAudio.rtcGeneration, 2);
  assert.equal(Object.hasOwn(h.audio.stats().nativeAudio, 'iceRequestsSent'), false);
});

test('new source demand can rearm exhausted audio retries without retrying the same failed demand forever', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = await harness(t, { exchange: async () => { throw Error('Native audio network unavailable.'); } });
  await until(() => h.audio.stats().error);
  for (const delay of [1000, 2000, 4000]) {
    const previous = h.offers.length;
    t.mock.timers.tick(delay); await until(() => h.offers.length > previous && h.peers.at(-1).closed);
  }
  assert.equal(h.offers.length, 4);
  t.mock.timers.tick(10000); await turn(); assert.equal(h.offers.length, 4);
  h.send(pcm()); await until(() => h.messages.some(record => record.type === 2 && record.pcm?.byteLength));
  h.event({ k: 'audio-restart-required', reason: 'audio-new-demand', generation: 4 });
  h.event({ k: 'audio-restart-required', reason: 'audio-new-demand', generation: 4 });
  t.mock.timers.tick(1000); await until(() => h.offers.length === 5);
  assert.deepEqual(h.offers.map(value => value.generation), [1, 2, 3, 4, 5]);
  h.event({ k: 'audio-restart-required', reason: 'audio-new-demand', generation: 4 });
  assert.equal(h.offers.length, 5, 'a retired demand cannot rearm the replacement peer');
});

test('failed native configuration does not abort PCM and can rebind the same owner in the replacement peer', async t => {
  let resolvePlayout, plays = 0;
  const h = await harness(t, { play: () => ++plays === 1 ? new Promise(resolve => { resolvePlayout = resolve; }) : Promise.resolve() });
  const initialFetchCalls = h.fetchCalls, initialResets = h.messages.filter(message => message.reset).length;
  h.send(setup({ ...opus, rtcOwnerEpoch: 1 }));
  await until(() => resolvePlayout && h.sources.length === 1);
  assert.equal(h.ready.length, 0, 'first owner must be waiting for the playout barrier');
  h.peers[0].connectionState = 'failed'; h.peers[0].iceConnectionState = 'failed'; h.peers[0].onconnectionstatechange();
  h.send(pcm());
  await until(() => h.messages.some(record => record.type === 2 && record.pcm?.byteLength));
  await new Promise(resolve => setTimeout(resolve, 1100));
  await until(() => h.offers.length === 2);
  h.send(setup({ ...opus, rtcGeneration: 2, rtcOwnerEpoch: 1 }));
  await until(() => h.ready.length === 1);
  assert.equal(h.fetchCalls, initialFetchCalls, 'the audio subscription stays open across peer recovery');
  assert.equal(h.messages.filter(message => message.reset).length, initialResets, 'peer recovery must not reset PCM');
  assert.equal(h.ready[0].rtcGeneration, 2);
  assert.equal(h.ready[0].rtcOwnerEpoch, 1);
  assert.equal(h.peers[0].closed, true);
  assert.notEqual(h.peers[1].closed, true);
  resolvePlayout(); await turn();
  assert.equal(h.ready.length, 1, 'late completion cannot revive the retired peer');
  const before = h.messages.filter(record => record.type === 2 && record.pcm?.byteLength).length;
  h.send(pcm());
  await until(() => h.messages.filter(record => record.type === 2 && record.pcm?.byteLength).length > before);
});
