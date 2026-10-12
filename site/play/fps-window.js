/*! SPDX-License-Identifier: GPL-3.0-only */
/** Recent actual draws and five-second presentation statistics, independent of decode/transport stats. */
export function createFpsWindow({ now = () => performance.now(), windowMs = 5000 } = {}) {
  let previous = null, samples = [], offsets = [], draws = [];
  const prune = at => {
    while (draws.length && draws[0] <= at - 1000) draws.shift();
    while (samples.length && samples[0].at <= at - windowMs) samples.shift();
    while (offsets.length && offsets[0].at <= at - windowMs) offsets.shift();
  };
  return {
    frame(at = now(), count = 1, offset = null) {
      if (!Number.isFinite(at) || !Number.isInteger(count) || count < 1) return;
      prune(at);
      // One successful presenter call is one draw, even when delivery coalesced several source frames.
      draws.push(at);
      if (draws.length > 4096) draws.shift();
      if (Number.isFinite(offset) && Math.abs(offset) <= 10000) {
        offsets.push({ at, duration: offset, count: 1 });
        if (offsets.length > 4096) offsets.shift();
      }
      if (previous !== null && at > previous) {
        samples.push({ at, duration: Math.min(at - previous, windowMs) / count, count });
        if (samples.length > 4096) samples.shift();
      }
      if (previous === null || at > previous) previous = at;
    },
    reset() { previous = null; samples = []; offsets = []; draws = []; },
    stats(at = now()) {
      prune(at);
      const sortedSamples = [...samples].sort((a, b) => a.duration - b.duration);
      const sortedLatencies = [...offsets].sort((a, b) => a.duration - b.duration);
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
        currentFps: draws.length,
        fps90: fps(average(sortedSamples, sampleCount, .05, .95)), fpsLow5: fps(average(sortedSamples, sampleCount, .95, 1)),
        fpsSamples: sampleCount,
        presentationOffset90: average(sortedLatencies, offsets.length, .05, .95), presentationOffsetHigh5: average(sortedLatencies, offsets.length, .95, 1),
        presentationOffsetSamples: offsets.length,
      };
    },
  };
}

/** Codec, current draw rate and five-second signed presentation offsets for Debug. */
export function formatDebugFps(codec, stats = {}) {
  const number = value => Number.isFinite(value) ? String(Math.round(value)) : '—';
  return `${codec} · ${number(stats.currentFps)} fps · ${number(stats.presentationOffset90)} ms · ${number(stats.presentationOffsetHigh5)} ms`;
}
