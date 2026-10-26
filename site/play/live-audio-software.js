// SPDX-License-Identifier: GPL-3.0-only
import { libavAudioSettings } from './airplay-libav.js';
import { eldSimdPreferred } from './vendor/libav/libav.js';
const MAX_INSTANCES = 4;
let instances = 0;
export function liveAudioSettings(config) {
  if (!config || ![1, 2].includes(config.channels) || !Number.isInteger(config.sampleRate)
    || config.sampleRate < 8000 || config.sampleRate > 96000) return null;
  if (config.codec === 'pcm') return [16, 24].includes(config.bitDepth)
    ? { codec: 'pcm', sampleRate: config.sampleRate, channels: config.channels, outputRate: 48000, outputFormat: 1, simd: false } : null;
  const codec = config.codec === 'aac-eld' ? 'mp4a.40.39' : config.codec === 'aac-lc' ? 'mp4a.40.2' : config.codec;
  const bytes = config.codec === 'alac' ? config.cookie : config.asc;
  if (!Array.isArray(bytes) || bytes.length > 256 || bytes.some(b => !Number.isInteger(b) || b < 0 || b > 255)) return null;
  if (config.codec === 'aac-eld') {
    const frames = config.samplesPerFrame ?? (bytes[2] & 16 ? 480 : 512);
    const expected = [248, config.sampleRate === 44100 ? 232 : 230, config.channels << 5 | (frames === 480 ? 16 : 0), 0];
    if ((config.bitDepth ?? 16) !== 16 || ![44100, 48000].includes(config.sampleRate) || ![480, 512].includes(frames)
      || bytes.length !== 4 || bytes.some((b, i) => b !== expected[i])) return null;
    return { codec: 'aac', sampleRate: config.sampleRate, channels: config.channels, outputRate: 48000,
      description: bytes, outputFormat: 1,
      // Only the measured no-resampling ELD profile is transferable to this path.
      simd: config.sampleRate === 48000 && eldSimdPreferred(config.sampleRate, config.channels, frames) };
  }
  const settings = libavAudioSettings({ codec, sampleRate: config.sampleRate, numberOfChannels: config.channels, description: Uint8Array.from(bytes) });
  if (!settings) return null;
  if (config.codec === 'aac-lc' && config.samplesPerFrame !== undefined && config.samplesPerFrame !== settings.frameLength) return null;
  if (config.codec === 'alac') {
    const cookie = Uint8Array.from(bytes), start = cookie.length - 24;
    if (config.bitDepth !== undefined && config.bitDepth !== cookie[start + 5]) return null;
    if (config.samplesPerFrame !== undefined && config.samplesPerFrame !== new DataView(cookie.buffer).getUint32(start)) return null;
  }
  return { ...settings, outputFormat: 1 };
}
export function createLiveAudioDecoder(config, { Worker = globalThis.Worker, timeout = 15000 } = {}) {
  const settings = liveAudioSettings(config);
  if (!settings || typeof Worker !== 'function') throw Error('Unsupported software audio configuration.');
  if (instances >= MAX_INSTANCES) throw Error('Software audio decoder limit reached.');
  instances++;
  let worker, closed = false, next = 0, backend = null;
  const pending = new Map();
  const close = (cause = new DOMException('Audio decoder closed.', 'AbortError')) => {
    if (closed) return;
    closed = true; instances--; worker?.terminate();
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(cause); }
    pending.clear();
  };
  const call = (kind, fields = {}) => {
    if (closed) return Promise.reject(new DOMException('Audio decoder closed.', 'AbortError'));
    const id = ++next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => close(Error('Audio decoding timed out.')), timeout);
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ id, kind, ...fields }, fields.payload ? [fields.payload] : []); }
      catch (cause) { close(cause); }
    });
  };
  try {
    worker = new Worker(new URL('./airplay-libav-worker.js', import.meta.url), { type: 'module' });
    worker.onerror = () => close(Error('Audio decoder worker failed.'));
    worker.onmessageerror = () => close(Error('Invalid decoder response.'));
    worker.onmessage = ({ data }) => {
      const item = pending.get(data?.id);
      if (!item) return;
      pending.delete(data.id); clearTimeout(item.timer);
      if (data.error) item.reject(Error(data.error)); else item.resolve(data);
    };
  } catch (cause) { close(cause); }
  const ready = closed ? Promise.reject(Error('Audio worker initialization failed.'))
    : call('init', { settings }).then(result => { backend = result.backend; });
  return { ready, close, get backend() { return backend; },
    async decode(payload, timestamp, silentFrames = 0) {
      await ready;
      if (pending.size >= 32) throw Error('Audio decode queue is full.');
      const bytes = payload instanceof ArrayBuffer ? new Uint8Array(payload) : payload;
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > 1024 * 1024) throw Error('Invalid audio access unit.');
      const result = await call('decode', { payload: bytes.slice().buffer, timestamp: timestamp / 1e6, silentFrames });
      return result.frames;
    },
    async flush() { await ready; return (await call('flush')).frames; },
  };
}
