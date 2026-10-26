/*! SPDX-License-Identifier: GPL-3.0-only */
import { gatherLocalOffer } from './webrtc-transport.js';

export const RTC_AUDIO_TRANSPORT = 'webrtc-track-v1';
export const RTC_AUDIO_SLOTS = 16;

/** Advertise actual browser RTP decoders, excluding repair/event-only payloads. */
export function rtcAudioCodecs(Receiver = globalThis.RTCRtpReceiver) {
  try {
    return (Receiver?.getCapabilities?.('audio')?.codecs || []).filter(codec => /^audio\//i.test(codec.mimeType)
      && !/^audio\/(?:red|rtx|cn|telephone-event)$/i.test(codec.mimeType)
      && Number.isInteger(codec.clockRate) && codec.clockRate > 0);
  } catch (_) { return []; }
}

/** Audio-only RTP peer. No microphone, media element, re-encoder or application jitter buffer. */
export function createRtcAudio({ exchange, context, node, generation: playbackGeneration,
  signal, onError = () => {}, PeerConnection = globalThis.RTCPeerConnection,
  Receiver = globalThis.RTCRtpReceiver, MediaStream = globalThis.MediaStream,
  gather = gatherLocalOffer, timeoutMs = 20000, ready = null, trackTimeoutMs = 5000 } = {}) {
  let current = null, closed = false;
  const codecs = rtcAudioCodecs(Receiver);
  const ownerEpoch = record => record.rtcOwnerEpoch ?? record.config?.rtcOwnerEpoch ?? record.epoch;
  const identity = record => `${record.mode}:${record.type}:${ownerEpoch(record)}`;
  const stopped = () => new DOMException('Native audio was cancelled.', 'AbortError');
  function disconnect(slot) {
    slot.source?.disconnect(); slot.source = null;
  }
  function retire(peer) {
    if (!peer || peer.closed) return;
    peer.closed = true; peer.abort.abort(); clearTimeout(peer.timer); peer.reject(peer.error ?? stopped());
    for (const slot of peer.slots) {
      clearTimeout(slot.readyTimer); slot.rejectReady?.(peer.error ?? stopped());
      disconnect(slot); slot.track?.stop?.();
    }
    node.port.postMessage({ nativeAudioRetire: { rtcGeneration: peer.generation, generation: playbackGeneration } });
    peer.pc.close();
  }
  function fail(peer, cause) {
    if (closed || current !== peer || peer.closed) return;
    peer.error = cause; retire(peer); onError(cause);
  }
  function connectSlot(peer, slot) {
    if (!slot.track || !slot.owner || slot.source || peer.closed || !peer.ready) return;
    try {
      slot.source = context.createMediaStreamSource(new MediaStream([slot.track]));
      slot.source.connect(node, 0, slot.index);
      node.port.postMessage({ nativeAudioGraph: { ...slot.owner, generation: playbackGeneration } });
      announceReady(peer, slot);
    } catch (cause) { fail(peer, cause); }
  }
  function announceReady(peer, slot) {
    if (typeof ready !== 'function' || slot.readySent || !slot.bindingConfirmed || !slot.source || peer.closed) return;
    slot.readySent = true;
    const owner = slot.owner;
    Promise.resolve().then(() => ready({ rtcGeneration: peer.generation, rtpSlot: owner.rtpSlot,
      rtcOwnerEpoch: owner.epoch, type: owner.type, mode: owner.mode })).then(() => {
      if (current !== peer || peer.closed) return;
      clearTimeout(slot.readyTimer); slot.resolveReady();
    }, cause => fail(peer, cause));
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
    const peer = current = { pc, generation, slots: [], abort: new AbortController(), ready: false, closed: false, error: null };
    const cancelled = new Promise((_, reject) => { peer.reject = reject; });
    cancelled.catch(() => {});
    peer.timer = setTimeout(() => fail(peer, Error('Native audio negotiation timed out.')), timeoutMs);
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
        pc.onconnectionstatechange = () => {
          if (['failed', 'closed'].includes(pc.connectionState)) fail(peer, Error('Native audio connection failed.'));
        };
        await pc.setLocalDescription(await pc.createOffer());
        const sdp = await gather(pc, peer.abort.signal);
        const answer = await exchange({ k: 'audio-offer', sdp, generation });
        if (closed || current !== peer || peer.closed) throw stopped();
        if (!answer || answer.generation !== generation || typeof answer.sdp !== 'string'
          || !answer.sdp.trim() || new TextEncoder().encode(answer.sdp).byteLength > 48 * 1024) throw Error('Invalid native audio answer.');
        await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
        if (closed || current !== peer || peer.closed) throw stopped();
        peer.ready = true;
        for (const slot of peer.slots) connectSlot(peer, slot);
        if (peer.closed) throw peer.error ?? stopped();
      } catch (cause) { fail(peer, cause); throw cause; }
    })();
    peer.promise = Promise.race([operation, cancelled]).finally(() => clearTimeout(peer.timer));
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
      slot.readyTimer = setTimeout(() => fail(peer, Error('Native audio graph preparation timed out.')), trackTimeoutMs);
    }
    node.port.postMessage({ nativeAudio: { ...slot.owner, generation: playbackGeneration, awaitGraph: typeof ready === 'function' } });
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
    stats: () => ({ audioTransport: RTC_AUDIO_TRANSPORT, rtcGeneration: current?.generation ?? null,
      state: closed ? 'closed' : current?.error ? 'failed' : current?.ready ? 'ready' : 'connecting',
      streams: current?.slots.filter(slot => slot.owner && !slot.ended).length ?? 0,
      drainUnknown: current?.slots.some(slot => slot.owner && slot.ended) ?? false }) };
}
