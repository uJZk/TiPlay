/*! SPDX-License-Identifier: GPL-3.0-only */
/** Completed presentation intervals ending in the last five seconds, independent of decode/transport stats. */
export function createFpsWindow({ now = () => performance.now(), windowMs = 5000 } = {}) {
  let previous = null, samples = [], latencies = [];
  const prune = at => {
    while (samples.length && samples[0].at <= at - windowMs) samples.shift();
    while (latencies.length && latencies[0].at <= at - windowMs) latencies.shift();
  };
  return {
    frame(at = now(), count = 1, latency = null) {
      if (!Number.isFinite(at) || !Number.isInteger(count) || count < 1) return;
      prune(at);
      if (Number.isFinite(latency) && latency >= 0 && latency <= 10000) {
        latencies.push({ at, duration: latency, count: 1 });
        if (latencies.length > 4096) latencies.shift();
      }
      if (previous !== null && at > previous) {
        samples.push({ at, duration: Math.min(at - previous, windowMs) / count, count });
        if (samples.length > 4096) samples.shift();
      }
      if (previous === null || at > previous) previous = at;
    },
    reset() { previous = null; samples = []; latencies = []; },
    stats(at = now()) {
      prune(at);
      const sortedSamples = [...samples].sort((a, b) => a.duration - b.duration);
      const sortedLatencies = [...latencies].sort((a, b) => a.duration - b.duration);
      const sampleCount = samples.reduce((sum, sample) => sum + sample.count, 0);
      const average = (sorted, total, from, to) => {
        let position = 0, weightTotal = 0, sum = 0;
        // Fractional boundary weights keep percentages exact during warm-up.
        for (const sample of sorted) {
          const weight = Math.max(0, Math.min(position + sample.count, to * total) - Math.max(position, from * total));
          weightTotal += weight; sum += weight * sample.duration; position += sample.count;
        }
        return weightTotal > 0 ? sum / weightTotal : null;
      };
      const fps = duration => duration > 0 ? 1000 / duration : null;
      return {
        fps90: fps(average(sortedSamples, sampleCount, .05, .95)), fpsLow5: fps(average(sortedSamples, sampleCount, .95, 1)),
        fpsSamples: sampleCount,
        latency90: average(sortedLatencies, latencies.length, .05, .95), latencyHigh5: average(sortedLatencies, latencies.length, .95, 1),
        latencySamples: latencies.length,
      };
    },
  };
}

/** Codec and five-second presentation statistics for the Debug banner. */
export function formatDebugFps(codec, stats = {}) {
  const number = value => Number.isFinite(value) && value >= 0 ? String(Math.round(value)) : '—';
  return `${codec} · ${number(stats.fps90)} fps · ${number(stats.latency90)} ms · ${number(stats.latencyHigh5)} ms`;
}
