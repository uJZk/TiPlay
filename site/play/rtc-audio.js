/*! SPDX-License-Identifier: GPL-3.0-only */
import { gatherLocalOffer } from './webrtc-transport.js';
import { candidateCounts } from './rtc-diagnostics.js';

export const RTC_AUDIO_TRANSPORT = 'webrtc-track-v1';
export const RTC_AUDIO_SLOTS = 16;
const peerStates = ['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed'];
const iceStates = ['new', 'checking', 'connected', 'completed', 'disconnected', 'failed', 'closed'];
const gatheringStates = ['new', 'gathering', 'complete'];
const observedState = (value, allowed) => allowed.includes(value) ? value : 'unavailable';
const pairStates = ['frozen', 'waiting', 'in-progress', 'failed', 'succeeded'];
const iceRoles = ['unknown', 'controlling', 'controlled'];
const dtlsStates = ['new', 'connecting', 'connected', 'closed', 'failed'];

/** RTCStats IDs and candidate identities are used only to select records, never exported. */
function summarizeIceStats(report) {
  const transports = [], candidates = [];
  report.forEach(value => {
    if (value?.type === 'transport') transports.push(value);
    if (value?.type === 'candidate-pair') candidates.push(value);
  });
  const selectedIds = new Set(transports.map(value => value.selectedCandidatePairId)
    .filter(value => typeof value === 'string' && value.length > 0));
  const selected = [...selectedIds].map(id => report.get?.(id)).filter(value => value?.type === 'candidate-pair');
  const pairs = selected.length ? selected : candidates;
  const result = { icePairScope: selected.length ? 'selected' : pairs.length ? 'all' : 'none', icePairCount: pairs.length };
  if (selected.length) result.iceSelectedPairPresent = true;
  else if (transports.length && transports.every(value => value.selectedCandidatePairId === null
    || value.selectedCandidatePairId === '')) result.iceSelectedPairPresent = false;
  function state(records, field, allowed) {
    const values = records.map(value => observedState(value[field], allowed));
    return values.includes('unavailable') ? 'unavailable' : new Set(values).size === 1 ? values[0] : 'mixed';
  }
  if (transports.length) {
    result.iceRole = state(transports, 'iceRole', iceRoles);
    result.dtlsState = state(transports, 'dtlsState', dtlsStates);
  }
  if (!pairs.length) return result;
  result.icePairState = state(pairs, 'state', pairStates);
  if (pairs.some(value => value.nominated === true)) result.icePairNominated = true;
  else if (pairs.every(value => value.nominated === false)) result.icePairNominated = false;
  for (const field of ['requestsSent', 'requestsReceived', 'responsesSent', 'responsesReceived', 'consentRequestsSent']) {
    // Unknown counters are not zero. A sum is exact only when every scoped pair reports it.
    if (!pairs.every(value => Number.isSafeInteger(value[field]) && value[field] >= 0)) continue;
    const sum = pairs.reduce((sum, value) => sum + value[field], 0);
    if (Number.isSafeInteger(sum)) result['ice' + field[0].toUpperCase() + field.slice(1)] = sum;
  }
  return result;
}

/** Advertise actual browser RTP decoders, excluding repair/event-only payloads. */
export function rtcAudioCodecs(Receiver = globalThis.RTCRtpReceiver) {
  try {
    return (Receiver?.getCapabilities?.('audio')?.codecs || []).filter(codec => /^audio\//i.test(codec.mimeType)
      && !/^audio\/(?:red|rtx|cn|telephone-event)$/i.test(codec.mimeType)
      && Number.isInteger(codec.clockRate) && codec.clockRate > 0);
  } catch (_) { return []; }
}

