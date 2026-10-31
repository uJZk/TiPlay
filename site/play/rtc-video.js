/*! SPDX-License-Identifier: GPL-3.0-only */
import { RECORD, createRecordStream } from './link.js';
import { hasHdrTransfer } from './airplay-sdr.js';

export const RTC_VIDEO_TRANSPORT = 'webrtc-track-v1';

/** Discovery is only a capability hint; SRP still authenticates the complete SDP. */
export async function phoneSupportsRtcVideo(fetchPhone, signal) {
  let response;
  try {
    response = await fetchPhone('/hello', { signal });
  } catch (error) {
    if (!signal?.aborted && error?.name !== 'AbortError') error.rtcReason = 'fetch';
    throw error;
  }
  if (!response.ok) throw Object.assign(new Error('Phone capability request refused.'), { status: response.status });
  let hello;
  try { hello = await response.json(); }
  catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    throw Object.assign(new Error('Invalid phone capability response.'), { rtcReason: 'bad-response' });
  }
  if (hello?.app !== 'TiPlay' || hello.protocol !== 1 ||
    (hello.videoTransport !== undefined && ![RTC_VIDEO_TRANSPORT, 'unavailable'].includes(hello.videoTransport))) {
    throw Object.assign(new Error('Invalid phone capability response.'), { rtcReason: 'bad-response' });
  }
  return hello.videoTransport === RTC_VIDEO_TRANSPORT;
}

/** Only codecs whose original access units the phone can forward without transcoding. */
export function inspectRtcVideoCodecs(Receiver = globalThis.RTCRtpReceiver) {
  if (typeof Receiver?.getCapabilities !== 'function') return { status: 'api-unavailable', codecs: [] };
  try {
    const codecs = Receiver.getCapabilities('video')?.codecs;
    if (!Array.isArray(codecs) || codecs.length === 0) return { status: 'empty', codecs: [] };
    return { status: 'available', codecs: codecs.filter(codec => /^video\/(H264|H265|HEVC)$/i.test(codec?.mimeType)) };
  } catch (_) { return { status: 'query-failed', codecs: [] }; }
}
export function rtcVideoCodecs(Receiver = globalThis.RTCRtpReceiver) { return inspectRtcVideoCodecs(Receiver).codecs; }

/** SDP codec availability, not proof of the hardware decoder or display timing. */
export async function probeRtcMirrorCapabilities(width, height, onProbe = () => {}) {
  const { status, codecs } = inspectRtcVideoCodecs();
  const result = { h264: codecs.some(codec => /\/H264$/i.test(codec.mimeType)),
    hevc: codecs.some(codec => /\/(H265|HEVC)$/i.test(codec.mimeType)),
    maxWidth: Math.max(2, Math.min(1920, Math.floor(width / 2) * 2)),
    maxHeight: Math.max(2, Math.min(1080, Math.floor(height / 2) * 2)) };
  try { onProbe({ status, h264: result.h264, hevc: result.hevc }); } catch (_) {} // Diagnostics cannot block capability reporting.
  return result;
}

