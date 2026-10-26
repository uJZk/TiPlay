/*! SPDX-License-Identifier: GPL-3.0-only
 * Reliable LAN media transport. Fragment sequencing and application consumption are distinct from SCTP delivery. */
import { candidateCounts, candidateDiagnosticFields, rtcFailureReason } from './rtc-diagnostics.js';
import { RTC_VIDEO_TRANSPORT, rtcVideoCodecs } from './rtc-video.js';
import { applyRtcVideoReceiveLevels, probeRtcVideoReceiveLevels } from './rtc-video-receive.js';

export const RTC_TRANSPORT = 'webrtc-datachannel-v1';
export const RTC_MAGIC = 0x31524454;
export const RTC_HEADER_BYTES = 24;
export const RTC_FRAGMENT_BYTES = 16 * 1024;
const LIMITS = { video: { record: 8 * 1024 * 1024 + 24, pending: 16 * 1024 * 1024 },
  audio: { record: 1024 * 1024, pending: 2 * 1024 * 1024 } };

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
      if (!sdp) { if (peer.iceGatheringState === 'complete') finish(transportError('no-local-candidates')); return; }
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


function directCandidateCounts(sdp) {
  const candidates = String(sdp).split(/\r?\n/).filter(line => /^a=candidate:.* typ host(?: |$)/i.test(line));
  return { host: candidates.length, udp: candidates.filter(line => /^a=candidate:\S+ \d+ udp /i.test(line)).length };
}

function uint32(value) { return Number.isInteger(value) && value >= 0 && value <= 0xffffffff; }
const olderSequence = (sequence, boundary) => ((sequence - boundary) | 0) < 0;

function transportError(reason, message = reason) {
  return Object.assign(new Error(message), { name: 'RtcTransportError', reason });
}

