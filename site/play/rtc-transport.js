/*! SPDX-License-Identifier: GPL-3.0-only
 * Reliable local WebRTC transport. Media remains application data for WebCodecs/AudioWorklet. */
import { candidateCounts, candidateDiagnosticFields, rtcFailureReason } from './rtc-diagnostics.js';

export const RTC_FRAGMENT_BYTES = 16384;
export const RTC_HEADER_BYTES = 24;
export const RTC_MAGIC = 0x31435254;
export const RTC_VIDEO_CREDIT = 10 * 1024 * 1024;
export const RTC_AUDIO_CREDIT = 1024 * 1024;

/** One ordered channel has at most one partial record. A violation retires the peer; bytes are never skipped. */
export function createRtcRecordStream({ session, channel, credit, maxRecordBytes, acknowledge, fail }) {
  let controller, partial = null, expected = 1, retained = 0, consumed = 0, closed = false;
  let receivedRecords = 0, receivedFragments = 0, peakRetainedBytes = 0;
  let reassemblyMsTotal = 0, reassemblyMsMax = 0, consumerWaitMsTotal = 0, consumerWaitMsMax = 0, deliveredRecords = 0;
  const now = () => performance.now();
  const queue = [];
  let waiting = false;
  const deliver = () => {
    if (!waiting || !queue.length || closed) return;
    waiting = false;
    const record = queue.shift();
    const wait = now() - record.completedAt;
    consumerWaitMsTotal += wait; consumerWaitMsMax = Math.max(consumerWaitMsMax, wait); deliveredRecords++;
    retained -= record.bytes.byteLength;
    consumed += record.bytes.byteLength;
    controller.enqueue(record.bytes);
    acknowledge({ type: 'rtc-ack', channel, consumed });
  };
  const stream = new ReadableStream({
    start(value) { controller = value; },
    pull() { waiting = true; deliver(); },
    cancel() { if (!closed) fail(new Error(`${channel} consumer stopped`)); },
  }, { highWaterMark: 0 });
  return {
    stream,
    push(input) {
      if (closed) return;
      try {
        const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
        if (bytes.byteLength < RTC_HEADER_BYTES || bytes.byteLength > RTC_FRAGMENT_BYTES) throw new Error('invalid RTC fragment size');
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const recordId = view.getUint32(8, true), total = view.getUint32(12, true);
        const offset = view.getUint32(16, true), length = view.getUint32(20, true);
        if (view.getUint32(0, true) !== RTC_MAGIC || view.getUint32(4, true) !== session || recordId !== expected ||
            !total || total > maxRecordBytes || !length || length !== bytes.byteLength - RTC_HEADER_BYTES || offset + length > total) {
          throw new Error('invalid RTC fragment identity or bounds');
        }
        if (!partial) {
          if (offset !== 0 || retained + total > credit) throw new Error(`${channel} RTC credit exceeded`);
          partial = { recordId, bytes: new Uint8Array(total), offset: 0, startedAt: now() };
          retained += total; peakRetainedBytes = Math.max(peakRetainedBytes, retained);
        }
        if (partial.bytes.length !== total || partial.offset !== offset) throw new Error('noncontiguous RTC record');
        partial.bytes.set(bytes.subarray(RTC_HEADER_BYTES), offset);
        partial.offset += length; receivedFragments++;
        if (partial.offset === total) {
          const completedAt = now(), elapsed = completedAt - partial.startedAt;
          reassemblyMsTotal += elapsed; reassemblyMsMax = Math.max(reassemblyMsMax, elapsed); receivedRecords++;
          queue.push({ bytes: partial.bytes, completedAt }); partial = null; expected++;
          if (expected > 0xffffffff) throw new Error('RTC sequence exhausted');
          deliver();
        }
      } catch (error) { fail(error); }
    },
    close(error) {
      if (closed) return;
      closed = true; partial = null; queue.length = 0; retained = 0;
      if (error) controller.error(error); else controller.close();
    },
    stats: () => ({ retainedBytes: retained, consumedBytes: consumed, queuedRecords: queue.length, partialBytes: partial?.offset ?? 0,
      receivedRecords, receivedFragments, peakRetainedBytes,
      reassemblyMsMean: receivedRecords ? reassemblyMsTotal / receivedRecords : null, reassemblyMsMax,
      consumerWaitMsMean: deliveredRecords ? consumerWaitMsTotal / deliveredRecords : null, consumerWaitMsMax }),
  };
}

