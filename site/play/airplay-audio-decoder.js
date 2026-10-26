// SPDX-License-Identifier: GPL-3.0-only
import { createLiveAudioDecoder, liveAudioSettings } from './live-audio-software.js';
import { pcmStats, measurePcm } from './audio-pcm-stats.js';
import { audioSignalKernel, loadAudioCore } from './wasm/audio-core.js';
const nativeLittleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
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


const rawAacPacket = payload => {
  const bytes = new Uint8Array(payload);
  if (bytes.length >= 7 && bytes[0] === 255 && (bytes[1] & 246) === 240) {
    const size = (bytes[3] & 3) << 11 | bytes[4] << 3 | bytes[5] >> 5;
    const header = bytes[1] & 1 ? 7 : 9;
    if (size === bytes.length && size > header) return bytes.subarray(header);
  }
  return bytes;
};
const noData = record => record.mode === 'airplay-mirror' && record.payload?.byteLength === 4
  && new Uint8Array(record.payload).every((value, index) => value === [0, 104, 52, 0][index]);

/** Realtime audio: encoded Opus goes to NetEq; all other decoding is software. */
export function createAirPlayAudioDecoder({ onPcm, onEncoded = null, onError = () => {}, onEvidence = () => {},
  softwareFactory = createLiveAudioDecoder } = {}) {
  const sessions = new Map();
  let disposed = false, diagnostics = null;
  const live = session => !disposed && !session.closed && sessions.get(session.type) === session;
  const recordFor = (session, fields = {}) => ({ type: session.type, mode: session.mode, epoch: session.epoch,
    semanticType: session.semanticType, sequence: session.outputSequence, flags: session.flags & ~2,
    rate: 48000, channels: session.config.channels, ...fields });
  function publish(record) {
    if (diagnostics && record.pcm.byteLength) {
      const stream = diagnostics['stream' + record.type] ??= pcmStats();
      const owner = sessions.get(record.type);
      Object.assign(stream, { backend: owner?.neteq ? 'neteq-opus' : owner?.software?.backend || 'pcm', rate: record.rate, channels: record.channels, epoch: record.epoch });
      measurePcm(diagnostics, record.pcm, record.channels, stream);
    }
    onPcm(record);
  }
  function close(session) {
    if (!session || session.closed) return;
    session.closed = true; session.software?.close();
    for (const cancel of session.pending) cancel(); session.pending.clear();
  }
  function reset(type) {
    if (type === undefined) { for (const session of sessions.values()) close(session); sessions.clear(); }
    else { close(sessions.get(type)); sessions.delete(type); }
  }
  function fail(session, cause) {
    if (!live(session)) return;
    if (diagnostics) diagnostics.errors++;
    onEvidence('decoder-error', { type: session.type, epoch: session.epoch });
    close(session);
    if (Number.isInteger(session.config?.sampleRate) && [1, 2].includes(session.config?.channels))
      publish(recordFor(session, { pcm: new ArrayBuffer(0), flags: session.flags | 2, ended: true, presentationMs: NaN }));
    onError(cause);
  }
  function outputs(session, frames) {
    if (!live(session)) return;
    for (const frame of frames) {
      const timestamp = frame.timestamp * 1e6;
      if (!(frame.pcm instanceof ArrayBuffer) || !Number.isFinite(timestamp)) throw Error('Invalid software audio output.');
      publish(recordFor(session, { sequence: session.outputSequence++, pcm: frame.pcm, decodeTimestampUs: timestamp,
        presentationMs: Number.isFinite(session.presentationOffsetMs) ? timestamp / 1000 + session.presentationOffsetMs : NaN }));
    }
  }
  async function finish(record) {
    const session = sessions.get(record.type);
    if (session && ((record.epoch - session.epoch) | 0) < 0) return false;
    if (session && !session.closed) {
      await session.tail;
      if (session.software && live(session)) outputs(session, await session.software.flush());
      if (!live(session)) return false;
      close(session);
    }
    sessions.delete(record.type);
    publish({ ...record, rate: 48000, flags: record.flags | 2, ended: true, pcm: new ArrayBuffer(0) });
    return true;
  }
  async function configure(record) {
    if (disposed) return false;
    const previous = sessions.get(record.type);
    if (previous && ((record.epoch - previous.epoch) | 0) < 0) return false;
    if (record.config?.ended) {
      try { return await finish(record); } catch (cause) { if (previous) fail(previous, cause); return false; }
    }
    reset(record.type);
    const config = record.config;
    const session = { config, type: record.type, epoch: record.epoch, mode: record.mode,
      semanticType: config?.semanticType ?? record.type, flags: record.flags, outputSequence: 0,
      pending: new Set(), tail: Promise.resolve(), closed: false };
    sessions.set(record.type, session);
    try {
      if (!config || config.sampleRate !== record.rate || config.channels !== record.channels
        || ![1, 2].includes(config.channels) || !Number.isInteger(config.sampleRate)
        || config.sampleRate < 8000 || config.sampleRate > 96000) throw Error('Invalid audio configuration.');
      if (config.semanticType !== undefined && (record.mode !== 'carplay' || !Number.isInteger(config.semanticType)
        || config.semanticType < 0 || config.semanticType > 4) || record.type >= 7 && config.semanticType === undefined)
        throw Error('Invalid CarPlay audio stream purpose.');
      await loadAudioCore();
      if (!live(session)) return false;
      if (config.codec === 'opus') {
        if (config.sampleRate !== 48000 || !onEncoded) throw Error('Opus requires the NetEq decoder.');
        session.neteq = true;
        onEncoded({ ...recordFor(session), flags: record.flags | 2, neteqConfig: config });
      } else {
        if (!liveAudioSettings(config)) throw Error(`Unsupported software ${config.codec.toUpperCase()} audio format.`);
        if (config.codec !== 'pcm' || config.sampleRate !== 48000) {
          session.software = softwareFactory(config);
          await session.software.ready;
        }
        if (!live(session)) return false;
        publish(recordFor(session, { pcm: new ArrayBuffer(0), flags: record.flags | 2, ended: false, presentationMs: NaN }));
      }
      if (diagnostics) diagnostics['stream' + session.type] = { ...pcmStats(), backend: session.neteq ? 'neteq-opus'
        : session.software?.backend || 'pcm', epoch: session.epoch, rate: 48000, channels: config.channels };
      return live(session);
    } catch (cause) { fail(session, cause); return false; }
  }
  async function decodeRecord(session, record) {
    if (!live(session)) return false;
    try {
      if (record.rate !== session.config.sampleRate || record.channels !== session.config.channels)
        throw Error('Audio format changed without configuration.');
      session.flags = record.flags;
      if (!Number.isFinite(record.decodeTimestampUs) && session.config.codec === 'pcm')
        record = { ...record, decodeTimestampUs: session.nextPcmTimestampUs ?? 0 };
      if (!Number.isFinite(record.decodeTimestampUs) || Math.abs(record.decodeTimestampUs) > Number.MAX_SAFE_INTEGER)
        throw Error('Invalid audio timestamp.');
      const config = session.config;
      if (session.neteq) {
        if (!record.payload?.byteLength || record.payload.byteLength > 65536) throw Error('Invalid Opus packet.');
        onEncoded({ ...record, flags: record.flags & ~2, semanticType: session.semanticType }); return true;
      }
      if (Number.isFinite(record.presentationMs)) session.presentationOffsetMs = record.presentationMs - record.decodeTimestampUs / 1000;
      let payload = config.codec === 'pcm' ? decodePcmPacket(record.payload, config)
        : config.codec.startsWith('aac') ? rawAacPacket(record.payload) : record.payload;
      const silent = config.codec.startsWith('aac') && noData(record)
        ? config.samplesPerFrame ?? (config.codec === 'aac-eld' ? config.asc[2] & 16 ? 480 : 512 : config.asc[1] & 4 ? 960 : 1024) : 0;
      if (diagnostics && silent) {
        diagnostics.noDataPackets = (diagnostics.noDataPackets || 0) + 1;
        diagnostics.noDataFrames = (diagnostics.noDataFrames || 0) + silent;
      }
      if (config.codec === 'pcm') session.nextPcmTimestampUs = record.decodeTimestampUs + payload.byteLength / 2 / config.channels * 1e6 / config.sampleRate;
      if (session.software) outputs(session, await session.software.decode(payload, record.decodeTimestampUs, silent));
      else publish(recordFor(session, { sequence: record.sequence ?? session.outputSequence++, pcm: payload, presentationMs: record.presentationMs, decodeTimestampUs: record.decodeTimestampUs }));
      return live(session);
    } catch (cause) { fail(session, cause); return false; }
  }
  function decode(record) {
    const session = sessions.get(record.type);
    if (!session || !live(session) || session.epoch !== record.epoch) return Promise.resolve(false);
    const task = new Promise((resolve, reject) => {
      const cancel = () => resolve(false); session.pending.add(cancel);
      session.tail.then(() => decodeRecord(session, record)).then(value => { session.pending.delete(cancel); resolve(value); }, reject);
    });
    session.tail = task; return task;
  }
  async function pcm(record) {
    if (!record.pcm.byteLength && record.flags & 2) return finish(record);
    const previous = sessions.get(record.type);
    if (!previous || previous.epoch !== record.epoch || record.flags & 2) {
      if (!await configure({ ...record, config: { codec: 'pcm', sampleRate: record.rate, channels: record.channels,
        bitDepth: 16, littleEndian: true, ...(record.type >= 7 ? { semanticType: record.semanticType ?? 0 } : {}) } })) return false;
    }
    const session = sessions.get(record.type);
    const timestamp = Number.isFinite(record.decodeTimestampUs) ? record.decodeTimestampUs
      : session.nextPcmTimestampUs ?? 0;
    session.nextPcmTimestampUs = timestamp + record.pcm.byteLength / 2 / record.channels * 1e6 / record.rate;
    return decode({ ...record, payload: record.pcm, decodeTimestampUs: timestamp });
  }
  return { configure, decode, pcm, reset, debug(enabled) { diagnostics = enabled ? { ...pcmStats(), errors: 0 } : null; },
    stats: () => diagnostics ? { ...diagnostics } : null,
    dispose() { reset(); disposed = true; diagnostics = null; } };
}
