// SPDX-License-Identifier: GPL-3.0-only
// Each caller owns a separate decoder runtime; do not share mutable codec state.
const SIMD = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
  3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11);
export const libavSimdSupported = () => WebAssembly.validate(SIMD);

export async function createLibav({ simd = false } = {}) {
  simd = Boolean(simd && libavSimdSupported());
  const { default: factory } = simd
    ? await import('./libav-6.10.9.0-tiplay-simd.wasm.mjs')
    : await import('./libav-6.10.9.0-tiplay.wasm.mjs');
  return { backend: simd ? 'libav-simd' : 'libav-wasm', instance: await factory() };
}

/** FFmpeg copies audio fields only when codec_type is explicitly AUDIO. */
export function libavAudioParameters(sampleRate, channels, description) {
  return { codec_type: 1 /* AVMEDIA_TYPE_AUDIO */, sample_rate: sampleRate, channels,
    channel_layoutmask: channels === 1 ? 4 : 3, extradata: new Uint8Array(description) };
}

/** Only profiles with positive SIMD gains in all three recorded ELD runs. */
export const eldSimdPreferred = (rate, channels, frames) =>
  rate === 44100 && channels === 1 && [480, 512].includes(frames) || rate === 48000 && channels === 2 && frames === 512;

