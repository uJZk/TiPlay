/*! SPDX-License-Identifier: GPL-3.0-only */
import { RECORD, createRecordStream } from './link.js';
import { hasHdrTransfer } from './airplay-sdr.js';

export const RTC_VIDEO_TRANSPORT = 'webrtc-track-v1';

/** Discovery is only a capability hint; SRP still authenticates the complete SDP. */
export async function phoneSupportsRtcVideo(fetchPhone, signal) {
  try {
    const response = await fetchPhone('/hello', { signal });
    if (!response.ok) return false;
    const hello = await response.json();
    return hello?.app === 'TiPlay' && hello.protocol === 1 && hello.videoTransport === RTC_VIDEO_TRANSPORT;
  } catch (error) { if (signal?.aborted) throw error; return false; }
}

/** Only codecs whose original access units the phone can forward without transcoding. */
export function rtcVideoCodecs(Receiver = globalThis.RTCRtpReceiver) {
  try { return (Receiver?.getCapabilities?.('video')?.codecs || []).filter(codec => /^video\/(H264|H265|HEVC)$/i.test(codec.mimeType)); }
  catch (_) { return []; }
}

/** SDP codec availability, not proof of the hardware decoder or display timing. */
export async function probeRtcMirrorCapabilities(width, height) {
  const codecs = rtcVideoCodecs();
  return { h264: codecs.some(codec => /\/H264$/i.test(codec.mimeType)),
    hevc: codecs.some(codec => /\/(H265|HEVC)$/i.test(codec.mimeType)),
    maxWidth: Math.max(2, Math.min(1920, Math.floor(width / 2) * 2)),
    maxHeight: Math.max(2, Math.min(1080, Math.floor(height / 2) * 2)) };
}

/** RTP source metadata and browser-decoded frames; compressed video is never decoded here. */
export function createRtcVideoPipeline({ post, present, now = () => performance.now(), firstFrameWaitMs = 6000 } = {}) {
  let id = null, config = null, firstEpoch = null, failed = false, timer = null, firstFrameAt = null, decoded = 0, generation = 1, awaitingGeneration = false, lastFailure = null;
  const stats = () => ({ ...records.stats(), streamGeneration: id, epoch: config?.epoch ?? null,
    mode: config?.mode ?? null, codec: config?.codec ?? null, width: config?.width ?? null, height: config?.height ?? null,
    videoTransport: RTC_VIDEO_TRANSPORT, videoGeneration: generation, decoderImplementation: 'unknown', codecSupported: !failed,
    presentationTimingState: 'unavailable', decoded, decoderStatsSampledAtMs: performance.timeOrigin + performance.now() });
  function fail(reason = 'rtc-video-unavailable') {
    if (id === null || failed && (reason !== 'video-renegotiation-required' || lastFailure === reason)) return;
    lastFailure = reason;
    failed = true; firstFrameAt = null;
    post({ type: 'video-error', id, videoGeneration: generation, reason, codec: config?.codec, stats: stats() });
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
      if (record.kind === RECORD.IDLE) { config = null; firstFrameAt = null; post({ type: 'idle', id, videoGeneration: generation }); return; }
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
        if (firstEpoch === null) firstFrameAt = now();
        firstEpoch = record.epoch;
        config = { ...value, streamId: id, epoch: record.epoch, videoGeneration: generation };
        post({ type: 'config', id, config });
      } else if (record.kind === RECORD.FRAME) fail('rtc-video-compressed-record-rejected');
    },
    onAlive: () => post({ type: 'alive', id, videoGeneration: generation }),
    onEnd: (_id, reason) => fail(reason),
  });
  function stop() { records.stop(); clearInterval(timer); timer = null; id = config = firstEpoch = null; firstFrameAt = null; failed = false; decoded = 0; generation = 1; awaitingGeneration = false; lastFailure = null; }
  return {
    read(nextId, body) {
      stop(); id = nextId;
      timer = setInterval(() => {
        records.watchdog();
        if (!failed && firstFrameAt !== null && now() - firstFrameAt >= firstFrameWaitMs) fail('rtc-video-first-frame-timeout');
      }, 1000);
      records.read(nextId, body);
    },
    trackFrame(frame, frameGeneration = generation) {
      if (!config || failed || frameGeneration !== generation) { frame.close(); return; }
      if (config.mode === 'airplay-mirror' && hasHdrTransfer(frame.colorSpace)) { frame.close(); fail('hdr'); return; }
      firstFrameAt = null; decoded++;
      present(frame, config, id);
    },
    resetGeneration(next) {
      if (!Number.isSafeInteger(next) || next !== generation + 1) throw Error('Invalid RTP video generation.');
      generation = next; config = firstEpoch = null; failed = false; firstFrameAt = now(); awaitingGeneration = true; lastFailure = null;
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

