/*! SPDX-License-Identifier: GPL-3.0-only */
export const MAX_AUDIO_RECORD = 256 * 1024;

/** PCM transport is independent of video: stalls cannot delay the picture. */
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
      if (size < 16 || size > MAX_AUDIO_RECORD) throw new Error('invalid audio size');
      const bytes = await read(size);
      if (!bytes) throw new Error('truncated audio');
      const header = new DataView(bytes.buffer);
      const channels = bytes[2], rate = header.getUint32(4);
      if (bytes[0] !== 1 || channels < 1 || channels > 2 || rate < 8000 || rate > 96000 || (size - 16) % (channels * 2)) {
        throw new Error('invalid audio format');
      }
      yield { type: bytes[1], channels, rate, flags: bytes[3], sequence: header.getUint32(8), pcm: bytes.slice(16).buffer };
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Streaming linear resampler; retains fractional position across capture quanta. */
export class PcmCapture {
  constructor(inputRate, outputRate, send) {
    this.step = inputRate / outputRate;
    this.position = 0; this.previous = 0;
    this.packet = new Int16Array(Math.round(outputRate / 50));
    this.used = 0; this.send = send;
  }
  push(input) {
    while (this.position < input.length - 1) {
      const i = Math.floor(this.position), fraction = this.position - i;
      const a = i < 0 ? this.previous : input[i], b = input[i + 1];
      const value = Math.max(-1, Math.min(1, a + (b - a) * fraction));
      this.packet[this.used++] = Math.round(value * (value < 0 ? 32768 : 32767));
      if (this.used === this.packet.length) {
        const packet = this.packet;
        // send transfers the buffer from the audio worklet, detaching packet.
        // Allocate the successor while its length is still available.
        this.packet = new Int16Array(packet.length); this.used = 0;
        this.send(packet.buffer);
      }
      this.position += this.step;
    }
    this.position -= input.length;
    this.previous = input[input.length - 1];
  }
}
