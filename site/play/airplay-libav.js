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
