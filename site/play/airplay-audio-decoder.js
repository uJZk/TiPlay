// SPDX-License-Identifier: GPL-3.0-only
const CODECS = { 'aac-lc': 'mp4a.40.2', 'aac-eld': 'mp4a.40.39', alac: 'alac', opus: 'opus' };
const unsupported = codec => new DOMException(`This browser cannot decode AirPlay ${codec.toUpperCase()} audio.`, 'NotSupportedError');
const byteArray = values => {
  if (!Array.isArray(values) || values.length < 1 || values.length > 256 || values.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return Uint8Array.from(values);
};
function rawAacPacket(payload) {
  const bytes = new Uint8Array(payload);
  if (bytes.length >= 7 && bytes[0] === 255 && (bytes[1] & 246) === 240 && ((bytes[2] >> 2) & 15) < 13) {
    const size = (bytes[3] & 3) << 11 | bytes[4] << 3 | bytes[5] >> 5;
    const header = bytes[1] & 1 ? 7 : 9;
    if (size === bytes.length && size > header) return bytes.subarray(header);
  }
  return payload;
}

export function decodePcmPacket(payload, { bitDepth, channels, littleEndian = false }) {
  const bytes = new Uint8Array(payload), width = bitDepth / 8;
  if (![16, 24].includes(bitDepth) || ![1, 2].includes(channels) || bytes.length % (width * channels)) throw new Error('Invalid AirPlay PCM packet.');
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

/** Independent AAC/Opus/ALAC/PCM stream decoders share the browser output clock and retain their own epochs. */
export function createAirPlayAudioDecoder({ onPcm, onError = () => {},
  AudioDecoder = globalThis.AudioDecoder, EncodedAudioChunk = globalThis.EncodedAudioChunk, probeTimeout = 1000 } = {}) {
  const sessions = new Map();
  let disposed = false;
  const live = session => !disposed && sessions.get(session.type) === session && !session.closed;
  const notify = session => { for (const resolve of session.waiters) resolve(); session.waiters.clear(); };
  function close(session) {
    if (!session || session.closed) return;
    session.closed = true; if (session.decoder && session.decoder.state !== 'closed') session.decoder.close();
    session.decoder = null; session.anchors.length = 0; notify(session);
  }
  function reset(type) {
    if (type === undefined) { for (const session of sessions.values()) close(session); sessions.clear(); }
    else { close(sessions.get(type)); sessions.delete(type); }
  }
  function failure(session, cause) {
    if (!live(session)) return;
    close(session); onError(cause);
  }
  function recordFor(session, fields) {
    return { type: session.type, mode: session.mode, epoch: session.epoch, sequence: session.sequence,
      flags: session.flags & ~2, rate: session.config.sampleRate, channels: session.config.channels, ...fields };
  }
  function output(session, data) {
    try {
      if (!live(session)) return;
      const frames = data.numberOfFrames, channels = data.numberOfChannels, rate = data.sampleRate;
      if (!Number.isInteger(frames) || frames < 1 || frames > rate || frames * channels * 2 > 64 * 1024 || channels !== session.config.channels || rate < 8000 || rate > 96000) throw new Error('Invalid decoded AirPlay audio.');
      const pcm = new Int16Array(frames * channels), plane = new Float32Array(frames);
      for (let channel = 0; channel < channels; channel++) {
        data.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
        for (let sample = 0; sample < frames; sample++) pcm[sample * channels + channel] = Math.max(-32768, Math.min(32767, Math.round(plane[sample] * 32768)));
      }
      let anchor = session.anchors[0];
      for (const candidate of session.anchors) { if (candidate.timestamp > data.timestamp) break; anchor = candidate; }
      const presentationMs = Number.isFinite(anchor?.presentationMs) ? anchor.presentationMs + (data.timestamp - anchor.timestamp) / 1000 : NaN;
      onPcm(recordFor(session, { pcm: pcm.buffer, rate, presentationMs,
        flags: (anchor?.flags ?? session.flags) & ~2, sequence: session.outputSequence++ >>> 0 })); notify(session);
    } catch (cause) { failure(session, cause); }
    finally { data.close(); }
  }
  async function configure(record) {
    if (disposed) return false;
    const previous = sessions.get(record.type);
    if (previous && record.type === previous.type && ((record.epoch - previous.epoch) | 0) < 0) return false;
    reset(record.type);
    if (record.config?.ended === true) {
      onPcm({ ...record, config: undefined, flags: record.flags | 2, pcm: new ArrayBuffer(0) }); return true;
    }
    const config = record.config;
    const session = { closed: false, decoder: null, config,
      type: record.type, mode: record.mode, epoch: record.epoch, sequence: record.sequence, flags: record.flags,
      anchors: [], waiters: new Set(), outputSequence: 0 };
    sessions.set(record.type, session);
    try {
      if (!config || !['pcm', ...Object.keys(CODECS)].includes(config.codec) || !Number.isInteger(config.sampleRate)
        || config.sampleRate < 8000 || config.sampleRate > 96000 || ![1, 2].includes(config.channels)
        || config.sampleRate !== record.rate || config.channels !== record.channels) throw new Error('Invalid AirPlay audio configuration.');
      onPcm(recordFor(session, { flags: record.flags | 2, pcm: new ArrayBuffer(0), presentationMs: NaN }));
      if (config.codec === 'pcm') {
        if (![16, 24].includes(config.bitDepth)) throw unsupported('pcm');
        return true;
      }
      if (!AudioDecoder?.isConfigSupported || !EncodedAudioChunk) throw unsupported(config.codec);
      const description = config.codec === 'alac' ? byteArray(config.cookie)
        : config.codec === 'opus' ? byteArray(config.cookie) || byteArray(config.asc) : byteArray(config.asc);
      if (!description && config.codec !== 'opus') throw new Error('AirPlay audio codec configuration is missing.');
      const decoderConfig = { codec: CODECS[config.codec], sampleRate: config.sampleRate, numberOfChannels: config.channels, ...(description ? { description } : {}) };
      let timer, supported;
      try { supported = await Promise.race([AudioDecoder.isConfigSupported(decoderConfig),
        new Promise(resolve => { timer = setTimeout(() => resolve({ supported: false }), probeTimeout); })]); }
      catch (_) { throw unsupported(config.codec); }
      finally { clearTimeout(timer); }
      if (!live(session)) return false;
      if (!supported?.supported) throw unsupported(config.codec);
      const decoder = session.decoder = new AudioDecoder({ output: data => output(session, data), error: cause => failure(session, cause) });
      decoder.ondequeue = () => notify(session);
      decoder.configure(decoderConfig); return true;
    } catch (cause) { failure(session, cause); return false; }
  }
  async function decode(record) {
    const session = sessions.get(record.type);
    if (!session || !live(session) || record.type !== session.type || record.epoch !== session.epoch) return false;
    if (record.rate !== session.config.sampleRate || record.channels !== session.config.channels) { failure(session, new Error('AirPlay audio format changed without a configuration.')); return false; }
    try {
      session.sequence = record.sequence; session.flags = record.flags;
      if (session.config.codec === 'pcm') {
        if (record.payload.byteLength > session.config.sampleRate * session.config.channels * (session.config.bitDepth / 8)) throw new Error('AirPlay PCM packet exceeds the playback memory limit.');
        onPcm(recordFor(session, { pcm: decodePcmPacket(record.payload, session.config), presentationMs: record.presentationMs })); return true;
      }
      if (!Number.isFinite(record.decodeTimestampUs) || Math.abs(record.decodeTimestampUs) > Number.MAX_SAFE_INTEGER || !record.payload.byteLength) throw new Error('Invalid AirPlay audio timestamp or packet.');
      const timestamp = Math.round(record.decodeTimestampUs);
      session.anchors.push({ timestamp, presentationMs: record.presentationMs, flags: record.flags });
      if (session.anchors.length > 128) session.anchors.shift();
      session.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp,
        data: session.config.codec.startsWith('aac') ? rawAacPacket(record.payload) : record.payload }));
      while (live(session) && session.decoder.decodeQueueSize > 32) await new Promise(resolve => session.waiters.add(resolve));
      return live(session);
    } catch (cause) { failure(session, cause); return false; }
  }
  return { configure, decode, reset, dispose() { reset(); disposed = true; } };
}
