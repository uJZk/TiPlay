/*! SPDX-License-Identifier: GPL-3.0-only */
/** Recent actual draws and five-second presentation statistics, independent of decode/transport stats. */
export function createFpsWindow({ now = () => performance.now(), windowMs = 5000 } = {}) {
  let previous = null, latest = null, samples = [], offsets = [], draws = [];
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
      latest = { at, offset: Number.isFinite(offset) && Math.abs(offset) <= 10000 ? offset : null };
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
    reset() { previous = latest = null; samples = []; offsets = []; draws = []; },
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
        lastDrawAgeMs: latest ? Math.max(0, at - latest.at) : null,
        frameIntervalP95Ms: sortedSamples.length ? sortedSamples[Math.min(sortedSamples.length - 1, Math.ceil(sortedSamples.length * .95) - 1)].duration : null,
        frameIntervalMaxMs: sortedSamples.at(-1)?.duration ?? null,
        currentDelta: latest && latest.at > at - 1000 ? latest.offset : null,
        fps90: fps(average(sortedSamples, sampleCount, .05, .95)), fpsLow5: fps(average(sortedSamples, sampleCount, .95, 1)),
        fpsSamples: sampleCount,
        presentationOffset90: average(sortedLatencies, offsets.length, .05, .95), presentationOffsetHigh5: average(sortedLatencies, offsets.length, .95, 1),
        presentationOffsetSamples: offsets.length,
      };
    },
  };
}

/** Only explicit browser discards count; decoder-internal loss and phone/network loss remain unknown. */
export function performanceStats(stats = {}) {
  const counters = ['decodeDroppedFrames', 'scheduledDroppedFrames', 'transferDroppedFrames', 'renderDroppedFrames', 'pacingDroppedFrames']
    .map(key => stats[key]).filter(Number.isFinite);
  return { ...stats, droppedFrames: counters.length ? counters.reduce((sum, count) => sum + count, 0) : null };
}

/** Mean browser receive/decode processing time over consecutive samples of one RTP stream. */
export function createReceiveProcessingTracker() {
  let previous = null;
  return {
    reset() { previous = null; },
    sample(source, generation) {
      const valid = source && typeof source.id === 'string' && source.id.length > 0 &&
        Number.isFinite(source.timestamp) && Number.isSafeInteger(source.framesDecoded) && source.framesDecoded >= 0 &&
        Number.isFinite(source.totalProcessingDelay) && source.totalProcessingDelay >= 0;
      if (!valid) { previous = null; return null; }
      const next = { id: source.id, generation, timestamp: source.timestamp,
        frames: source.framesDecoded, delay: source.totalProcessingDelay };
      const old = previous; previous = next;
      if (!old || old.id !== next.id || old.generation !== next.generation || next.timestamp <= old.timestamp || next.timestamp - old.timestamp > 5000 ||
          next.frames <= old.frames || next.delay < old.delay) return null;
      return 1000 * (next.delay - old.delay) / (next.frames - old.frames);
    },
  };
}

/** The receive duration excludes sender, network, Canvas and panel latency. */
export function formatPerformanceMonitor(codec, stats = {}, rtp = null, language = 'en') {
  const number = value => Number.isFinite(value) ? String(Math.round(value)) : '—';
  const zh = language === 'zh';
  const receive = rtp?.state === 'selected' && Number.isFinite(rtp.sampleAgeMs) && rtp.sampleAgeMs <= 5000 ? rtp : null;
  const counter = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const pre = counter(stats.preConfigDroppedFrames), local = counter(stats.transferDroppedFrames), main = counter(stats.mainTransferDroppedFrames), render = counter(stats.renderDroppedFrames);
  // These queues are distinct stages; keep the counters separate rather than assuming disjoint loss.
  const app = [pre, main, local, render].some(value => value !== null)
    ? zh ? `预 ${number(pre)} 入 ${number(main)} 出 ${number(local)} 绘制 ${number(render)}` : `pre ${number(pre)} in ${number(main)} out ${number(local)} render ${number(render)}` : '—';
  return `${codec} · ${number(stats.currentFps)} fps · ${zh ? '接收处理' : 'recv'} ${number(receive?.receiveProcessingMs)} ms · RTC ${number(counter(receive?.framesDropped))} / ${zh ? '应用' : 'app'} ${app} ${zh ? '丢帧' : 'drops'}`;
}
