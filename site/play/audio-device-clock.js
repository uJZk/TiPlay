/*! SPDX-License-Identifier: GPL-3.0-only */
const HISTORY_MS = 16000, MIN_SPAN_MS = 4000, MAX_POINTS = 161;
export const MAX_RATE_ERROR = 0.02;
const SLEW_PER_SECOND = 0.001;
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const centeredMedian = values => {
  values.sort((a, b) => a - b);
  return (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2;
};

/** Performance-time uncertainty when a context span is projected with a
 * gradually applied control rate, while the actual rate may occupy either
 * endpoint of the existing permitted range. The reciprocal matters at a switch
 * between opposite endpoints: 2% times distance would understate that case.
 */
export function rateProjectionUncertainty(contextSpanMs, appliedRate) {
  if (!Number.isFinite(contextSpanMs) || !Number.isFinite(appliedRate)
    || appliedRate < 1 - MAX_RATE_ERROR || appliedRate > 1 + MAX_RATE_ERROR) return Infinity;
  return Math.abs(contextSpanMs) * Math.max(Math.abs(1 / appliedRate - 1 / (1 - MAX_RATE_ERROR)),
    Math.abs(1 / appliedRate - 1 / (1 + MAX_RATE_ERROR)));
}

/** Context samples per performance millisecond, independently of the server clock.
 * A fit owns one measurement domain: output timestamps or running render-cursor
 * pairs. Queue depth and latency estimates are never rate measurements.
 */
export class AudioDeviceClock {
  constructor() { this.generation = 0; this.fitDiagnosticsEnabled = false; this.reset('startup'); }
  debug(enabled) { this.fitDiagnosticsEnabled = enabled === true; this.fitDispersionMs = null; }
  reset(reason, { preserveRate = false } = {}) {
    const appliedRate = preserveRate && Number.isFinite(this.rate)
      && this.rate >= 1 - MAX_RATE_ERROR && this.rate <= 1 + MAX_RATE_ERROR ? this.rate : 1;
    this.points = []; this.last = null; this.lastFit = -Infinity; this.lastAdvance = null;
    this.renderDomainGeneration = null;
    // A changed output-pipeline delay invalidates timestamp-fit evidence, not
    // the ongoing sample oscillator. Hold only the already applied correction;
    // an unachieved old target cannot keep steering a newly acquiring fit.
    this.rate = this.targetRate = appliedRate; this.confidence = 0; this.uncertaintyMs = null;
    this.acceptedFitAt = null; this.fitRejected = 0; this.fitStatus = 'acquiring'; this.fitRejectReason = 'none'; this.fitDispersionMs = null;
    this.generation++; this.reason = reason;
  }
  advance(at) {
    if (this.lastAdvance !== null) {
      const limit = Math.max(0, Math.min(1000, at - this.lastAdvance)) / 1000 * SLEW_PER_SECOND;
      this.rate += Math.max(-limit, Math.min(limit, this.targetRate - this.rate));
    }
    this.lastAdvance = at;
  }
  /** Rate-only render observations, admitted after the worklet has confirmed
   * their sample-domain generation. Main-thread currentTime getters can expose
   * several continuously rendered blocks together, so one render block cannot
   * bound the phase difference of two getter calls. The caller owns raw capture
   * gaps/backwards checks; admission delay is not a new sampling gap.
   */
  observeRender(contextTimeMs, performanceTimeMs, at, quantizationMs, domainGeneration) {
    if (![contextTimeMs, performanceTimeMs, at, quantizationMs].every(Number.isFinite)
      || quantizationMs <= 0 || !Number.isSafeInteger(domainGeneration) || domainGeneration < 0) return;
    if (this.renderDomainGeneration !== null) {
      if (domainGeneration < this.renderDomainGeneration) return;
      if (domainGeneration > this.renderDomainGeneration) this.reset('sample-domain', { preserveRate: true });
    }
    this.renderDomainGeneration = domainGeneration;
    if (this.last && (contextTimeMs <= this.last.contextTimeMs || performanceTimeMs <= this.last.performanceTimeMs
      || at < this.lastAdvance)) return;
    this.record(contextTimeMs, performanceTimeMs, at, quantizationMs);
  }
  observe(contextTimeMs, performanceTimeMs, at = performanceTimeMs, quantizationMs = 0) {
    if (![contextTimeMs, performanceTimeMs, at, quantizationMs].every(Number.isFinite) || quantizationMs < 0) return;
    const previous = this.last;
    const contextElapsed = previous && contextTimeMs - previous.contextTimeMs;
    const performanceElapsed = previous && performanceTimeMs - previous.performanceTimeMs;
    const quantized = quantizationMs > 0 || previous?.quantizationMs > 0;
    // Phase-bounded pairs use their explicit measurement interval. Main-thread
    // render getters instead enter observeRender after the sample-domain fence;
    // their batching cannot establish this short-pair phase bound.
    const stepped = previous && (quantized
      ? contextElapsed < performanceElapsed * (1 - MAX_RATE_ERROR) - quantizationMs
        || contextElapsed > performanceElapsed * (1 + MAX_RATE_ERROR) + (previous.quantizationMs || 0)
      : Math.abs(contextElapsed - performanceElapsed * this.targetRate) > 40);
    if (previous && (contextTimeMs < previous.contextTimeMs || performanceTimeMs < previous.performanceTimeMs)) this.reset('backwards');
    else if (previous && performanceElapsed > 1000) this.reset('gap');
    else if (stepped) this.reset('step', { preserveRate: quantized });
    this.record(contextTimeMs, performanceTimeMs, at, quantizationMs);
  }
  record(contextTimeMs, performanceTimeMs, at, quantizationMs) {
    this.advance(at);
    if (this.last && (contextTimeMs <= this.last.contextTimeMs || performanceTimeMs <= this.last.performanceTimeMs)) return;
    this.last = { contextTimeMs, performanceTimeMs, ...(quantizationMs > 0 ? { quantizationMs } : {}) };
    const lastPoint = this.points.at(-1);
    if (lastPoint && performanceTimeMs - lastPoint.performanceTimeMs < 100) return;
    this.points.push(this.last);
    while (this.points.length > MAX_POINTS || performanceTimeMs - this.points[0].performanceTimeMs > HISTORY_MS) this.points.shift();
    if (performanceTimeMs - this.lastFit < 500) return;
    this.lastFit = performanceTimeMs;
    this.fitDispersionMs = null;
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
    const halfQuantum = Math.max(...points.map(point => point.quantizationMs || 0)) / 2;
    // Use the usual midpoint convention for even quantized histories; an upper
    // median would make a balanced two-bin distribution invent a whole block of
    // MAD. Half a block reserves known measurement resolution, not rate accuracy.
    const residualMedian = halfQuantum > 0 ? centeredMedian : median;
    const center = residualMedian(residuals.slice()), dispersion = residualMedian(residuals.map(value => Math.abs(value - center)));
    // The rejected attempt's noise is distinct from the accepted fit uncertainty
    // used by playout. Debug starts without inventing a previous capture's MAD.
    if (this.fitDiagnosticsEnabled) this.fitDispersionMs = dispersion;
    const outOfRange = rate < 1 - MAX_RATE_ERROR || rate > 1 + MAX_RATE_ERROR;
    if (outOfRange || dispersion > 3 + halfQuantum) {
      this.confidence = 0; this.fitRejected++;
      this.fitStatus = this.acceptedFitAt === null ? 'acquiring' : 'holdover';
      this.fitRejectReason = outOfRange ? 'out-of-range' : 'noisy';
      return;
    }
    this.targetRate = rate; this.uncertaintyMs = dispersion + halfQuantum;
    this.confidence = Math.min(1, span / 8000) / (1 + this.uncertaintyMs);
    this.acceptedFitAt = at; this.fitStatus = 'tracking'; this.fitRejectReason = 'none';
  }
  snapshot(at = this.lastAdvance) {
    return { rate: this.rate, ratePpm: (this.rate - 1) * 1e6, targetRatePpm: (this.targetRate - 1) * 1e6,
      confidence: this.confidence, uncertaintyMs: this.uncertaintyMs, generation: this.generation,
      reason: this.reason, points: this.points.length,
      ...(this.acceptedFitAt !== null && Number.isFinite(at) && at >= this.acceptedFitAt
        ? { acceptedFitAgeMs: at - this.acceptedFitAt } : {}),
      ...(Number.isFinite(this.fitDispersionMs) ? { fitDispersionMs: this.fitDispersionMs } : {}),
      fitRejected: this.fitRejected, fitStatus: this.fitStatus, fitRejectReason: this.fitRejectReason };
  }
}