/** RTP source metadata and browser-decoded frames; compressed video is never decoded here. */
export function createRtcVideoPipeline({ post, present, now = () => performance.now(), firstFrameWaitMs = 6000 } = {}) {
  let id = null, config = null, firstEpoch = null, failed = false, timer = null, firstFrameAt = null, firstPresentationAt = null, decoded = 0, generation = 1, awaitingGeneration = false, lastFailure = null;
  let pendingFrame = null, preConfigDroppedFrames = 0;
  const stats = () => ({ ...records.stats(), streamGeneration: id, epoch: config?.epoch ?? null,
    mode: config?.mode ?? null, codec: config?.codec ?? null, width: config?.width ?? null, height: config?.height ?? null,
    videoTransport: RTC_VIDEO_TRANSPORT, videoGeneration: generation, decoderImplementation: 'unknown', codecSupported: !failed,
    presentationTimingState: 'unavailable', errorReason: lastFailure, decoded, preConfigDroppedFrames,
    decoderStatsSampledAtMs: performance.timeOrigin + performance.now() });
  function discardPendingFrame() { pendingFrame?.close(); pendingFrame = null; }
  function fail(reason = 'rtc-video-unavailable') {
    if (id === null || failed && (reason !== 'video-renegotiation-required' || lastFailure === reason)) return;
    lastFailure = reason;
    failed = true; firstFrameAt = firstPresentationAt = null; discardPendingFrame();
    post({ type: 'video-error', id, videoGeneration: generation, reason, codec: config?.codec, stats: stats() });
  }
  function trackFrame(frame, frameGeneration = generation) {
    if (id === null || failed || frameGeneration !== generation) { frame.close(); return; }
    if (!config) {
      // RTP can outrun its reliable CONFIG. Retain only the latest initial picture
      // from this track generation; an idled previous source must never donate one.
      if (firstEpoch === null) { if (pendingFrame) preConfigDroppedFrames++; discardPendingFrame(); pendingFrame = frame; }
      else frame.close();
      return;
    }
    if (config.mode === 'airplay-mirror' && hasHdrTransfer(frame.colorSpace)) { frame.close(); fail('hdr'); return; }
    firstFrameAt = null; decoded++;
    present(frame, config, id);
  }
  const records = createRecordStream({
    endRecordIsTerminal: false,
    // RTP video may remain still/idle while the independent control channel proves
    // the peer alive. Metadata silence is not a reason to tear down audio.
    timeoutMs: Infinity,
    onRecord(record) {
      if (record.kind === RECORD.END) {
        if (awaitingGeneration) return;
        const reason = new TextDecoder().decode(record.payload);
        fail(/^[a-z0-9-]{1,100}$/.test(reason) ? reason : 'rtc-video-failed'); return;
      }
      if (record.kind === RECORD.IDLE) { discardPendingFrame(); config = null; firstFrameAt = firstPresentationAt = null; post({ type: 'idle', id, videoGeneration: generation }); return; }
      if (failed) return;
      if (record.kind === RECORD.CONFIG) {
        let value;
        try { value = JSON.parse(new TextDecoder().decode(record.payload)); } catch (_) { fail('rtc-video-config-invalid'); return; }
        if (!value || typeof value !== 'object' || Array.isArray(value)) { fail('rtc-video-config-invalid'); return; }
        if ((value.videoGeneration ?? 1) !== generation) return;
        awaitingGeneration = false;
        if (value.videoTransport !== RTC_VIDEO_TRANSPORT) { fail('rtc-video-required'); return; }
        if (!['carplay', 'airplay-mirror'].includes(value.mode) || typeof value.codec !== 'string'
          || !Number.isInteger(value.width) || value.width < 1 || value.width > 8192
          || !Number.isInteger(value.height) || value.height < 1 || value.height > 8192) { fail('rtc-video-config-invalid'); return; }
        if (firstEpoch !== null && (record.epoch !== firstEpoch || config?.mode !== value.mode || config?.codec !== value.codec)) {
          fail('video-source-changed-reconnect-required'); return;
        }
        if (firstEpoch === null) firstFrameAt = firstPresentationAt = now();
        firstEpoch = record.epoch;
        config = { ...value, streamId: id, epoch: record.epoch, videoGeneration: generation };
        const accepted = config, acceptedId = id, acceptedGeneration = generation, acceptedDecoded = decoded;
        let early = pendingFrame; pendingFrame = null;
        try {
          post({ type: 'config', id, config });
          // Consumers can synchronously retire this owner or present a newer frame.
          if (early && id === acceptedId && generation === acceptedGeneration && config === accepted
            && !failed && decoded === acceptedDecoded) {
            const frame = early; early = null; trackFrame(frame, acceptedGeneration);
          }
        } finally { early?.close(); }
      } else if (record.kind === RECORD.FRAME) fail('rtc-video-compressed-record-rejected');
    },
    onAlive: () => post({ type: 'alive', id, videoGeneration: generation }),
    onEnd: (_id, reason) => fail(reason),
  });
  function stop() { records.stop(); clearInterval(timer); timer = null; discardPendingFrame(); id = config = firstEpoch = null; firstFrameAt = firstPresentationAt = null; failed = false; decoded = 0; preConfigDroppedFrames = 0; generation = 1; awaitingGeneration = false; lastFailure = null; }
  return {
    read(nextId, body) {
      stop(); id = nextId;
      timer = setInterval(() => {
        records.watchdog();
        if (!failed && firstFrameAt !== null && now() - firstFrameAt >= firstFrameWaitMs) fail('rtc-video-first-frame-timeout');
        else if (!failed && firstPresentationAt !== null && now() - firstPresentationAt >= firstFrameWaitMs) fail('rtc-video-first-presentation-timeout');
      }, 1000);
      records.read(nextId, body);
    },
    trackFrame,
    presented(value) {
      if (failed || !config || value?.streamId !== id || value.epoch !== config.epoch || value.videoGeneration !== generation) return false;
      firstPresentationAt = null;
      return true;
    },
    resetGeneration(next) {
      if (!Number.isSafeInteger(next) || next !== generation + 1) throw Error('Invalid RTP video generation.');
      discardPendingFrame();
      generation = next; config = firstEpoch = null; failed = false; preConfigDroppedFrames = 0; firstFrameAt = firstPresentationAt = now(); awaitingGeneration = true; lastFailure = null;
    },
    usesTrack: () => Boolean(config && !failed), fail, stop, stats,
  };
}

/** Consume browser-decoded frames, never a video element or an application video decoder. */
export function createRtcTrackReader({ present, onError = () => {}, Processor = globalThis.MediaStreamTrackProcessor } = {}) {
  let current = null, closed = false;
  function stop() {
    const previous = current; current = null;
    if (!previous) return;
    previous.track.removeEventListener?.('ended', previous.ended);
    previous.reader.cancel().catch(() => {});
  }
  return {
    async read(track) {
      stop();
      if (closed) return;
      if (!track || track.kind !== 'video' || typeof Processor !== 'function') throw Error('Video track processing is unavailable.');
      const processor = new Processor({ track, maxBufferSize: 1 });
      const reader = processor.readable.getReader();
      const mine = current = { track, reader, ended: () => { if (current === mine) { stop(); onError(Error('Video track ended.')); } } };
      track.addEventListener?.('ended', mine.ended, { once: true });
      try {
        while (current === mine) {
          const { value: frame, done } = await reader.read();
          if (done) { if (current === mine) { stop(); onError(Error('Video track ended.')); } break; }
          if (current !== mine) { frame.close(); break; }
          // Ownership passes to the renderer (or bounded cross-thread delivery).
          present(frame);
        }
      } catch (error) { if (current === mine) { stop(); onError(error); } }
      finally { reader.releaseLock(); }
    },
    stop,
    close() { stop(); closed = true; },
  };
}