function waitFor(target, event, ready, signal, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = error => {
      clearTimeout(timer); target.removeEventListener(event, changed); signal?.removeEventListener('abort', aborted);
      error ? reject(error) : resolve();
    };
    const changed = () => { if (ready()) finish(); };
    const aborted = () => finish(new Error('RTC connection stopped'));
    if (signal?.aborted) { aborted(); return; }
    target.addEventListener(event, changed); signal?.addEventListener('abort', aborted, { once: true });
    timer = setTimeout(() => finish(new Error('RTC connection timed out')), timeoutMs);
    changed();
  });
}

/** Non-trickle host-only ICE uses an authentic current SDP snapshot after a bounded candidate window.
 * Some browsers keep gathering indefinitely even after usable host candidates exist. */
export function gatherLocalOffer(peer, signal) {
  return new Promise((resolve, reject) => {
    let deadline = null, candidateWindow = null, settled = false;
    const finish = (error, sdp) => {
      if (settled) return;
      settled = true; clearTimeout(deadline); clearTimeout(candidateWindow);
      peer.removeEventListener('icecandidate', changed);
      peer.removeEventListener('icegatheringstatechange', changed);
      signal?.removeEventListener('abort', aborted);
      error ? reject(error) : resolve(sdp);
    };
    const snapshot = () => {
      const sdp = peer.localDescription?.sdp;
      return typeof sdp === 'string' && candidateCounts(sdp).total > 0 ? sdp : null;
    };
    const changed = () => {
      const sdp = snapshot();
      if (!sdp) return;
      if (peer.iceGatheringState === 'complete') { finish(null, sdp); return; }
      if (candidateWindow === null) candidateWindow = setTimeout(() => {
        const current = snapshot();
        if (current) finish(null, current);
      }, 500);
    };
    const aborted = () => finish(new Error('RTC connection stopped'));
    if (signal?.aborted) { aborted(); return; }
    peer.addEventListener('icecandidate', changed);
    peer.addEventListener('icegatheringstatechange', changed);
    signal?.addEventListener('abort', aborted, { once: true });
    deadline = setTimeout(() => {
      const current = snapshot();
      if (current) finish(null, current);
      else finish(new Error('RTC local ICE candidate collection timed out'));
    }, 12000);
    changed();
  });
}

