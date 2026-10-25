// SPDX-License-Identifier: GPL-3.0-only
import { createSoftwareEldDecoder } from './aac-eld-software.js';
import { pcmStats, measurePcm } from './audio-pcm-stats.js';
import { audioSignalKernel, loadAudioCore } from './wasm/audio-core.js';
const CODECS = { 'aac-lc': 'mp4a.40.2', 'aac-eld': 'mp4a.40.39', alac: 'alac', opus: 'opus' };
const unsupported = codec => new DOMException(`This browser cannot decode AirPlay ${codec.toUpperCase()} audio.`, 'NotSupportedError');
const byteArray = values => {
  if (!Array.isArray(values) || values.length < 1 || values.length > 256 || values.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return Uint8Array.from(values);
};
const nativeLittleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
/** Capability reports and actual playback must test the same WebCodecs configuration. */
export function airPlayAudioDecoderConfig(config) {
  const description = config.codec === 'alac' ? byteArray(config.cookie)
    : config.codec === 'opus' ? byteArray(config.cookie) || byteArray(config.asc) : byteArray(config.asc);
  if (!description && config.codec !== 'opus') throw new Error('AirPlay audio codec configuration is missing.');
  return { codec: CODECS[config.codec], sampleRate: config.sampleRate, numberOfChannels: config.channels, ...(description ? { description } : {}) };
}
function rawAacPacket(payload) {
  const bytes = new Uint8Array(payload);
  if (bytes.length >= 7 && bytes[0] === 255 && (bytes[1] & 246) === 240 && ((bytes[2] >> 2) & 15) < 13) {
    const size = (bytes[3] & 3) << 11 | bytes[4] << 3 | bytes[5] >> 5;
    const header = bytes[1] & 1 ? 7 : 9;
    if (size === bytes.length && size > header) return bytes.subarray(header);
  }
  return payload;
}
function mirrorNoData(record, config) {
  if (record.mode !== 'airplay-mirror' || !['aac-lc', 'aac-eld'].includes(config.codec) || record.payload.byteLength !== 4) return false;
  const bytes = new Uint8Array(record.payload);
  return bytes[0] === 0 && bytes[1] === 0x68 && bytes[2] === 0x34 && bytes[3] === 0;
}
function mirrorAacFrames(mode, config) {
  if (mode !== 'airplay-mirror') return 0;
  return (config.codec === 'aac-eld' ? [480, 512] : config.codec === 'aac-lc' ? [960, 1024] : [])
    .includes(config.samplesPerFrame) ? config.samplesPerFrame : 0;
}

export function decodePcmPacket(payload, { bitDepth, channels, littleEndian = false }) {
  const bytes = new Uint8Array(payload), width = bitDepth / 8;
  if (![16, 24].includes(bitDepth) || ![1, 2].includes(channels) || bytes.length % (width * channels)) throw new Error('Invalid AirPlay PCM packet.');
  // The common little-endian PCM16 packet already has the destination layout.
  if (width === 2 && littleEndian === nativeLittleEndian) return bytes.buffer;
  if (bytes.length / width >= 512) return audioSignalKernel().unpack(bytes, width, littleEndian);
  // Very small packets cost more to copy across a WASM boundary than to unpack.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), output = new Int16Array(bytes.length / width);
  for (let sample = 0, offset = 0; sample < output.length; sample++, offset += width) {
    if (width === 2) output[sample] = view.getInt16(offset, littleEndian);
    else {
      const value = littleEndian ? bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16
        : bytes[offset] << 16 | bytes[offset + 1] << 8 | bytes[offset + 2];
      output[sample] = (value << 8) >> 16;
    }
  }
  return output.buffer;
}

function copyDecodedPcm(session, data, pcm) {
  if (!session.unsupportedPcmCopies?.has(data.format)) {
    try { data.copyTo(pcm, { planeIndex: 0, format: 's16' }); return; }
    catch (cause) {
      // Only f32-planar conversion is required by WebCodecs. Keep failures such
      // as invalid output or allocation errors visible rather than masking them.
      if (cause.name !== 'NotSupportedError') throw cause;
      (session.unsupportedPcmCopies ??= new Set()).add(data.format);
    }
  }
  if (pcm.length >= 512) { audioSignalKernel().quantize(data, pcm); return; }
  const plane = new Float32Array(data.numberOfFrames);
  for (let channel = 0; channel < data.numberOfChannels; channel++) {
    data.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
    for (let sample = 0; sample < data.numberOfFrames; sample++)
      pcm[sample * data.numberOfChannels + channel] = Math.max(-32768, Math.min(32767, Math.round(plane[sample] * 32768)));
  }
}

/** Independent AAC/Opus/ALAC/PCM stream decoders share the browser output clock and retain their own epochs. */
export function createAirPlayAudioDecoder({ onPcm, onError = () => {}, onEvidence = () => {},
  AudioDecoder = globalThis.AudioDecoder, EncodedAudioChunk = globalThis.EncodedAudioChunk, probeTimeout = 1000,
  softwareEldFactory = createSoftwareEldDecoder, drainTimeout = 2000 } = {}) {
  const sessions = new Map();
  let disposed = false, diagnostics = null;
  function publish(record, noDataFrames = 0) {
    if (diagnostics && record.pcm.byteLength) {
      const stream = diagnostics['stream' + record.type] ??= pcmStats();
      Object.assign(stream, { epoch: record.epoch, rate: record.rate, channels: record.channels });
      measurePcm(diagnostics, record.pcm, record.channels, stream);
      if (noDataFrames) for (const stats of [diagnostics, stream]) {
        stats.noDataPackets = (stats.noDataPackets ?? 0) + 1;
        stats.noDataFrames = (stats.noDataFrames ?? 0) + noDataFrames;
      }
    }
    onPcm(record);
  }
  function backend(session, value) {
    if (diagnostics) Object.assign(diagnostics['stream' + session.type] ??= pcmStats(),
      { backend: value, epoch: session.epoch, rate: session.config.sampleRate, channels: session.config.channels, semanticType: session.semanticType });
  }
  const live = session => !disposed && sessions.get(session.type) === session && !session.closed;
  const notify = session => { for (const resolve of session.waiters) resolve(); session.waiters.clear(); };
  // Retiring an epoch must settle queued callers even if software output stalls.
  function pending(session, task) {
    if (!live(session)) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (failed, value) => {
        if (settled) return;
        settled = true; session.pending.delete(cancel);
        if (failed) reject(value); else resolve(value);
      };
      const cancel = () => finish(false, false);
      session.pending.add(cancel);
      Promise.resolve(task).then(value => finish(false, value), cause => finish(true, cause));
    });
  }
  function close(session) {
    if (!session || session.closed) return;
    session.closed = true;
    clearTimeout(session.outputTimer); session.outputTimer = null;
    session.sourceSpans.length = 0; session.sourceQueuedFrames = 0; session.silentSpans = 0;
    for (const cancel of session.pending) cancel(); session.pending.clear();
    if (session.decoder && session.decoder.state !== 'closed') session.decoder.close();
    session.software?.close(); session.software = null;
    session.decoder = null; session.anchors.length = 0; notify(session);
  }
  function reset(type) {
    if (type === undefined) { for (const session of sessions.values()) close(session); sessions.clear(); }
    else { close(sessions.get(type)); sessions.delete(type); }
  }
  function failure(session, cause) {
    if (!live(session)) return;
    if (diagnostics) { diagnostics.errors++; onEvidence('decoder-error', { type: session.type, epoch: session.epoch }); }
    close(session); onError(cause);
  }
  function recordFor(session, fields) {
    return { type: session.type, mode: session.mode, epoch: session.epoch, sequence: session.sequence,
      semanticType: session.semanticType,
      flags: session.flags & ~2, rate: session.config.sampleRate, channels: session.config.channels, ...fields };
  }
  function sourceWait(session) {
    if (!session.silentSpans) { clearTimeout(session.outputTimer); session.outputTimer = null; }
    // Match the software ELD packet-failure bound; this is not a playback watermark.
    else if (session.outputTimer === null) session.outputTimer = setTimeout(() => {
      session.outputTimer = null; failure(session, new Error('AirPlay audio decoder output timed out.'));
    }, drainTimeout);
  }
  function sourceSilence(session) {
    while (live(session) && session.sourceSpans[0]?.silent) {
      const span = session.sourceSpans.shift();
      session.silentSpans--; session.sourceQueuedFrames -= span.frames;
      publish(recordFor(session, { pcm: new Int16Array(span.frames * session.config.channels).buffer,
        presentationMs: span.presentationMs, decodeTimestampUs: span.timestamp,
        flags: span.flags & ~2, sequence: session.outputSequence++ >>> 0 }), span.frames);
      notify(session);
    }
    sourceWait(session);
  }
  function sourceSpan(session, record, silent) {
    // Bound source metadata by the fault wait plus the existing 32-chunk input queue.
    const frames = session.sourceFrames, limit = session.config.sampleRate * drainTimeout / 1000 + 32 * frames;
    if (session.sourceQueuedFrames + frames > limit) throw new Error('AirPlay audio decoder output backlog exceeds the memory limit.');
    session.sourceSpans.push({ timestamp: record.decodeTimestampUs, presentationMs: record.presentationMs,
      flags: record.flags, frames, used: 0, silent });
    session.sourceQueuedFrames += frames;
    if (silent) { session.silentSpans++; sourceSilence(session); }
  }
  function sourceOutput(session, pcm, rate) {
    const channels = session.config.channels, frames = pcm.length / channels, frameUs = 1e6 / rate;
    for (let offset = 0; offset < frames;) {
      sourceSilence(session);
      const span = session.sourceSpans[0];
      if (!span || span.silent) throw new Error('AirPlay decoded audio exceeds its submitted source samples.');
      const count = Math.min(frames - offset, span.frames - span.used);
      // Some native codecs clamp a negative initial timestamp and then count only
      // decoded frames, ignoring input gaps. RTP source spans remain authoritative.
      const decodeTimestampUs = span.timestamp + span.used * frameUs;
      const presentationMs = Number.isFinite(span.presentationMs) ? span.presentationMs + (decodeTimestampUs - span.timestamp) / 1000 : NaN;
      const buffer = offset === 0 && count === frames ? pcm.buffer : pcm.slice(offset * channels, (offset + count) * channels).buffer;
      span.used += count; session.sourceQueuedFrames -= count;
      if (span.used === span.frames) session.sourceSpans.shift();
      publish(recordFor(session, { pcm: buffer, rate, presentationMs, decodeTimestampUs,
        flags: span.flags & ~2, sequence: session.outputSequence++ >>> 0 }));
      offset += count;
    }
    sourceSilence(session); notify(session);
  }
  function output(session, data) {
    try {
      if (!live(session)) return;
      const frames = data.numberOfFrames, channels = data.numberOfChannels, rate = data.sampleRate;
      if (!Number.isInteger(frames) || frames < 1 || frames > rate || frames * channels * 2 > 64 * 1024 || channels !== session.config.channels || rate < 8000 || rate > 96000
        || (session.sourceFrames && rate !== session.config.sampleRate)) throw new Error('Invalid decoded AirPlay audio.');
      if (diagnostics) {
        try {
          const plane = new Float32Array(frames); let peak = 0, over = 0, invalid = 0;
          for (let c = 0; c < channels; c++) {
            data.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
            for (const value of plane) {
              if (!Number.isFinite(value)) invalid++;
              else { peak = Math.max(peak, Math.abs(value)); if (Math.abs(value) > 1) over++; }
            }
          }
          diagnostics.nativeScanFrames = (diagnostics.nativeScanFrames || 0) + frames;
          diagnostics.nativePeak = Math.max(diagnostics.nativePeak || 0, peak);
          diagnostics.nativeOverFullScaleSamples = (diagnostics.nativeOverFullScaleSamples || 0) + over;
          diagnostics.nativeNonFiniteSamples = (diagnostics.nativeNonFiniteSamples || 0) + invalid;
          if (over || invalid) onEvidence(invalid ? 'decoded-invalid' : 'decoded-range', { type: session.type, epoch: session.epoch,
            decodeTimestampUs: data.timestamp, frames, peak, overFullScale: over, nonFinite: invalid });
        } catch (_) { diagnostics.nativeScanErrors = (diagnostics.nativeScanErrors || 0) + 1; }
      }
      const pcm = new Int16Array(frames * channels);
      copyDecodedPcm(session, data, pcm);
      if (session.sourceFrames) { sourceOutput(session, pcm, rate); return; }
      let anchor = session.anchors[0];
      for (const candidate of session.anchors) { if (candidate.timestamp > data.timestamp) break; anchor = candidate; }
      const presentationMs = Number.isFinite(anchor?.presentationMs) ? anchor.presentationMs + (data.timestamp - anchor.timestamp) / 1000 : NaN;
      publish(recordFor(session, { pcm: pcm.buffer, rate, presentationMs, decodeTimestampUs: data.timestamp,
        flags: (anchor?.flags ?? session.flags) & ~2, sequence: session.outputSequence++ >>> 0 })); notify(session);
    } catch (cause) { failure(session, cause); }
    finally { data.close(); }
  }
  async function configure(record) {
    if (disposed) return false;
    const previous = sessions.get(record.type);
    if (previous && record.type === previous.type && ((record.epoch - previous.epoch) | 0) < 0) return false;
    reset(record.type);
    const semanticType = record.config?.semanticType ?? previous?.semanticType ?? record.type;
    if (record.config?.ended === true) {
      publish({ ...record, semanticType, config: undefined, ended: true, flags: record.flags | 2, pcm: new ArrayBuffer(0) }); return true;
    }
    const config = record.config;
    const session = { closed: false, decoder: null, software: null, config,
      type: record.type, semanticType, mode: record.mode, epoch: record.epoch, sequence: record.sequence, flags: record.flags,
      anchors: [], waiters: new Set(), outputSequence: 0, pending: new Set(), decodeTail: Promise.resolve(),
      sourceFrames: config ? mirrorAacFrames(record.mode, config) : 0, sourceSpans: [], sourceQueuedFrames: 0, silentSpans: 0, outputTimer: null };
    sessions.set(record.type, session);
    try {
      if (!config || !['pcm', ...Object.keys(CODECS)].includes(config.codec) || !Number.isInteger(config.sampleRate)
        || config.sampleRate < 8000 || config.sampleRate > 96000 || ![1, 2].includes(config.channels)
        || config.sampleRate !== record.rate || config.channels !== record.channels) throw new Error('Invalid AirPlay audio configuration.');
      if ((config.semanticType !== undefined && (!Number.isInteger(config.semanticType) || config.semanticType < 0 || config.semanticType > 4 || record.mode !== 'carplay'))
        || (record.type >= 7 && config.semanticType === undefined)) throw new Error('Invalid CarPlay audio stream purpose.');
      await loadAudioCore();
      if (!live(session)) return false;
      publish(recordFor(session, { ended: false, flags: record.flags | 2, pcm: new ArrayBuffer(0), presentationMs: NaN }));
      if (config.codec === 'pcm') {
        if (![16, 24].includes(config.bitDepth)) throw unsupported('pcm');
        backend(session, 'pcm');
        return true;
      }
      const decoderConfig = airPlayAudioDecoderConfig(config);
      let timer, supported = false;
      try {
        if (AudioDecoder?.isConfigSupported && EncodedAudioChunk) supported = (await Promise.race([
          AudioDecoder.isConfigSupported(decoderConfig),
          new Promise(resolve => { timer = setTimeout(() => resolve({ supported: false }), probeTimeout); }),
        ]))?.supported === true;
      }
      catch (_) { supported = false; }
      finally { clearTimeout(timer); }
      if (!live(session)) return false;
      if (supported) {
        try {
          const decoder = session.decoder = new AudioDecoder({ output: data => output(session, data), error: cause => failure(session, cause) });
          decoder.ondequeue = () => notify(session); decoder.configure(decoderConfig); backend(session, 'webcodecs'); return true;
        } catch (cause) {
          if (session.decoder && session.decoder.state !== 'closed') session.decoder.close();
          session.decoder = null;
          if (config.codec !== 'aac-eld') throw cause;
        }
      }
      if (config.codec !== 'aac-eld') throw unsupported(config.codec);
      if (!live(session)) return false;
      session.software = softwareEldFactory(config);
      await session.software.ready;
      if (live(session)) backend(session, 'software');
      return live(session);
    } catch (cause) { failure(session, cause); return false; }
  }
  async function decodeRecord(session, record) {
    if (!live(session)) return false;
    if (record.rate !== session.config.sampleRate || record.channels !== session.config.channels) { failure(session, new Error('AirPlay audio format changed without a configuration.')); return false; }
    try {
      session.sequence = record.sequence; session.flags = record.flags;
      if (session.config.codec === 'pcm') {
        if (record.payload.byteLength > session.config.sampleRate * session.config.channels * (session.config.bitDepth / 8)) throw new Error('AirPlay PCM packet exceeds the playback memory limit.');
        publish(recordFor(session, { pcm: decodePcmPacket(record.payload, session.config), presentationMs: record.presentationMs,
          decodeTimestampUs: record.decodeTimestampUs })); return true;
      }
      if (!Number.isFinite(record.decodeTimestampUs) || Math.abs(record.decodeTimestampUs) > Number.MAX_SAFE_INTEGER || !record.payload.byteLength) throw new Error('Invalid AirPlay audio timestamp or packet.');
      const timestamp = Math.round(record.decodeTimestampUs);
      if (mirrorNoData(record, session.config)) {
        const frames = session.sourceFrames;
        if (!frames) throw new Error('Invalid AirPlay no-data frame length.');
        // A native codec may retain old PCM until a later real packet arrives.
        // Queue source silence without blocking that next submission or flushing
        // the codec's overlap state. Software calls are already awaited in order.
        if (session.decoder) { sourceSpan(session, record, true); return true; }
        publish(recordFor(session, { pcm: new Int16Array(frames * session.config.channels).buffer,
          presentationMs: record.presentationMs, decodeTimestampUs: record.decodeTimestampUs,
          flags: record.flags & ~2, sequence: session.outputSequence++ >>> 0 }), frames); notify(session);
        return true;
      }
      if (session.software) {
        const pcm = await session.software.decode(rawAacPacket(record.payload));
        if (!live(session)) return false;
        publish(recordFor(session, { pcm, presentationMs: record.presentationMs, decodeTimestampUs: record.decodeTimestampUs,
          flags: record.flags & ~2, sequence: session.outputSequence++ >>> 0 })); notify(session);
        return true;
      }
      if (session.sourceFrames) sourceSpan(session, record, false);
      else {
        session.anchors.push({ timestamp, presentationMs: record.presentationMs, flags: record.flags });
        if (session.anchors.length > 128) session.anchors.shift();
      }
      session.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp,
        data: session.config.codec.startsWith('aac') ? rawAacPacket(record.payload) : record.payload }));
      while (live(session) && session.decoder.decodeQueueSize > 32) await new Promise(resolve => session.waiters.add(resolve));
      return live(session);
    } catch (cause) { failure(session, cause); return false; }
  }
  function decode(record) {
    const session = sessions.get(record.type);
    if (!session || !live(session) || record.type !== session.type || record.epoch !== session.epoch) return Promise.resolve(false);
    // The transport awaits each call, while per-session ordering also protects
    // concurrent callers and lets unrelated decoder epochs progress independently.
    const task = pending(session, session.decodeTail.then(() => decodeRecord(session, record)));
    session.decodeTail = task;
    return task;
  }
  return { configure, decode, reset,
    debug(enabled) {
      diagnostics = enabled ? { ...pcmStats(), errors: 0 } : null;
      if (enabled) for (const session of sessions.values()) if (live(session)) backend(session,
        session.software ? 'software' : session.decoder ? 'webcodecs' : session.config.codec);
    },
    stats() { return diagnostics ? { ...diagnostics } : null; },
    dispose() { reset(); disposed = true; diagnostics = null; },
  };
}
