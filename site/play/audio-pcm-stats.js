// SPDX-License-Identifier: GPL-3.0-only
/** Scalar-only, opt-in measurements. Never retain sample buffers or media content. */
import { audioSignalKernel } from './wasm/audio-core.js';
export function pcmStats() { return { packets: 0, frames: 0, nonzero: 0, peak: 0 }; }
export function measurePcm(stats, buffer, channels, stream) {
  if (!buffer.byteLength) return;
  const pcm = new Int16Array(buffer);
  let nonzero = 0, peak = 0;
  if (pcm.length >= 64) ({ nonzero, peak } = audioSignalKernel().scanPcm(pcm));
  else for (const sample of pcm) {
    if (sample) nonzero++;
    peak = Math.max(peak, Math.abs(sample) / 32768);
  }
  for (const target of stream ? [stats, stream] : [stats]) {
    target.packets++; target.frames += pcm.length / channels;
    target.nonzero += nonzero; target.peak = Math.max(target.peak, peak);
  }
}
