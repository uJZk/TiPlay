/*! SPDX-License-Identifier: GPL-3.0-only
 * Reliable LAN media transport. Fragment sequencing and application consumption are distinct from SCTP delivery. */
export const RTC_TRANSPORT = 'webrtc-datachannel-v1';
export const RTC_MAGIC = 0x31524454;
export const RTC_HEADER_BYTES = 24;
export const RTC_FRAGMENT_BYTES = 16 * 1024;
const LIMITS = { video: { record: 8 * 1024 * 1024 + 24, pending: 16 * 1024 * 1024 },
  audio: { record: 1024 * 1024, pending: 2 * 1024 * 1024 } };

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
  PeerConnection = globalThis.RTCPeerConnection, timeoutMs = 12000 } = {}) {
  if (typeof PeerConnection !== 'function') throw transportError('webrtc-unavailable', 'This browser does not support WebRTC DataChannel.');
  const peer = new PeerConnection({ iceServers: [], iceTransportPolicy: 'all' });
  const channels = {};
  try {
    for (const label of ['control', 'video', 'audio']) channels[label] = peer.createDataChannel(label, { ordered: true });
  } catch (error) { peer.close(); throw error; }
  const stats = { transport: RTC_TRANSPORT, state: 'connecting', reason: null, generation: null,
    queuedBytes: 0, highWaterBytes: 0, fragmentsReceived: 0, bytesReceived: 0,
    reassemblyErrors: 0, recordsReceived: 0, recordsConsumed: 0, audioDiscardedRecords: 0,
    controlRequests: 0, controlFailures: 0, stage: 'new', localCandidates: 0, localUdpCandidates: 0, remoteCandidates: 0, remoteUdpCandidates: 0, iceCandidateErrors: 0, iceState: peer.iceConnectionState ?? 'new', connectionState: peer.connectionState ?? 'new' };
  const requests = new Map();
  let epoch = null, closed = false, connected = false, audioEnabled = false, disconnectedTimer = null;
  let audioGeneration = 0, audioBarrier = null, audioBarrierTimer = null;
  let timer = null, statsTimer = null, resolveReady, rejectReady, rejectLifetime;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // connect() may still be gathering when a channel fails; retain the rejection until it awaits readiness.
  ready.catch(() => {});
  const lifetime = new Promise((_, reject) => { rejectLifetime = reject; });
  lifetime.catch(() => {});
  const duringLife = pending => Promise.race([pending, lifetime]);
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
    stats.reason = error.reason ?? 'transport-failed'; stats.state = 'failed';
    close(error);
    onError(error);
  }
  function acknowledge(channel, sequence, bytes) {
    if (closed) return;
    try { sendControl({ k: 'ack', channel, q: sequence, bytes }); stats.recordsConsumed++; }
    catch (error) { fail(error); }
  }
  function makeReceiver(name) {
    const limit = LIMITS[name], queue = [];
    let nextSequence = 0, partial = null, pendingBytes = 0, consumer = null, outstanding = null;
    const account = bytes => {
      pendingBytes += bytes; stats.queuedBytes += bytes;
      stats.highWaterBytes = Math.max(stats.highWaterBytes, stats.queuedBytes);
    };
    const consume = record => {
      account(-record.size);
      acknowledge(name, record.sequence, record.size);
    };
    const flush = () => {
      if (!consumer?.pulling || !queue.length || (name === 'audio' && audioBarrier === null)) return;
      consumer.pulling = false;
      outstanding = queue.shift();
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
            partial = { bytes: new Uint8Array(total), size: total, sequence, received: 0, discard: name === 'audio' && !audioEnabled };
            account(total);
          }
          if (partial.sequence !== sequence || partial.bytes.length !== total || partial.received !== offset) throw transportError('fragment-order');
          partial.bytes.set(new Uint8Array(data, RTC_HEADER_BYTES), offset);
          partial.received += size;
          stats.fragmentsReceived++; stats.bytesReceived += size;
          if (partial.received === total) {
            const record = partial; partial = null; nextSequence = (nextSequence + 1) >>> 0;
            stats.recordsReceived++;
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
      if (response.k === 'audio-barrier') {
        if (response.epoch !== epoch || !uint32(response.generation) || !response.generation || !uint32(response.sequence)) throw transportError('audio-barrier-format');
        if (!audioEnabled || response.generation !== audioGeneration) return;
        if (audioBarrier !== null && audioBarrier !== response.sequence) throw transportError('audio-barrier-duplicate');
        audioBarrier = response.sequence; clearTimeout(audioBarrierTimer); stats.audioBarrierPending = false;
        stats.audioGeneration = audioGeneration; stats.audioFirstSequence = audioBarrier;
        receivers.audio.barrier(audioBarrier);
        return;
      }
      if (!Number.isSafeInteger(response.q) || response.q < 1) throw transportError('control-format');
      const pending = requests.get(response.q);
      if (!pending) return;
      requests.delete(response.q); clearTimeout(pending.timer);
      if (response.error) pending.reject(Object.assign(transportError('control-rejected', response.error), { status: response.status }));
      else pending.resolve(response);
    } catch (error) { fail(error); }
  };
  const opened = () => {
    if (!closed && Object.values(channels).every(channel => channel.readyState === 'open')) {
      connected = true; stats.state = 'connected'; stats.stage = 'connected'; clearTimeout(timer); resolveReady();
      statsTimer ??= setInterval(sampleStats, 2000);
      sampleStats();
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
    channel.onclose = () => { if (!closed) fail('channel-closed', `WebRTC ${channel.label} channel closed.`); };
  }
  peer.onicecandidateerror = event => {
    stats.iceCandidateErrors++; stats.lastIceCandidateErrorCode = event.errorCode ?? null;
  };
  peer.oniceconnectionstatechange = () => {
    stats.iceState = peer.iceConnectionState;
    if (peer.iceConnectionState === 'failed') fail('ice-failed');
  };
  peer.onconnectionstatechange = () => {
    stats.connectionState = peer.connectionState;
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
    } catch (_) { stats.statsErrors = (stats.statsErrors ?? 0) + 1; }
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
    rejectReady(error); rejectLifetime(error);
    for (const pending of requests.values()) { clearTimeout(pending.timer); pending.reject(error); }
    requests.clear();
    for (const receiver of Object.values(receivers)) receiver.stop(error);
    for (const channel of Object.values(channels)) channel.close();
    peer.close();
  }
  const video = receivers.video.open();
  return {
    video,
    async connect() {
      if (signal?.aborted) { aborted(); throw transportError('stopped'); }
      timer = setTimeout(() => fail('connect-timeout'), timeoutMs);
      try {
        stats.stage = 'create-offer';
        const offer = await duringLife(peer.createOffer());
        stats.stage = 'local-description';
        await duringLife(peer.setLocalDescription(offer));
        stats.stage = 'ice-gathering';
        if (peer.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
          const done = () => {
            if (peer.iceGatheringState !== 'complete' && !closed) return;
            peer.removeEventListener('icegatheringstatechange', done);
            clearInterval(poll);
            if (closed) reject(transportError('connect-timeout')); else resolve();
          };
          const poll = setInterval(done, 100);
          peer.addEventListener('icegatheringstatechange', done); done();
        });
        if (closed) throw transportError('stopped');
        const local = directCandidateCounts(peer.localDescription.sdp);
        stats.localCandidates = local.host; stats.localUdpCandidates = local.udp;
        if (!local.host) throw transportError('no-local-candidates');
        if (!local.udp) throw transportError('no-local-udp-candidates');
        stats.stage = 'signaling';
        const answer = await duringLife(exchange(peer.localDescription.sdp));
        if (!answer || answer.transport !== RTC_TRANSPORT || answer.type !== 'answer' || typeof answer.sdp !== 'string'
          || !Number.isInteger(answer.epoch) || answer.epoch < 1 || answer.epoch > 0xffffffff || answer.fragmentBytes !== RTC_FRAGMENT_BYTES) throw transportError('answer-format');
        epoch = answer.epoch; stats.generation = epoch;
        const remote = directCandidateCounts(answer.sdp);
        stats.remoteCandidates = remote.host; stats.remoteUdpCandidates = remote.udp;
        if (!remote.host) throw transportError('no-remote-candidates');
        if (!remote.udp) throw transportError('no-remote-udp-candidates');
        stats.stage = 'remote-description';
        await duringLife(peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp }));
        const maxMessageSize = peer.sctp?.maxMessageSize;
        if (Number.isFinite(maxMessageSize) && maxMessageSize > 0 && maxMessageSize < RTC_FRAGMENT_BYTES) throw transportError('unsupported-message-size');
        if (!connected) stats.stage = 'channels';
        await ready;
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
      if (requests.has(q) || requests.size >= 4) return Promise.reject(transportError('control-overflow'));
      stats.controlRequests++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { requests.delete(q); stats.controlFailures++; reject(transportError('control-timeout')); }, 3000);
        requests.set(q, { resolve, reject, timer });
        try { const { code: c, session: s } = credentials(); sendControl({ c, s, q, e: events }); }
        catch (error) { clearTimeout(timer); requests.delete(q); stats.controlFailures++; reject(error); }
      });
    },
    close,
    isConnected: () => connected && !closed,
    stats: () => ({ ...stats }),
  };
}
