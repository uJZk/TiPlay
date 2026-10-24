/*! SPDX-License-Identifier: GPL-3.0-only */
export const MAX_AUDIO_RECORD = 256 * 1024;
const configDecoder = new TextDecoder('utf-8', { fatal: true });

/** CarPlay PCM and ordinary AirPlay codec packets share the same timestamped transport header. */
export async function* readAudioRecords(body, signal) {
  const reader = body.getReader();
  const stop = () => reader.cancel().catch(() => {});
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  let chunk = new Uint8Array(), offset = 0;
  async function read(size) {
    // DataChannels already deliver a complete record in the common case. Keep that
    // storage until the transferable payload is extracted instead of copying it twice.
    while (offset === chunk.length) {
      const next = await reader.read();
      if (next.done) return null;
      chunk = next.value; offset = 0;
    }
    if (chunk.length - offset >= size) {
      const bytes = chunk.subarray(offset, offset + size);
      offset += size;
      return bytes;
    }
    const bytes = new Uint8Array(size);
    let filled = 0;
    while (filled < size) {
      if (offset === chunk.length) {
        const next = await reader.read();
        if (next.done) {
          if (filled) throw new Error('truncated audio');
          return null;
        }
        chunk = next.value; offset = 0;
      }
      const take = Math.min(size - filled, chunk.length - offset);
      bytes.set(chunk.subarray(offset, offset + take), filled);
      offset += take; filled += take;
    }
    return bytes;
  }
  try {
    for (;;) {
      const length = await read(4);
      if (!length) return;
      const size = new DataView(length.buffer, length.byteOffset, length.byteLength).getUint32(0);
      if (!size) continue;
      if (size < 24 || size > MAX_AUDIO_RECORD) throw new Error('invalid audio size');
      const bytes = await read(size);
      if (!bytes) throw new Error('truncated audio');
      const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const channels = bytes[2], rate = header.getUint32(4);
      const headerSize = 24;
      const kind = bytes[0], type = bytes[1], mode = (bytes[3] & 12) >> 2;
      if (![2, 6, 7].includes(kind) || (type >= 7 && mode !== 0) || (type === 5 && kind !== 2) || (type === 6 && mode !== 1) || (kind === 2 && type === 5 && size !== headerSize)
        || mode > 2 || channels < 1 || channels > 2 || rate < 8000 || rate > 96000
        || (kind === 2 && (size - headerSize) % (channels * 2)) || (kind === 7 && size < headerSize + 8)) {
        throw new Error('invalid audio format');
      }
      const record = { kind, type, channels, rate, flags: bytes[3], mode: ['carplay', 'airplay-mirror', 'airplay-audio'][mode],
        sequence: header.getUint32(8), epoch: header.getUint32(12), presentationMs: header.getFloat64(16) };
      if (kind === 2) record.pcm = bytes.slice(headerSize).buffer;
      else if (kind === 6) {
        if (size > 16 * 1024) throw new Error('AirPlay audio configuration too large');
        try { record.config = JSON.parse(configDecoder.decode(bytes.subarray(headerSize))); }
        catch (_) { throw new Error('invalid AirPlay audio configuration'); }
      } else {
        record.decodeTimestampUs = header.getFloat64(headerSize);
        record.payload = bytes.slice(headerSize + 8).buffer;
      }
      yield record;
    }
  } finally {
    signal?.removeEventListener('abort', stop);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
