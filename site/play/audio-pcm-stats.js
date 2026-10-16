// SPDX-License-Identifier: GPL-3.0-only
/** Scalar-only, opt-in measurements. Never retain sample buffers or media content. */
export function pcmStats() { return { packets: 0, frames: 0, nonzero: 0, peak: 0 }; }
export function measurePcm(stats, buffer, channels) {
  if (!buffer.byteLength) return;
  const pcm = new Int16Array(buffer);
  stats.packets++; stats.frames += pcm.length / channels;
  for (const sample of pcm) {
    if (sample) stats.nonzero++;
    stats.peak = Math.max(stats.peak, Math.abs(sample) / 32768);
  }
}
