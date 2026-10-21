/*! SPDX-License-Identifier: GPL-3.0-only */
const HISTORY_MS = 16000, MIN_SPAN_MS = 4000, MAX_POINTS = 161;
const MAX_RATE_ERROR = 0.02, SLEW_PER_SECOND = 0.001;
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Context samples per performance millisecond, independently of the server clock.
 * Only output timestamp pairs enter this fit: queue depth and latency estimates
 * are not oscillator measurements. A bounded robust fit tolerates device jitter.
 */
export class AudioDeviceClock {
  constructor() { this.generation = 0; this.reset('startup'); }
  reset(reason) {
    this.points = []; this.last = null; this.lastFit = -Infinity; this.lastAdvance = null;
    this.rate = this.targetRate = 1; this.confidence = 0; this.uncertaintyMs = null;
    this.acceptedFitAt = null; this.fitRejected = 0; this.fitStatus = 'acquiring'; this.fitRejectReason = 'none';
    this.generation++; this.reason = reason;
  }
  advance(at) {
    if (this.lastAdvance !== null) {
      const limit = Math.max(0, Math.min(1000, at - this.lastAdvance)) / 1000 * SLEW_PER_SECOND;
      this.rate += Math.max(-limit, Math.min(limit, this.targetRate - this.rate));
    }
    this.lastAdvance = at;
  }
  observe(contextTimeMs, performanceTimeMs, at = performanceTimeMs) {
    if (![contextTimeMs, performanceTimeMs, at].every(Number.isFinite)) return;
    const previous = this.last;
    if (previous && (contextTimeMs < previous.contextTimeMs || performanceTimeMs < previous.performanceTimeMs)) this.reset('backwards');
    else if (previous && performanceTimeMs - previous.performanceTimeMs > 1000) this.reset('gap');
    else if (previous && Math.abs(contextTimeMs - previous.contextTimeMs
      - (performanceTimeMs - previous.performanceTimeMs) * this.targetRate) > 40) this.reset('step');
    this.advance(at);
    if (this.last && (contextTimeMs <= this.last.contextTimeMs || performanceTimeMs <= this.last.performanceTimeMs)) return;
    this.last = { contextTimeMs, performanceTimeMs };
    const lastPoint = this.points.at(-1);
    if (lastPoint && performanceTimeMs - lastPoint.performanceTimeMs < 100) return;
    this.points.push(this.last);
    while (this.points.length > MAX_POINTS || performanceTimeMs - this.points[0].performanceTimeMs > HISTORY_MS) this.points.shift();
    if (performanceTimeMs - this.lastFit < 500) return;
    this.lastFit = performanceTimeMs;
    const points = this.points, origin = points[0], span = performanceTimeMs - origin.performanceTimeMs;
    if (span < MIN_SPAN_MS || points.length < 20) return;
    const slopes = [];
    for (let i = 0; i < points.length; i += 2) for (let j = i + 10; j < points.length; j += 3) {
      const elapsed = points[j].performanceTimeMs - points[i].performanceTimeMs;
      if (elapsed >= 2000) slopes.push((points[j].contextTimeMs - points[i].contextTimeMs) / elapsed);
    }
    if (!slopes.length) return;
    const rate = median(slopes), residuals = points.map(p => p.contextTimeMs - origin.contextTimeMs
      - (p.performanceTimeMs - origin.performanceTimeMs) * rate);
    const center = median(residuals.slice()), dispersion = median(residuals.map(value => Math.abs(value - center)));
    if (Math.abs(rate - 1) > MAX_RATE_ERROR || dispersion > 3) {
      this.confidence = 0; this.fitRejected++;
      this.fitStatus = this.acceptedFitAt === null ? 'acquiring' : 'holdover';
      this.fitRejectReason = Math.abs(rate - 1) > MAX_RATE_ERROR ? 'out-of-range' : 'noisy';
      return;
    }
    this.targetRate = rate; this.uncertaintyMs = dispersion;
    this.confidence = Math.min(1, span / 8000) / (1 + dispersion);
    this.acceptedFitAt = at; this.fitStatus = 'tracking'; this.fitRejectReason = 'none';
  }
  snapshot(at = this.lastAdvance) {
    return { rate: this.rate, ratePpm: (this.rate - 1) * 1e6, targetRatePpm: (this.targetRate - 1) * 1e6,
      confidence: this.confidence, uncertaintyMs: this.uncertaintyMs, generation: this.generation,
      reason: this.reason, points: this.points.length,
      ...(this.acceptedFitAt !== null && Number.isFinite(at) && at >= this.acceptedFitAt
        ? { acceptedFitAgeMs: at - this.acceptedFitAt } : {}),
      fitRejected: this.fitRejected, fitStatus: this.fitStatus, fitRejectReason: this.fitRejectReason };
  }
}
