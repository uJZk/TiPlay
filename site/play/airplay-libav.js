// SPDX-License-Identifier: GPL-3.0-only
const descriptionBytes = value => value instanceof ArrayBuffer ? new Uint8Array(value)
  : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : null;

/** Restrict SIMD to the exact codec/rate/layout workloads with measured gains. */
export function libavAudioSettings(config, outputRate = 48000) {
  const description = descriptionBytes(config?.description);
  const sampleRate = config?.sampleRate, channels = config?.numberOfChannels;
  const codec = config?.codec === 'mp4a.40.2' ? 'aac' : config?.codec === 'alac' ? 'alac' : null;
  if (!codec || !description?.length || description.length > 256 || ![1, 2].includes(channels)
    || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000
    || !Number.isInteger(outputRate) || outputRate < 8000 || outputRate > 96000) return null;
  if (codec === 'aac' && (description.length < 2 || description[0] >> 3 !== 2)) return null;
  if (codec === 'alac' && ![24, 36].includes(description.length)) return null;
  const bitDepth = codec === 'alac' ? description[description.length - 24 + 5] : 16;
  if (codec === 'alac') {
    const frames = new DataView(description.buffer, description.byteOffset + description.length - 24, 24).getUint32(0);
    if (![16, 24].includes(bitDepth) || frames < 1 || frames > 32768) return null;
  }
  return { codec, sampleRate, channels, outputRate, frameLength: codec === 'aac' ? (description[1] & 4 ? 960 : 1024) : null, description: Array.from(description),
    simd: sampleRate === 44100 && outputRate === 48000 && channels === 2 && bitDepth === 16 };
}

export async function canDecodeCastAudio(track) {
  try { if (await track.canDecode()) return true; }
  catch (cause) { if (!decodingFailure(cause)) throw cause; }
  return Boolean(libavAudioSettings(await track.getDecoderConfig?.()));
}

function createDecoder(settings, signal) {
  const worker = new Worker(new URL('./airplay-libav-worker.js', import.meta.url), { type: 'module' });
  let next = 0, closed = false;
  const pending = new Map();
  const close = (cause = new DOMException('Audio decoding interrupted.', 'AbortError')) => {
    if (closed) return;
    closed = true; worker.terminate(); signal?.removeEventListener('abort', abort);
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(cause); }
    pending.clear();
  };
  const abort = () => close(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  worker.onerror = () => close(Error('libav audio worker failed.'));
  worker.onmessageerror = () => close(Error('Invalid libav worker response.'));
  worker.onmessage = ({ data }) => {
    const entry = pending.get(data?.id);
    if (!entry) return;
    pending.delete(data.id); clearTimeout(entry.timer);
    if (data.error) entry.reject(Error(data.error)); else entry.resolve(data);
  };
  const call = (kind, payload = {}) => {
    if (closed || signal?.aborted) return Promise.reject(signal?.reason || new DOMException('Audio decoding interrupted.', 'AbortError'));
    const id = ++next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => close(Error('libav audio decoding timed out.')), 15000);
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ id, kind, ...payload }, payload.payload ? [payload.payload] : []); }
      catch (cause) { close(cause); }
    });
  };
  return { call, close };
}

const decodingFailure = cause => ['NotSupportedError', 'EncodingError'].includes(cause?.name)
  || /decod/i.test(cause?.message || '');

/** Retain Mediabunny's native path; reuse its packet seeking/demuxer on decoder failure. */
export async function* castAudioBuffers(lib, track, start, { signal, onBackend = () => {} } = {}) {
  let resume = start, outputRate = 48000, iterator;
  try {
    if (await track.canDecode()) {
      iterator = new lib.AudioBufferSink(track).buffers(start)[Symbol.asyncIterator]();
      onBackend('webcodecs');
      while (true) {
        const next = await iterator.next();
        if (next.done) return;
        outputRate = next.value.buffer.sampleRate;
        resume = Math.max(resume, next.value.timestamp + next.value.buffer.duration);
        yield next.value;
      }
    }
  } catch (cause) {
    if (signal?.aborted || !decodingFailure(cause)) throw cause;
  } finally { await iterator?.return?.(); }
  if (signal?.aborted) throw signal.reason;
  const settings = libavAudioSettings(await track.getDecoderConfig(), outputRate);
  if (!settings) throw new DOMException('No software decoder for this audio format.', 'NotSupportedError');
  const decoder = createDecoder(settings, signal);
  try {
    const ready = await decoder.call('init', { settings });
    onBackend(ready.backend);
    const packets = new lib.EncodedPacketSink(track);
    // Replay AAC overlap/filter history before clipping to the delivered frontier.
    const first = await packets.getKeyPacket(resume - (settings.codec === 'aac' ? 2 * settings.frameLength / settings.sampleRate : 0));
    const emit = function* (frames) {
      for (const frame of frames) {
        const length = frame.planes[0]?.length || 0;
        const skip = Math.max(0, Math.ceil((resume - frame.timestamp) * frame.sampleRate - 1e-6));
        if (skip >= length) continue;
        const planes = frame.planes.map(plane => plane.subarray(skip));
        const timestamp = frame.timestamp + skip / frame.sampleRate;
        resume = timestamp + planes[0].length / frame.sampleRate;
        yield { timestamp, buffer: { sampleRate: frame.sampleRate, numberOfChannels: planes.length,
          length: planes[0].length, duration: planes[0].length / frame.sampleRate,
          getChannelData: index => planes[index] } };
      }
    };
    for await (const packet of packets.packets(first || undefined)) {
      if (signal?.aborted) throw signal.reason;
      const payload = new Uint8Array(packet.data).buffer;
      const result = await decoder.call('decode', { payload, timestamp: packet.timestamp });
      yield* emit(result.frames);
    }
    yield* emit((await decoder.call('flush')).frames);
  } finally { decoder.close(); }
}