/** The PAKE exchange authenticates the complete SDP transcript before applying the answer. */
export async function connectRtc({ fetchPhone, session, code, codecs, signal, authenticateOffer,
  PeerConnection = globalThis.RTCPeerConnection, onClose = () => {}, onProgress = () => {} }) {
  if (!PeerConnection) throw new Error('WebRTC DataChannel is unavailable');
  if (typeof authenticateOffer !== 'function') throw new Error('Authenticated RTC pairing is required');
  const peer = new PeerConnection({ iceServers: [], iceTransportPolicy: 'all', bundlePolicy: 'max-bundle' });
  let stage = 'local-ice', remoteCounts = candidateCounts(), terminalCause = null;
  const diagnostic = () => {
    const local = candidateCounts(peer.localDescription?.sdp);
    return { stage, ...candidateDiagnosticFields('local', local), ...candidateDiagnosticFields('remote', remoteCounts),
      iceState: peer.iceConnectionState ?? null, gatheringState: peer.iceGatheringState ?? null,
      connectionState: peer.connectionState ?? null,
      videoChannelState: channels.video?.readyState ?? 'unavailable', audioChannelState: channels.audio?.readyState ?? 'unavailable',
      controlChannelState: channels.control?.readyState ?? 'unavailable' };
  };
  const progress = next => {
    if (next) stage = next;
    try { onProgress(diagnostic()); } catch (_) { /* A status observer cannot interrupt authentication. */ }
  };
  const annotate = error => {
    error.rtcReason = rtcFailureReason(error);
    error.rtcDiagnostic = diagnostic();
    return error;
  };
  const channels = {};
  const pending = new Map();
  let nextId = 0, ended = false, authenticated = false, streams = null, handshakeTimer = null;
  let iceTimer = null, iceBusy = false, iceSampledAt = null, iceErrors = 0;
  let ice = { state: typeof peer.getStats === 'function' ? 'collecting' : 'unavailable' };
  const nonnegative = value => Number.isFinite(value) && value >= 0 ? value : null;
  // Only cache the selected path's aggregate properties. Addresses, candidate IDs and SDP stay out of diagnostics.
  const sampleIce = async () => {
    if (ended || iceBusy || typeof peer.getStats !== 'function') return;
    iceBusy = true;
    try {
      const report = await peer.getStats();
      if (ended) return;
      let selectedId = null, nominated = null;
      report.forEach(value => {
        if (value.type === 'transport' && value.selectedCandidatePairId) selectedId = value.selectedCandidatePairId;
        if (value.type === 'candidate-pair' && value.state === 'succeeded' && (value.nominated || value.selected) &&
            (!nominated || value.timestamp > nominated.timestamp)) nominated = value;
      });
      const selected = (selectedId ? report.get(selectedId) : null) ?? nominated;
      if (!selected || selected.type !== 'candidate-pair') ice = { state: 'no-selected-pair' };
      else {
        const local = report.get(selected.localCandidateId), remote = report.get(selected.remoteCandidateId);
        const candidateType = candidate => ['host', 'srflx', 'prflx', 'relay'].includes(candidate?.candidateType) ? candidate.candidateType : null;
        const protocol = ['udp', 'tcp'].includes(local?.protocol) ? local.protocol : ['udp', 'tcp'].includes(remote?.protocol) ? remote.protocol : null;
        ice = {
          state: 'selected', localCandidateType: candidateType(local), remoteCandidateType: candidateType(remote), protocol,
          currentRoundTripTimeMs: nonnegative(selected.currentRoundTripTime) === null ? null : selected.currentRoundTripTime * 1000,
          availableOutgoingBitrate: nonnegative(selected.availableOutgoingBitrate),
          requestsSent: nonnegative(selected.requestsSent), requestsReceived: nonnegative(selected.requestsReceived),
          responsesSent: nonnegative(selected.responsesSent), responsesReceived: nonnegative(selected.responsesReceived),
          bytesSent: nonnegative(selected.bytesSent), bytesReceived: nonnegative(selected.bytesReceived),
        };
      }
      iceSampledAt = performance.now();
    } catch (_) { if (!ended) iceErrors++; }
    finally { iceBusy = false; }
  };
  const controller = new AbortController();
  const close = (cause = new Error('RTC connection stopped')) => {
    if (ended) return;
    terminalCause = annotate(cause);
    ended = true; clearTimeout(handshakeTimer); clearInterval(iceTimer); controller.abort(); signal?.removeEventListener('abort', abort);
    for (const value of pending.values()) { clearTimeout(value.timer); value.reject(terminalCause); }
    pending.clear();
    streams?.video.close(terminalCause); streams?.audio.close(terminalCause);
    for (const channel of Object.values(channels)) { channel.onmessage = null; channel.close(); }
    peer.close();
    if (authenticated) onClose(terminalCause);
  };
  handshakeTimer = setTimeout(() => close(new Error('RTC connection timed out')), 20000);
  const abort = () => close();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) close();
  const send = message => {
    const channel = channels.control;
    if (ended || channel?.readyState !== 'open') throw new Error('RTC control channel is closed');
    if (channel.bufferedAmount > 256 * 1024) throw new Error('RTC control queue exceeded');
    channel.send(JSON.stringify(message));
  };
  const request = (type, data = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RTC ${type} timed out`)); close(new Error('RTC control timeout')); }, 5000);
    pending.set(id, { resolve, reject, timer });
    try { send({ ...data, type, id }); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
  peer.addEventListener('icecandidate', () => { if (!ended) progress(); });
  peer.addEventListener('icegatheringstatechange', () => { if (!ended) progress(); });
  peer.addEventListener('iceconnectionstatechange', () => { if (!ended) progress(); });
  peer.addEventListener('connectionstatechange', () => {
    if (!ended) progress();
    if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) close(new Error(`RTC ${peer.connectionState}`));
  });
  try {
    progress('local-ice');
    for (const label of ['video', 'audio', 'control']) {
      const channel = channels[label] = peer.createDataChannel(label, { ordered: true });
      channel.binaryType = 'arraybuffer';
      channel.addEventListener('open', () => { if (!ended) progress(); });
      channel.addEventListener('close', () => close(new Error(`RTC ${label} channel closed`)));
      channel.addEventListener('error', () => close(new Error(`RTC ${label} channel error`)));
      channel.onmessage = ({ data }) => {
        try {
          if (label !== 'control') {
            if (!authenticated || !streams || !(data instanceof ArrayBuffer)) throw new Error('Unexpected RTC media');
            streams[label].push(data); return;
          }
          if (typeof data !== 'string' || data.length > 256 * 1024) throw new Error('Invalid RTC control message');
          const reply = JSON.parse(data), entry = pending.get(reply.id);
          if (!entry) return;
          pending.delete(reply.id); clearTimeout(entry.timer);
          if (reply.ok === false || reply.error) entry.reject(Object.assign(new Error(reply.error || 'RTC request failed'), { status: reply.status }));
          else entry.resolve(reply.result ?? reply);
        } catch (error) { close(error); }
      };
    }
    await peer.setLocalDescription(await peer.createOffer());
    const offer = await gatherLocalOffer(peer, controller.signal);
    progress('pairing');
    const answer = await authenticateOffer({ fetchPhone, session, code, offer, signal: controller.signal });
    const sdp = answer.sdp;
    if (typeof sdp !== 'string') throw new Error('Invalid RTC answer');
    if (ended) throw terminalCause ?? new Error('RTC connection stopped');
    remoteCounts = candidateCounts(sdp); progress('remote-ice');
    await peer.setRemoteDescription({ type: 'answer', sdp });
    await Promise.all(Object.values(channels).map(channel => waitFor(channel, 'open', () => channel.readyState === 'open', controller.signal)));
    progress('dc-auth');
    const hello = await request('auth', { c: code, s: session, codecs, timing: 1, lifecycle: 1 });
    if (ended) throw new Error('RTC connection stopped');
    const identity = answer.session ?? hello.session;
    if (!Number.isInteger(identity) || identity <= 0 || identity > 0xffffffff) throw new Error('Invalid RTC session identity');
    streams = {
      video: createRtcRecordStream({ session: identity, channel: 'video', credit: RTC_VIDEO_CREDIT, maxRecordBytes: 8 * 1024 * 1024 + 24, acknowledge: send, fail: close }),
      audio: createRtcRecordStream({ session: identity, channel: 'audio', credit: RTC_AUDIO_CREDIT, maxRecordBytes: RTC_AUDIO_CREDIT, acknowledge: send, fail: close }),
    };
    authenticated = true; clearTimeout(handshakeTimer); progress('connected');
    send({ type: 'rtc-ready', session: identity, videoCredit: RTC_VIDEO_CREDIT, audioCredit: RTC_AUDIO_CREDIT, maxMessageSize: Math.min(RTC_FRAGMENT_BYTES, peer.sctp?.maxMessageSize || RTC_FRAGMENT_BYTES) });
    if (typeof peer.getStats === 'function') { sampleIce(); iceTimer = setInterval(sampleIce, 2500); }
    return {
      hello, video: streams.video.stream, audio: streams.audio.stream,
      control: (q, e) => request('control', { q, e }), clock: () => request('clock'),
      bye() { try { send({ id: ++nextId, type: 'bye' }); } finally { close(); } },
      close,
      stats: () => ({ state: peer.connectionState, ice: { ...ice, connectionState: peer.iceConnectionState ?? null,
        sampleAgeMs: iceSampledAt === null ? null : Math.max(0, performance.now() - iceSampledAt), errors: iceErrors }, video: streams.video.stats(), audio: streams.audio.stats(), bufferedControlBytes: channels.control.bufferedAmount }),
    };
  } catch (error) {
    const failure = terminalCause ?? annotate(error);
    close(failure); throw failure;
  }
}

/** Mute/autoplay suspension retires a playback subscription, not the encrypted transport.
 * Only codec/reset metadata is replayed; disabled playback discards are counted explicitly. */
export function createRtcAudioSource(body) {
  let subscription = null, ended = false, failure = null, discardedBytes = 0, wake = null;
  const metadata = new Map();
  const reader = body.getReader();
  const settle = () => { wake?.(); wake = null; };
  const pumping = (async () => {
    try {
      for (;;) {
        while (subscription && !subscription.waiting && !ended) await new Promise(resolve => { wake = resolve; });
        if (ended) break;
        const next = await reader.read();
        if (next.done) break;
        const bytes = next.value;
        // A read begun during inactive playback may finish after a subscriber attaches.
        // Its cached configuration must drain before this new record can use pull credit.
        while (subscription && !subscription.waiting && !ended) await new Promise(resolve => { wake = resolve; });
        if (ended) break;
        if (bytes.length >= 28) {
          const kind = bytes[4], type = bytes[5], flags = bytes[7];
          if (kind === 6 || (kind === 2 && (flags & 2) && bytes.length === 28)) {
            if (bytes.length > 16 * 1024 + 4 || type > 255) throw new Error('Invalid RTC audio metadata');
            metadata.set(type, bytes);
          }
        }
        if (subscription) {
          subscription.waiting = false;
          subscription.controller.enqueue(bytes);
        } else discardedBytes += bytes.byteLength;
      }
    } catch (error) { failure = error; }
    finally {
      ended = true;
      if (subscription) { failure ? subscription.controller.error(failure) : subscription.controller.close(); subscription = null; }
      reader.releaseLock();
    }
  })();
  return {
    open(signal) {
      if (subscription) throw new Error('RTC audio already has a playback consumer');
      const cached = [...metadata.values()];
      const next = { controller: null, waiting: false };
      const detach = () => {
        signal?.removeEventListener('abort', abort);
        if (subscription === next) { subscription = null; settle(); }
      };
      const abort = () => { detach(); next.controller?.error(new Error('RTC audio playback stopped')); };
      return new ReadableStream({
        start(controller) {
          next.controller = controller;
          if (ended) { failure ? controller.error(failure) : controller.close(); return; }
          subscription = next;
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
        },
        pull(controller) {
          if (cached.length) { controller.enqueue(cached.shift()); return; }
          if (subscription === next) { next.waiting = true; settle(); }
        },
        cancel: detach,
      }, { highWaterMark: 0 });
    },
    close() { ended = true; settle(); reader.cancel().catch(() => {}); return pumping; },
    stats: () => ({ playbackDiscardedBytes: discardedBytes, subscribed: subscription !== null }),
  };
}
