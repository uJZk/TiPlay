/*! SPDX-License-Identifier: GPL-3.0-only */
export const MAX_AUDIO_RECORD = 256 * 1024;

/** Separate PCM transport; presentation timestamps feed the shared audio/video scheduler. */
export async function* readAudioRecords(body) {
  const reader = body.getReader();
  let chunk = new Uint8Array(), offset = 0;
  async function read(size) {
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
      const size = new DataView(length.buffer).getUint32(0);
      if (!size) continue;
      if (size < 24 || size > MAX_AUDIO_RECORD) throw new Error('invalid audio size');
      const bytes = await read(size);
      if (!bytes) throw new Error('truncated audio');
      const header = new DataView(bytes.buffer);
      const channels = bytes[2], rate = header.getUint32(4);
      const headerSize = 24;
      if (bytes[0] !== 2 || bytes[1] > 6 || (bytes[1] === 5 && size !== headerSize) ||
        (bytes[1] === 6 && (bytes[3] & 12) !== 4) || (bytes[3] & 12) > 4 ||
        channels < 1 || channels > 2 || rate < 8000 || rate > 96000 || (size - headerSize) % (channels * 2)) {
        throw new Error('invalid audio format');
      }
      yield { type: bytes[1], channels, rate, flags: bytes[3], mode: ['carplay', 'airplay-mirror'][(bytes[3] & 12) >> 2], sequence: header.getUint32(8), epoch: header.getUint32(12), presentationMs: header.getFloat64(16), pcm: bytes.slice(headerSize).buffer };
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
