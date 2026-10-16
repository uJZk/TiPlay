/*! SPDX-License-Identifier: GPL-3.0-only */
const MAX_RATE_ERROR = 0.001, MIN_SPAN_MS = 30000, HISTORY_MS = 120000;
const median = values => { const sorted = values.slice().sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };

/** Sampling oscillators and network queueing are different from the Android/browser clock. */
export class AudioSourceClock {
  constructor(nominalRate, { arrival = false } = {}) {
    this.nominalRate = nominalRate; this.arrival = arrival; this.points = [];
    this.targetRate = 1; this.rate = 1; this.confidence = 0; this.lastUpdate = null; this.lastFit = -Infinity;
  }
  observe(frame, timeMs, browserRate = 1) {
    if (!Number.isFinite(frame) || !Number.isFinite(timeMs)) return;
    const sampleMs = frame * 1000 / this.nominalRate;
    const point = { frameMs: sampleMs, timeMs, browserRate };
    const last = this.points.at(-1);
    if (last && (sampleMs <= last.frameMs || timeMs <= last.timeMs)) return;
    // Keep the fastest arrival within each source second: positive queueing is not oscillator drift.
    if (last && Math.floor(last.frameMs / 1000) === Math.floor(sampleMs / 1000)) {
      if (timeMs - sampleMs * browserRate < last.timeMs - last.frameMs * last.browserRate) this.points[this.points.length - 1] = point;
      return;
    }
    this.points.push(point);
    while (this.points.length > 130 || sampleMs - this.points[0].frameMs > HISTORY_MS) this.points.shift();
    if (sampleMs - this.lastFit < 1000) return;
    this.lastFit = sampleMs; this.fit();
  }
  fit() {
    const points = this.points, span = points.at(-1).frameMs - points[0].frameMs;
    if (span < MIN_SPAN_MS || points.length < 25) return;
    const slopes = [];
    for (let i = 0; i < points.length; i += 2) for (let j = i + 10; j < points.length; j += 3) {
      const dx = points[j].frameMs - points[i].frameMs;
      if (dx >= 10000) slopes.push((points[j].timeMs - points[i].timeMs) / dx);
    }
    if (!slopes.length) return;
    const slope = median(slopes), origin = points[0], intercept = median(points.map(p => (p.timeMs - origin.timeMs) - slope * (p.frameMs - origin.frameMs)));
    const residuals = points.map(p => Math.abs((p.timeMs - origin.timeMs) - slope * (p.frameMs - origin.frameMs) - intercept));
    const dispersion = median(residuals), candidate = (this.arrival ? median(points.map(p => p.browserRate)) : 1) / slope;
    // A queue step/ramp outside the oscillator range cannot reclassify itself as source clock drift.
    if (Math.abs(candidate - 1) > MAX_RATE_ERROR || dispersion > (this.arrival ? 1.5 : 0.5)) {
      this.confidence = 0; return;
    }
    this.targetRate = candidate;
    this.confidence = this.arrival ? 0.5 : 1;
  }
  advance(contextMs) {
    if (this.lastUpdate !== null) {
      const change = Math.max(0, contextMs - this.lastUpdate) / 1000 * 0.00001;
      this.rate += Math.max(-change, Math.min(change, this.targetRate - this.rate));
    }
    this.lastUpdate = contextMs; return this.rate;
  }
}