/** No STUN/TURN: every candidate must use a direct local path. Signaling uses the existing pairing gate. */
export function createRtcMediaTransport({ signal, exchange, credentials, onError = () => {},
  PeerConnection = globalThis.RTCPeerConnection, timeoutMs = 20000, onProgress = () => {},
  videoTrack = false, videoCodecs = rtcVideoCodecs(), onVideoTrack = () => {}, onVideoGeneration = () => {},
  onVideoError = () => {}, videoTimeoutMs = 12000, audioTimeoutMs = 10000,
  probeVideoReceiveLevels = probeRtcVideoReceiveLevels } = {}) {
  if (typeof PeerConnection !== 'function') throw transportError('webrtc-unavailable', 'This browser does not support WebRTC DataChannel.');
  const peer = new PeerConnection({ iceServers: [], iceTransportPolicy: 'all', bundlePolicy: 'max-bundle' });
  const channels = {};
  let remoteVideoTrack = null;
  let videoTransceiver = null, videoGeneration = 1, videoNegotiation = null, videoAnswer = null, videoRequestSequence = 0;
  try {
    for (const label of ['control', 'video', 'audio']) channels[label] = peer.createDataChannel(label, { ordered: true });
    if (videoTrack) {
      if (!videoCodecs.length || typeof peer.addTransceiver !== 'function') throw transportError('rtc-video-unavailable');
      const transceiver = videoTransceiver = peer.addTransceiver('video', { direction: 'recvonly' });
      // Do not negotiate an encoder the phone would have to transcode into.
      if (typeof transceiver.setCodecPreferences !== 'function') throw transportError('rtc-video-codecs-unavailable');
      try { transceiver.setCodecPreferences(videoCodecs); }
      catch (_) { throw transportError('rtc-video-codecs-unavailable'); }
    }
  } catch (error) { peer.close(); throw error; }
  const stats = { transport: RTC_TRANSPORT, state: 'connecting', reason: null, generation: null,
    queuedBytes: 0, highWaterBytes: 0, fragmentsReceived: 0, bytesReceived: 0,
    reassemblyErrors: 0, recordsReceived: 0, recordsConsumed: 0, audioDiscardedRecords: 0,
    controlRequests: 0, controlFailures: 0, stage: 'new', localCandidates: 0, localUdpCandidates: 0, remoteCandidates: 0, remoteUdpCandidates: 0, iceCandidateErrors: 0, iceState: peer.iceConnectionState ?? 'new', connectionState: peer.connectionState ?? 'new' };
  const requests = new Map(), lifetimeAbort = new AbortController();
  const audioEventListeners = new Set();
  // Application RPCs use their own increasing q; reserve a distant safe-integer
  // range for native-audio negotiation so both can be outstanding at once.
  let audioRequestSequence = 2 ** 40;
  let nativeAudioGeneration = 0;
  let epoch = null, closed = false, connected = false, audioEnabled = false, disconnectedTimer = null;
  let audioGeneration = 0, audioBarrier = null, audioBarrierTimer = null;
  let authenticatedHello = null, authenticatedClockSample = null, resourceToken = null;
  let timer = null, statsTimer = null, resolveReady, rejectReady, rejectLifetime;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // connect() may still be gathering when a channel fails; retain the rejection until it awaits readiness.
  ready.catch(() => {});
  const lifetime = new Promise((_, reject) => { rejectLifetime = reject; });
  lifetime.catch(() => {});
  const duringLife = pending => Promise.race([pending, lifetime]);
  let receiveLevels = null;
  async function createVideoOffer() {
    const levels = videoTrack ? await duringLife(receiveLevels ??= probeVideoReceiveLevels(videoCodecs)) : null;
    const offer = await duringLife(peer.createOffer());
    // Codec preferences must remain capabilities returned by the browser. Its
    // receive-level declaration is applied to the offer before local ICE/SRP.
    return levels ? { type: offer.type, sdp: applyRtcVideoReceiveLevels(offer.sdp, levels) } : offer;
  }
  const diagnostic = () => ({ stage: ({ 'create-offer': 'local-ice', 'local-description': 'local-ice', 'ice-gathering': 'local-ice',
    signaling: 'pairing', 'remote-description': 'remote-ice', channels: 'remote-ice', 'dc-auth': 'dc-auth', connected: 'connected' })[stats.stage] ?? 'local-ice',
    ...candidateDiagnosticFields('local', candidateCounts(peer.localDescription?.sdp)),
    ...candidateDiagnosticFields('remote', candidateCounts(peer.remoteDescription?.sdp)),
    iceState: peer.iceConnectionState ?? null, gatheringState: peer.iceGatheringState ?? null, connectionState: peer.connectionState ?? null,
    ...Object.fromEntries(Object.entries(channels).map(([name, channel]) => [name + 'ChannelState', channel.readyState])) });
  const progress = stage => { if (stage) stats.stage = stage; try { onProgress(diagnostic()); } catch (_) {} };
  function sendControl(value) {
    if (closed || channels.control.readyState !== 'open') throw transportError('control-unavailable');
    if (channels.control.bufferedAmount > 256 * 1024) throw transportError('control-overflow');
    const json = JSON.stringify(value);
    if (new TextEncoder().encode(json).byteLength > 64 * 1024) throw transportError('control-message-size');
    channels.control.send(json);
  }
  function fail(reason, message) {
    if (closed) return;
    const error = reason instanceof Error ? reason : transportError(reason, message);
    error.rtcReason ??= rtcFailureReason(error); error.rtcDiagnostic ??= diagnostic();
    stats.reason = error.reason ?? error.rtcReason; stats.state = 'failed';
    close(error);
    onError(error);
  }
  peer.ontrack = event => {
    if (!videoTrack || event.track?.kind !== 'video' || closed) { event.track?.stop?.(); return; }
    if (event.transceiver && videoTransceiver && event.transceiver !== videoTransceiver) { event.track.stop(); return; }
    if (remoteVideoTrack && remoteVideoTrack !== event.track) { event.track.stop(); onVideoError('rtc-video-track-replaced'); return; }
    remoteVideoTrack = event.track;
    // An ontrack event may precede authentication. Never render it before auth.
    if (connected && !videoNegotiation) onVideoTrack(remoteVideoTrack, videoGeneration);
  };
  function acknowledge(channel, sequence, bytes) {
    if (closed) return;
    try { sendControl({ k: 'ack', channel, q: sequence, bytes }); stats.recordsConsumed++; }
    catch (error) { fail(error); }
  }
  function makeReceiver(name) {
    const limit = LIMITS[name], queue = [];
    let nextSequence = 0, partial = null, pendingBytes = 0, consumer = null, outstanding = null;
    let consumedBytes = 0, receivedRecords = 0, receivedFragments = 0, peakRetainedBytes = 0;
    let reassemblyMsTotal = 0, reassemblyMsMax = 0, consumerWaitMsTotal = 0, consumerWaitMsMax = 0, deliveredRecords = 0;
    const account = bytes => {
      pendingBytes += bytes; stats.queuedBytes += bytes; peakRetainedBytes = Math.max(peakRetainedBytes, pendingBytes);
      stats.highWaterBytes = Math.max(stats.highWaterBytes, stats.queuedBytes);
    };
    const consume = record => {
      account(-record.size); consumedBytes += record.size;
      acknowledge(name, record.sequence, record.size);
    };
    const flush = () => {
      if (!consumer?.pulling || !queue.length || (name === 'audio' && audioBarrier === null)) return;
      consumer.pulling = false;
      outstanding = queue.shift();
      const wait = performance.now() - outstanding.completedAt; consumerWaitMsTotal += wait; consumerWaitMsMax = Math.max(consumerWaitMsMax, wait); deliveredRecords++;
      consumer.controller.enqueue(outstanding.bytes);
      consumer.resolve?.(); consumer.resolve = null;
    };
    function discardQueued() {
      if (outstanding) { consume(outstanding); outstanding = null; stats.audioDiscardedRecords++; }
      while (queue.length) { consume(queue.shift()); stats.audioDiscardedRecords++; }
      if (partial) partial.discard = true;
    }
    return {
      receive(data) {
        if (closed) return;
        try {
          if (!(data instanceof ArrayBuffer) || data.byteLength < RTC_HEADER_BYTES || data.byteLength > RTC_FRAGMENT_BYTES) throw transportError('fragment-size');
          const header = new DataView(data), size = header.getUint32(20, true), recordEpoch = header.getUint32(4, true);
          const sequence = header.getUint32(8, true), total = header.getUint32(12, true), offset = header.getUint32(16, true);
          if (header.getUint32(0, true) !== RTC_MAGIC || epoch === null || recordEpoch !== epoch) throw transportError('fragment-epoch');
          if (!size || size !== data.byteLength - RTC_HEADER_BYTES || total < 1 || total > limit.record
            || offset > total || size > total - offset || sequence !== nextSequence) throw transportError('fragment-bounds');
          if (!partial) {
            if (offset !== 0 || pendingBytes + total > limit.pending) throw transportError('receiver-overflow');
            // Most audio and small video records fit in one message. The native
            // DataChannel buffer is already ours; retain its payload view directly.
            partial = { bytes: size === total ? new Uint8Array(data, RTC_HEADER_BYTES) : new Uint8Array(total),
              size: total, sequence, received: 0, startedAt: performance.now(), discard: name === 'audio' && !audioEnabled };
            account(total);
          }
          if (partial.sequence !== sequence || partial.bytes.length !== total || partial.received !== offset) throw transportError('fragment-order');
          if (partial.bytes.buffer !== data) partial.bytes.set(new Uint8Array(data, RTC_HEADER_BYTES), offset);
          partial.received += size;
          stats.fragmentsReceived++; stats.bytesReceived += size; receivedFragments++;
          if (partial.received === total) {
            const record = partial; partial = null; nextSequence = (nextSequence + 1) >>> 0;
            stats.recordsReceived++; receivedRecords++;
            record.completedAt = performance.now(); const elapsed = record.completedAt - record.startedAt; reassemblyMsTotal += elapsed; reassemblyMsMax = Math.max(reassemblyMsMax, elapsed);
            if (record.discard || (name === 'audio' && (!audioEnabled || (audioBarrier !== null && olderSequence(record.sequence, audioBarrier))))) { consume(record); stats.audioDiscardedRecords++; }
            else { queue.push(record); flush(); }
          }
        } catch (error) { stats.reassemblyErrors++; fail(error); }
      },
      open() {
        if (consumer) throw transportError('stream-already-open');
        return new ReadableStream({
          start(controller) { consumer = { controller, pulling: false, resolve: null }; if (closed) controller.error(transportError('transport-closed')); },
          pull() {
            // The next pull proves the record reader has finished the preceding AU, including async configuration/decode admission.
            if (outstanding) { consume(outstanding); outstanding = null; }
            if (closed) return;
            consumer.pulling = true;
            const pending = new Promise(resolve => { consumer.resolve = resolve; });
            flush();
            return pending;
          },
          cancel() {
            consumer?.resolve?.(); consumer = null;
            if (name === 'video') { close(transportError('video-cancelled')); return; }
            if (name === 'audio') {
              audioEnabled = false; clearTimeout(audioBarrierTimer); stats.audioBarrierPending = false; discardQueued();
              try { sendControl({ k: 'audio-ready', enabled: false, generation: audioGeneration }); } catch (_) {}
            }
          },
        }, { highWaterMark: 0 });
      },
      stats: () => ({ retainedBytes: pendingBytes, consumedBytes, queuedRecords: queue.length, partialBytes: partial?.received ?? 0,
        receivedRecords, receivedFragments, peakRetainedBytes,
        reassemblyMsMean: receivedRecords ? reassemblyMsTotal / receivedRecords : null, reassemblyMsMax,
        consumerWaitMsMean: deliveredRecords ? consumerWaitMsTotal / deliveredRecords : null, consumerWaitMsMax }),
      barrier(sequence) {
        while (queue.length && olderSequence(queue[0].sequence, sequence)) { consume(queue.shift()); stats.audioDiscardedRecords++; }
        if (partial && olderSequence(partial.sequence, sequence)) partial.discard = true;
        flush();
      },
      stop(error) {
        consumer?.resolve?.();
        try { consumer?.controller.error(error); } catch (_) {}
        consumer = null;
        queue.length = 0; partial = outstanding = null;
        stats.queuedBytes -= pendingBytes; pendingBytes = 0;
      },
    };
  }
  const receivers = { video: makeReceiver('video'), audio: makeReceiver('audio') };
  for (const name of ['video', 'audio']) {
    channels[name].binaryType = 'arraybuffer';
    channels[name].onmessage = event => receivers[name].receive(event.data);
  }
  channels.control.onmessage = ({ data }) => {
    try {
      if (typeof data !== 'string' || data.length > 64 * 1024) throw transportError('control-format');
      let response;
      try { response = JSON.parse(data); } catch (_) { throw transportError('control-format'); }
      if (!response || typeof response !== 'object' || Array.isArray(response)) throw transportError('control-format');
      if (response.k === 'video-error') {
        if (!videoNegotiation && (response.generation ?? 1) === videoGeneration) onVideoError(typeof response.reason === 'string' ? response.reason : 'rtc-video-failed');
        return;
      }
      if (response.k === 'video-answer') {
        if (videoAnswer && response.generation === videoAnswer.generation && response.q === videoAnswer.q) videoAnswer.resolve(response);
        return;
      }
      if (response.k === 'audio-error' || response.k === 'audio-restart-required') {
        if (!connected || closed || !Number.isSafeInteger(response.generation) || response.generation < 1
          || response.generation > 0x7fffffff || (response.reason !== undefined
            && (typeof response.reason !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(response.reason)))) {
          stats.nativeAudioInvalidEvents = (stats.nativeAudioInvalidEvents ?? 0) + 1; return;
        }
        if (response.generation !== nativeAudioGeneration) {
          stats.nativeAudioStaleEvents = (stats.nativeAudioStaleEvents ?? 0) + 1; return;
        }
        const event = { k: response.k, generation: response.generation,
          ...(response.reason === undefined ? {} : { reason: response.reason }) };
        stats.nativeAudioError = event.reason ?? null;
        for (const listener of audioEventListeners) {
          try { listener(event); } catch (_) {} // One output observer cannot retire the shared peer.
        }
        return;
      }
      if (response.k === 'audio-barrier') {
        if (response.epoch !== epoch || !uint32(response.generation) || !response.generation || !uint32(response.sequence)) throw transportError('audio-barrier-format');
        if (!audioEnabled || response.generation !== audioGeneration) return;
        if (audioBarrier !== null && audioBarrier !== response.sequence) throw transportError('audio-barrier-duplicate');
        audioBarrier = response.sequence; clearTimeout(audioBarrierTimer); stats.audioBarrierPending = false;
        stats.audioGeneration = audioGeneration; stats.audioFirstSequence = audioBarrier;
        receivers.audio.barrier(audioBarrier);
        return;
      }
      if (!Number.isSafeInteger(response.q) || response.q < 0) throw transportError('control-format');
      const pending = requests.get(response.q);
      if (!pending) return;
      requests.delete(response.q); clearTimeout(pending.timer);
      if (response.error) pending.reject(Object.assign(transportError('control-rejected', response.error), { status: response.status }));
      else pending.resolve(response);
    } catch (error) { fail(error); }
  };
  const opened = () => {
    if (!closed && Object.values(channels).every(channel => channel.readyState === 'open')) {
      stats.state = 'authenticating'; progress('dc-auth'); resolveReady();
    }
  };
  for (const channel of Object.values(channels)) {
    channel.onopen = opened;
    channel.onerror = event => {
      stats.channelErrorLabel = channel.label;
      stats.channelErrorDetail = event.error?.errorDetail ?? 'unknown';
      stats.sctpCauseCode = event.error?.sctpCauseCode ?? null;
      fail('channel-error', `WebRTC ${channel.label} channel failed.`);
    };
    channel.onclose = () => {
      if (closed) return;
      stats.channelClosedLabel = channel.label;
      fail('channel-closed', `WebRTC ${channel.label} channel closed.`);
    };
  }
  peer.onicecandidateerror = event => {
    stats.iceCandidateErrors++; stats.lastIceCandidateErrorCode = event.errorCode ?? null;
  };
  peer.oniceconnectionstatechange = () => {
    stats.iceState = peer.iceConnectionState; progress();
    if (peer.iceConnectionState === 'failed') fail('ice-failed');
  };
  peer.onconnectionstatechange = () => {
    stats.connectionState = peer.connectionState; progress();
    clearTimeout(disconnectedTimer); disconnectedTimer = null;
    if (peer.connectionState === 'failed') fail('peer-failed');
    else if (peer.connectionState === 'disconnected') disconnectedTimer = setTimeout(() => fail('peer-disconnected'), 5000);
  };
  async function sampleStats() {
    if (closed || typeof peer.getStats !== 'function') return;
    try {
      const report = await peer.getStats();
      if (closed) return;
      let pair = null;
      report.forEach(value => { if (value.type === 'transport' && value.selectedCandidatePairId) pair = report.get(value.selectedCandidatePairId); });
      if (!pair) report.forEach(value => { if (value.type === 'candidate-pair' && value.nominated && value.state === 'succeeded') pair = value; });
      if (!pair) return;
      const local = report.get(pair.localCandidateId), remote = report.get(pair.remoteCandidateId);
      stats.selectedProtocol = local?.protocol ?? null;
      stats.localCandidateType = local?.candidateType ?? null; stats.remoteCandidateType = remote?.candidateType ?? null;
      stats.rttMs = Number.isFinite(pair.currentRoundTripTime) ? pair.currentRoundTripTime * 1000 : null;
      stats.availableOutgoingBitrate = pair.availableOutgoingBitrate ?? null;
      stats.rtcBytesSent = pair.bytesSent ?? null; stats.rtcBytesReceived = pair.bytesReceived ?? null;
      for (const field of ['requestsSent', 'requestsReceived', 'responsesSent', 'responsesReceived']) stats[field] = pair[field] ?? null;
      stats.iceSampledAt = performance.now();
    } catch (_) { stats.statsErrors = (stats.statsErrors ?? 0) + 1; }
  }
  function requestControl(q, payload, deadlineMs = 5000) {
    if (closed || requests.has(q) || requests.size >= 16) return Promise.reject(transportError('control-unavailable'));
    stats.controlRequests++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { requests.delete(q); stats.controlFailures++; reject(transportError('control-timeout')); }, deadlineMs);
      requests.set(q, { resolve, reject, timer });
      try { sendControl(payload); }
      catch (error) { clearTimeout(timer); requests.delete(q); stats.controlFailures++; reject(error); }
    });
  }
  function restartVideo() {
    if (videoNegotiation) return videoNegotiation;
    if (!connected || closed || !videoTrack) return Promise.reject(transportError('rtc-video-unavailable'));
    const next = videoGeneration + 1;
    const q = ++videoRequestSequence;
    if (!Number.isSafeInteger(next) || next > 0xffffffff) return Promise.reject(transportError('rtc-video-generation'));
    let deadline;
    const task = (async () => {
      remoteVideoTrack?.stop(); remoteVideoTrack = null;
      videoTransceiver?.stop();
      videoTransceiver = peer.addTransceiver('video', { direction: 'recvonly' });
      videoTransceiver.setCodecPreferences(videoCodecs);
      const offer = await createVideoOffer();
      await duringLife(peer.setLocalDescription(offer));
      const sdp = await duringLife(gatherLocalOffer(peer, lifetimeAbort.signal));
      if (new TextEncoder().encode(sdp).byteLength > 48 * 1024) throw transportError('rtc-video-offer-size');
      const response = await duringLife(new Promise((resolve, reject) => {
        videoAnswer = { generation: next, q, resolve, reject };
        deadline = setTimeout(() => reject(transportError('rtc-video-renegotiation-timeout')), videoTimeoutMs);
        try { sendControl({ k: 'video-offer', q, generation: next, sdp }); }
        catch (error) { reject(error); }
      }));
      if (closed || videoAnswer?.generation !== next) throw transportError('stopped');
      if (response.error) throw transportError('rtc-video-renegotiation-rejected');
      if (response.videoTransport !== RTC_VIDEO_TRANSPORT || typeof response.sdp !== 'string'
        || new TextEncoder().encode(response.sdp).byteLength > 48 * 1024) throw transportError('rtc-video-answer-format');
      await duringLife(peer.setRemoteDescription({ type: 'answer', sdp: response.sdp }));
      if (closed || videoAnswer?.generation !== next) throw transportError('stopped');
      await duringLife(Promise.resolve(onVideoGeneration(next)));
      videoGeneration = next; stats.videoGeneration = next;
      if (remoteVideoTrack) onVideoTrack(remoteVideoTrack, next);
      sendControl({ k: 'video-ready', generation: next });
    })();
    videoNegotiation = task.finally(() => { clearTimeout(deadline); videoAnswer = null; videoNegotiation = null; });
    return videoNegotiation;
  }
  const aborted = () => close(transportError('stopped'));
  signal?.addEventListener('abort', aborted, { once: true });
  function close(error = transportError('transport-closed')) {
    if (closed) return;
    closed = true; connected = false;
    if (stats.state !== 'failed') stats.state = 'closed';
    stats.reason ??= error.reason ?? 'transport-closed';
    clearTimeout(timer); clearTimeout(disconnectedTimer); clearTimeout(audioBarrierTimer);
    signal?.removeEventListener('abort', aborted);
    clearInterval(statsTimer);
    videoAnswer?.reject(error); videoAnswer = null;
    lifetimeAbort.abort();
    rejectReady(error); rejectLifetime(error);
    for (const pending of requests.values()) { clearTimeout(pending.timer); pending.reject(error); }
    requests.clear();
    audioEventListeners.clear();
    for (const receiver of Object.values(receivers)) receiver.stop(error);
    for (const channel of Object.values(channels)) channel.close();
    remoteVideoTrack?.stop?.(); remoteVideoTrack = null;
    peer.close();
  }
  const video = receivers.video.open();
  return {
    video,
    async connect() {
      if (signal?.aborted) { aborted(); throw transportError('stopped'); }
      timer = setTimeout(() => fail('connect-timeout'), timeoutMs);
      try {
        progress('create-offer');
        const offer = await createVideoOffer();
        progress('local-description');
        await duringLife(peer.setLocalDescription(offer));
        progress('ice-gathering');
        const localOffer = await duringLife(gatherLocalOffer(peer, lifetimeAbort.signal));
        if (closed) throw transportError('stopped');
        const local = directCandidateCounts(localOffer);
        stats.localCandidates = local.host; stats.localUdpCandidates = local.udp;
        if (!local.host) throw transportError('no-local-candidates');
        if (!local.udp) throw transportError('no-local-udp-candidates');
        progress('signaling');
        const answer = await duringLife(exchange(localOffer));
        if (!answer || answer.transport !== RTC_TRANSPORT || answer.type !== 'answer' || typeof answer.sdp !== 'string'
          || (answer.session !== undefined && answer.session !== answer.epoch) || !Number.isInteger(answer.epoch) || answer.epoch < 1 || answer.epoch > 0xffffffff || answer.fragmentBytes !== RTC_FRAGMENT_BYTES) throw transportError('answer-format');
        epoch = answer.epoch; stats.generation = epoch;
        const remote = directCandidateCounts(answer.sdp);
        stats.remoteCandidates = remote.host; stats.remoteUdpCandidates = remote.udp;
        if (!remote.host) throw transportError('no-remote-candidates');
        if (!remote.udp) throw transportError('no-remote-udp-candidates');
        progress('remote-description');
        await duringLife(peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp }));
        const maxMessageSize = peer.sctp?.maxMessageSize;
        if (Number.isFinite(maxMessageSize) && maxMessageSize > 0 && maxMessageSize < RTC_FRAGMENT_BYTES) throw transportError('unsupported-message-size');
        if (!connected) progress('channels');
        await ready;
        progress('dc-auth');
        const started = performance.timeOrigin + performance.now();
        const { code: c, session: s } = credentials();
        const hello = await duringLife(requestControl(1, { k: 'auth', q: 1, c, s }));
        if (hello.app !== 'TiPlay' || hello.protocol !== 1 || hello.transport !== RTC_TRANSPORT
          || typeof hello.audio !== 'boolean' || !Number.isFinite(hello.clockMs)
          || typeof hello.resourceToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(hello.resourceToken)) throw transportError('auth-response');
        resourceToken = hello.resourceToken;
        const { resourceToken: _, ...publicHello } = hello;
        authenticatedHello = publicHello;
        authenticatedClockSample = { serverMs: hello.clockMs, started, ended: performance.timeOrigin + performance.now() };
        connected = true; stats.state = 'connected'; progress('connected'); clearTimeout(timer);
        stats.videoTransport = hello.videoTransport ?? RTC_TRANSPORT;
        if (remoteVideoTrack) onVideoTrack(remoteVideoTrack, videoGeneration);
        statsTimer ??= setInterval(sampleStats, 2000); sampleStats();
        return this;
      } catch (error) { if (!closed) fail(error); throw error; }
    },
    openAudio() {
      if (closed || !connected) throw transportError('audio-unavailable');
      const body = receivers.audio.open();
      audioGeneration = (audioGeneration + 1) >>> 0 || 1; audioBarrier = null;
      audioEnabled = true; stats.audioBarrierPending = true;
      try {
        sendControl({ k: 'audio-ready', enabled: true, generation: audioGeneration });
        const generation = audioGeneration;
        audioBarrierTimer = setTimeout(() => {
          if (audioEnabled && audioGeneration === generation && audioBarrier === null) fail('audio-barrier-timeout');
        }, 5000);
        return body;
      }
      catch (error) { body.cancel().catch(() => {}); throw error; }
    },
    control(q, events) {
      if (!connected || closed) return Promise.reject(transportError('control-unavailable'));
      const { session: s } = credentials();
      return requestControl(q, { s, q, e: events });
    },
    async audioOffer(value = {}) {
      const { sdp, generation } = value ?? {};
      if (!connected || closed) throw transportError('audio-unavailable');
      if (typeof sdp !== 'string' || !sdp.trim() || new TextEncoder().encode(sdp).byteLength > 48 * 1024
        || !Number.isSafeInteger(generation) || generation < 1 || generation > 0x7fffffff)
        throw transportError('audio-offer-format');
      if (generation <= nativeAudioGeneration) throw transportError('audio-offer-generation');
      const q = ++audioRequestSequence;
      nativeAudioGeneration = generation;
      const response = await requestControl(q, { k: 'audio-offer', q, sdp, generation }, audioTimeoutMs);
      if (generation !== nativeAudioGeneration) throw transportError('audio-answer-stale');
      if (response.generation !== generation || typeof response.sdp !== 'string' || !response.sdp.trim()
        || new TextEncoder().encode(response.sdp).byteLength > 48 * 1024)
        throw transportError('audio-answer-format');
      return response;
    },
    audioTrackReady(value = {}) {
      if (!connected || closed) throw transportError('audio-unavailable');
      const { rtcGeneration, rtpSlot, rtcOwnerEpoch, type, mode } = value ?? {};
      if (!Number.isSafeInteger(rtcGeneration) || rtcGeneration !== nativeAudioGeneration || rtcGeneration < 1
        || typeof rtpSlot !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(rtpSlot)
        || !uint32(rtcOwnerEpoch) || !Number.isInteger(type) || type < 0 || type > 255 || type === 5
        || !['carplay', 'airplay-mirror', 'airplay-audio'].includes(mode)) throw transportError('audio-track-ready-format');
      sendControl({ k: 'audio-track-ready', rtcGeneration, rtpSlot, rtcOwnerEpoch, type, mode });
    },
    audioEvents(listener) {
      if (typeof listener !== 'function') throw new TypeError('Invalid audio event listener.');
      if (!closed) audioEventListeners.add(listener);
      return () => audioEventListeners.delete(listener);
    },
    bye() { if (connected && !closed) { const { session: s } = credentials(); return requestControl(0, { k: 'bye', q: 0, s }); } return Promise.resolve(); },
    hello: () => authenticatedHello,
    clockSample: () => authenticatedClockSample,
    resourceToken: () => resourceToken,
    videoTrack: () => remoteVideoTrack,
    restartVideo,
    close,
    isConnected: () => connected && !closed,
    stats: () => ({ ...stats, controlMessageLimitBytes: Math.min(64 * 1024, peer.sctp?.maxMessageSize || 64 * 1024),
      video: receivers.video.stats(), audio: receivers.audio.stats(), ice: {
        state: stats.selectedProtocol ? 'selected' : typeof peer.getStats === 'function' ? 'collecting' : 'unavailable',
        protocol: stats.selectedProtocol ?? null, connectionState: stats.iceState,
        localCandidateType: stats.localCandidateType ?? null, remoteCandidateType: stats.remoteCandidateType ?? null,
        currentRoundTripTimeMs: stats.rttMs ?? null, availableOutgoingBitrate: stats.availableOutgoingBitrate ?? null,
        bytesSent: stats.rtcBytesSent ?? null, bytesReceived: stats.rtcBytesReceived ?? null,
        requestsSent: stats.requestsSent ?? null, requestsReceived: stats.requestsReceived ?? null,
        responsesSent: stats.responsesSent ?? null, responsesReceived: stats.responsesReceived ?? null,
        sampleAgeMs: Number.isFinite(stats.iceSampledAt) ? Math.max(0, performance.now() - stats.iceSampledAt) : null,
        errors: stats.statsErrors ?? 0,
      } }),
  };
}