/** Audio-only RTP peer. A silent playout anchor starts Chromium's decoder; the Worklet owns all audible mixing. */
export function createRtcAudio({ exchange, context, node, generation: playbackGeneration,
  signal, onError = () => {}, onConnected = () => {}, PeerConnection = globalThis.RTCPeerConnection,
  Receiver = globalThis.RTCRtpReceiver, MediaStream = globalThis.MediaStream,
  createPlayout = () => {
    if (!globalThis.document?.createElement) throw Error('Native audio playout is unavailable.');
    return document.createElement('audio');
  },
  gather = gatherLocalOffer, timeoutMs = 20000, disconnectTimeoutMs = 5000, ready = null, trackTimeoutMs = 5000 } = {}) {
  let current = null, closed = false;
  const codecs = rtcAudioCodecs(Receiver);
  const ownerEpoch = record => record.rtcOwnerEpoch ?? record.config?.rtcOwnerEpoch ?? record.epoch;
  const identity = record => `${record.mode}:${record.type}:${ownerEpoch(record)}`;
  const stopped = () => new DOMException('Native audio was cancelled.', 'AbortError');
  function disconnect(slot) {
    slot.source?.disconnect(); slot.source = null;
  }
  const samplingLive = peer => current === peer && !closed && !peer.closed;
  function iceEvidence(peer) {
    if (!peer) return {};
    return { ...peer.iceStats, ...(peer.iceStatsAt === undefined ? {} : {
      iceStatsSampleAgeMs: Math.max(0, performance.now() - peer.iceStatsAt) }) };
  }
  function sampleIce(peer, afterStateChange = false) {
    if (!samplingLive(peer)) return;
    if (typeof peer.pc.getStats !== 'function') { peer.iceStats = { iceStatsState: 'unsupported' }; return; }
    if (peer.iceStatsPending) { peer.iceStatsAgain ||= afterStateChange; return; }
    peer.iceStatsPending = true;
    Promise.resolve().then(() => samplingLive(peer) ? peer.pc.getStats() : null).then(report => {
      if (!samplingLive(peer)) return;
      const summary = summarizeIceStats(report);
      peer.iceStats = { iceStatsState: 'sampled', ...summary }; peer.iceStatsAt = performance.now();
    }).catch(() => {
      if (samplingLive(peer)) peer.iceStats = { ...peer.iceStats, iceStatsState: 'failed' };
    }).finally(() => {
      peer.iceStatsPending = false;
      if (peer.iceStatsAgain && samplingLive(peer)) { peer.iceStatsAgain = false; sampleIce(peer); }
    });
  }
  function retire(peer) {
    if (!peer || peer.closed) return;
    peer.closed = true; peer.abort.abort(); clearTimeout(peer.timer); clearInterval(peer.iceStatsTimer);
    peer.reject(peer.error ?? stopped());
    for (const slot of peer.slots) {
      clearTimeout(slot.readyTimer); slot.rejectReady?.(peer.error ?? stopped());
      disconnect(slot); slot.track?.stop?.();
    }
    if (peer.playout) {
      peer.playout.pause(); peer.playout.srcObject = null; peer.playout.remove(); peer.playout = null;
    }
    node.port.postMessage({ nativeAudioRetire: { rtcGeneration: peer.generation, generation: playbackGeneration } });
    peer.pc.close();
  }
  function fail(peer, cause) {
    if (closed || current !== peer || peer.closed) return;
    const detail = { failureStage: peer.stage, failurePeerState: observedState(peer.pc.connectionState, peerStates),
      failureIceState: observedState(peer.pc.iceConnectionState, iceStates),
      localCandidates: candidateCounts(peer.pc.localDescription?.sdp).total,
      localPrivateIpv4Candidates: candidateCounts(peer.pc.localDescription?.sdp).privateIpv4,
      localCgnatIpv4Candidates: candidateCounts(peer.pc.localDescription?.sdp).cgnatIpv4,
      localIpv6Candidates: candidateCounts(peer.pc.localDescription?.sdp).ipv6,
      remoteCandidates: candidateCounts(peer.pc.remoteDescription?.sdp).total,
      remotePrivateIpv4Candidates: candidateCounts(peer.pc.remoteDescription?.sdp).privateIpv4,
      remoteCgnatIpv4Candidates: candidateCounts(peer.pc.remoteDescription?.sdp).cgnatIpv4,
      remoteIpv6Candidates: candidateCounts(peer.pc.remoteDescription?.sdp).ipv6, ...iceEvidence(peer) };
    peer.error = cause; retire(peer); onError(cause, detail);
  }
  function startPlayout(peer, track) {
    if (peer.playoutPromise) return;
    // Connecting a remote track to WebAudio alone does not start Chromium's RTP
    // decoder. One detached, permanently muted element activates peer playout;
    // every source still reaches the output through the common Worklet mixer.
    const anchor = peer.playout = createPlayout();
    anchor.controls = false; anchor.hidden = true; anchor.muted = true; anchor.defaultMuted = true; anchor.volume = 0;
    anchor.srcObject = new MediaStream([track]);
    peer.playoutPromise = Promise.resolve(anchor.play()).then(() => {
      if (closed || current !== peer || peer.closed) return;
      peer.playoutReady = true;
      for (const slot of peer.slots) announceReady(peer, slot);
    }, () => fail(peer, Error('Native audio playout could not start.')));
  }
  function connectSlot(peer, slot) {
    if (!slot.track || !slot.owner || slot.source || peer.closed || !peer.ready) return;
    try {
      slot.source = context.createMediaStreamSource(new MediaStream([slot.track]));
      slot.source.connect(node, 0, slot.index);
      startPlayout(peer, slot.track);
      node.port.postMessage({ nativeAudioGraph: { ...slot.owner, generation: playbackGeneration } });
      prepareSlotDeadline(peer, slot);
      announceReady(peer, slot);
    } catch (cause) { fail(peer, cause); }
  }
  function prepareSlotDeadline(peer, slot) {
    if (typeof ready !== 'function' || !slot.owner || slot.readySent || slot.readyTimer || !peer.transportReady) return;
    slot.readyTimer = setTimeout(() => fail(peer, Error('Native audio graph preparation timed out.')), trackTimeoutMs);
  }
  function announceReady(peer, slot) {
    if (typeof ready !== 'function' || slot.readySent || !slot.bindingConfirmed || !slot.source || !peer.playoutReady
      || !peer.transportReady || peer.closed) return;
    slot.readySent = true;
    const owner = slot.owner;
    Promise.resolve().then(() => {
      if (closed || current !== peer || peer.closed || slot.owner !== owner) return;
      return ready({ rtcGeneration: peer.generation, rtpSlot: owner.rtpSlot,
        rtcOwnerEpoch: owner.epoch, type: owner.type, mode: owner.mode });
    }).then(() => {
      if (current !== peer || peer.closed) return;
      clearTimeout(slot.readyTimer); slot.resolveReady();
    }, cause => fail(peer, cause));
  }
  function transportChanged(peer) {
    if (current !== peer || peer.closed) return;
    sampleIce(peer, true);
    const { connectionState, iceConnectionState } = peer.pc;
    if (['failed', 'closed'].includes(connectionState) || ['failed', 'closed'].includes(iceConnectionState)) {
      fail(peer, Error('Native audio connection failed.')); return;
    }
    const connected = connectionState === 'connected' && ['connected', 'completed'].includes(iceConnectionState);
    if (connected) {
      clearTimeout(peer.timer); peer.timer = null;
      const changed = !peer.transportReady;
      peer.transportReady = true; peer.connected = true;
      for (const slot of peer.slots) { prepareSlotDeadline(peer, slot); announceReady(peer, slot); }
      if (changed) onConnected(peer.generation);
    } else {
      peer.transportReady = false;
      for (const slot of peer.slots) { clearTimeout(slot.readyTimer); slot.readyTimer = null; }
      if (peer.connected && peer.timer === null) peer.timer = setTimeout(() =>
        fail(peer, Error('Native audio connection recovery timed out.')), disconnectTimeoutMs);
    }
  }
  function start(generation = 1) {
    if (closed || signal?.aborted) return Promise.reject(stopped());
    if (!Number.isSafeInteger(generation) || generation < 1 || generation > 0x7fffffff) return Promise.reject(Error('Invalid native audio generation.'));
    if (current?.generation === generation) return current.closed ? Promise.reject(current.error ?? stopped()) : current.promise;
    if (current && generation < current.generation) return Promise.reject(Error('Stale native audio generation.'));
    retire(current);
    if (typeof exchange !== 'function' || typeof PeerConnection !== 'function' || !codecs.length)
      return Promise.reject(Error('Native RTP audio is unavailable.'));
    let pc;
    try { pc = new PeerConnection({ iceServers: [], iceTransportPolicy: 'all', bundlePolicy: 'max-bundle' }); }
    catch (cause) { return Promise.reject(cause); }
    const peer = current = { pc, generation, slots: [], abort: new AbortController(), ready: false, closed: false,
      error: null, stage: 'offer', iceStats: { iceStatsState: 'pending' } };
    const cancelled = new Promise((_, reject) => { peer.reject = reject; });
    cancelled.catch(() => {});
    // SDP completion alone does not establish ICE connectivity. Keep the same
    // deadline until the peer connects so a peer stuck checking can recover.
    peer.timer = setTimeout(() => fail(peer, Error(peer.ready ? 'Native audio connection timed out.' : 'Native audio negotiation timed out.')), timeoutMs);
    sampleIce(peer);
    if (typeof pc.getStats === 'function') peer.iceStatsTimer = setInterval(() => sampleIce(peer), 1000);
    const operation = (async () => {
      try {
        for (let index = 0; index < RTC_AUDIO_SLOTS; index++) {
          const transceiver = pc.addTransceiver('audio', { direction: 'recvonly' });
          if (typeof transceiver.setCodecPreferences !== 'function') throw Error('Native audio codec negotiation is unavailable.');
          transceiver.setCodecPreferences(codecs);
          peer.slots.push({ index, transceiver, track: null, source: null, owner: null, ended: false });
        }
        pc.ontrack = event => {
          if (current !== peer || peer.closed || event.track?.kind !== 'audio') { event.track?.stop?.(); return; }
          const slot = peer.slots.find(slot => slot.transceiver === event.transceiver);
          if (!slot || slot.track && slot.track !== event.track) {
            event.track.stop(); fail(peer, Error('Native audio receiver identity changed.')); return;
          }
          slot.track = event.track;
          event.track.addEventListener?.('ended', () => {
            if (current === peer && !peer.closed && slot.owner && !slot.ended) fail(peer, Error('Native audio track ended.'));
          }, { once: true });
          connectSlot(peer, slot);
        };
        pc.onconnectionstatechange = pc.oniceconnectionstatechange = () => transportChanged(peer);
        pc.onicegatheringstatechange = () => sampleIce(peer, true);
        await pc.setLocalDescription(await pc.createOffer());
        peer.stage = 'local-ice';
        // This peer has one-shot signaling. Keep late host interfaces in the
        // authentic offer instead of discarding them after the first candidate.
        const sdp = await gather(pc, peer.abort.signal, { waitForComplete: true });
        peer.stage = 'signaling';
        const answer = await exchange({ k: 'audio-offer', sdp, generation });
        if (closed || current !== peer || peer.closed) throw stopped();
        if (!answer || answer.generation !== generation || typeof answer.sdp !== 'string'
          || !answer.sdp.trim() || new TextEncoder().encode(answer.sdp).byteLength > 48 * 1024) throw Error('Invalid native audio answer.');
        peer.stage = 'remote-description';
        await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
        if (closed || current !== peer || peer.closed) throw stopped();
        peer.ready = true;
        peer.stage = 'transport';
        for (const slot of peer.slots) connectSlot(peer, slot);
        transportChanged(peer);
        if (peer.closed) throw peer.error ?? stopped();
      } catch (cause) { fail(peer, cause); throw cause; }
    })();
    peer.promise = Promise.race([operation, cancelled]);
    // Background negotiation is optional for fallback streams; it must not create
    // an unhandled rejection before the first native configuration arrives.
    peer.promise.catch(() => {});
    return peer.promise;
  }
  async function configure(record) {
    const config = record.config;
    if (config?.audioTransport !== RTC_AUDIO_TRANSPORT || !['string', 'number'].includes(typeof config.rtpSlot)
      || !/^[A-Za-z0-9_-]{1,32}$/.test(String(config.rtpSlot)) || !Number.isSafeInteger(config.rtcGeneration)
      || !Number.isInteger(ownerEpoch(record)) || ownerEpoch(record) < 0 || ownerEpoch(record) > 0xffffffff
      || ![1, 2].includes(record.channels)) throw Error('Invalid native audio configuration.');
    const preparing = start(config.rtcGeneration), peer = current;
    await preparing;
    if (current !== peer || peer.closed || closed) throw stopped();
    const slot = peer?.slots.find(slot => String(slot.transceiver.mid) === String(config.rtpSlot));
    if (!slot) throw Error('Native audio slot is unavailable.');
    if (peer.slots.some(other => other !== slot && other.owner && identity(other.owner) === identity(record)))
      throw Error('A native audio owner cannot occupy multiple slots.');
    // RTP carries no application epoch. Reusing a receiver could classify its old
    // jitter-buffer tail as a new source, so slots are single-owner per peer.
    if (slot.owner && identity(slot.owner) !== identity(record)) throw Error('Native audio slot reuse requires a new peer generation.');
    if (slot.owner && (slot.owner.semanticType !== (config.semanticType ?? record.type)
      || slot.owner.channels !== record.channels || slot.owner.sourceCodec !== config.codec
      || slot.owner.sourceRate !== record.rate)) throw Error('Native audio slot format or purpose changed without a new owner.');
    if (slot.ended) throw Error('An ended native audio slot cannot be revived.');
    slot.owner ??= { type: record.type, mode: record.mode, epoch: ownerEpoch(record), rtcOwnerEpoch: ownerEpoch(record), semanticType: config.semanticType ?? record.type,
      channels: record.channels, rate: 48000, sourceCodec: config.codec, sourceRate: record.rate,
      rtpSlot: String(config.rtpSlot), inputIndex: slot.index, rtcGeneration: config.rtcGeneration };
    if (typeof ready === 'function' && !slot.readyPromise) {
      slot.readyPromise = new Promise((resolve, reject) => { slot.resolveReady = resolve; slot.rejectReady = reject; });
      slot.readyPromise.catch(() => {});
    }
    node.port.postMessage({ nativeAudio: { ...slot.owner, generation: playbackGeneration, awaitGraph: typeof ready === 'function' } });
    prepareSlotDeadline(peer, slot);
    connectSlot(peer, slot);
    if (peer.closed) throw peer.error ?? stopped();
    if (slot.readyPromise) await slot.readyPromise;
    if (current !== peer || peer.closed || closed) throw peer.error ?? stopped();
    return true;
  }
  function end(record) {
    if (!current) return false;
    const generation = record.rtcGeneration ?? record.config?.rtcGeneration;
    if (generation !== undefined && generation !== current.generation) return false;
    const mid = record.rtpSlot ?? record.config?.rtpSlot;
    const slot = current.slots.find(slot => slot.owner && identity(slot.owner) === identity(record)
      && (mid === undefined || String(slot.transceiver.mid) === String(mid)));
    if (!slot || slot.ended || !Number.isInteger(record.epoch) || ((record.epoch - slot.owner.epoch) | 0) < 0) return false;
    slot.ended = true;
    node.port.postMessage({ nativeAudioEnd: { ...slot.owner, generation: playbackGeneration } });
    return true;
  }
  const close = () => { if (closed) return; closed = true; retire(current); signal?.removeEventListener('abort', close); };
  signal?.addEventListener('abort', close, { once: true });
  if (signal?.aborted) close();
  return { start, configure, end, close, fail: cause => { if (current) fail(current, cause); },
    bound(record) {
      const peer = current;
      if (!peer || peer.closed || record.generation !== playbackGeneration || record.rtcGeneration !== peer.generation) return false;
      const slot = peer.slots.find(slot => slot.owner && slot.index === record.inputIndex
        && slot.owner.rtpSlot === String(record.rtpSlot) && slot.owner.epoch === record.epoch && identity(slot.owner) === identity(record));
      if (!slot) return false;
      slot.bindingConfirmed = true; announceReady(peer, slot); return true;
    },
    active: record => Boolean(current && !current.closed && record.rtcGeneration === current.generation
      && current.slots.some(slot => slot.owner && !slot.ended && identity(slot.owner) === identity(record))),
    stats: () => {
      const live = current && !closed && !current.closed;
      return { audioTransport: RTC_AUDIO_TRANSPORT, rtcGeneration: current?.generation ?? null,
        state: closed ? 'closed' : current?.error ? 'failed' : current?.closed ? 'closed'
          : current?.ready && current?.transportReady ? 'ready' : current ? 'connecting' : 'idle',
        peerState: observedState(current?.pc.connectionState, peerStates),
        iceState: observedState(current?.pc.iceConnectionState, iceStates),
        gatheringState: observedState(current?.pc.iceGatheringState, gatheringStates),
        ...iceEvidence(current),
        tracks: live ? current.slots.filter(slot => slot.track).length : 0,
        boundSlots: live ? current.slots.filter(slot => slot.bindingConfirmed).length : 0,
        readySlots: live ? current.slots.filter(slot => slot.readySent && !slot.ended).length : 0,
        streams: live ? current.slots.filter(slot => slot.owner && !slot.ended).length : 0,
        drainUnknown: live ? current.slots.some(slot => slot.owner && slot.ended) : false };
    } };
}
