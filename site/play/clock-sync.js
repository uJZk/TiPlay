/*! SPDX-License-Identifier: GPL-3.0-only */
const STALE_AFTER_MS = 15000;
const DEFAULTS = Object.freeze({
  maxSamples: 96, historyMs: 600000, bucketMs: 1000,
  minRateSamples: 8, minRateSpanMs: 60000, maxRatePpm: 2000,
  maxRateUncertaintyPpm: 75, jumpThresholdMs: 250, jumpSamples: 3, jumpSpanMs: 1000,
});

const absoluteNow = () => performance.timeOrigin + performance.now();
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Browser absolute monotonic milliseconds minus Android monotonic milliseconds.
 * This remains a single-observation compatibility API; use the estimator for playback.
 */
export function sampleClock(serverMs, start, end) {
  if (![serverMs, start, end].every(Number.isFinite) || end < start || end - start > 1000) return null;
  return { offset: start + (end - start) / 2 - serverMs, rtt: end - start, at: end };
}

/** Map a source anchor without imposing the live-presentation freshness window.
 * Snapshot rate is browser milliseconds per Android millisecond. Callers retain raw
 * source anchors: a calibration update must never turn packet boundaries into seeks.
 */
export function mapClockTime(serverMs, clock) {
  if (!Number.isFinite(serverMs) || !clock) return null;
  let mapped;
  if (clock.version === 2) {
    if (![clock.serverOriginMs, clock.localOriginMs, clock.rate].every(Number.isFinite) || clock.rate <= 0) return null;
    mapped = clock.localOriginMs + (serverMs - clock.serverOriginMs) * clock.rate;
  } else {
    if (!Number.isFinite(clock.offset)) return null;
    mapped = serverMs + clock.offset;
  }
  return Number.isFinite(mapped) ? mapped : null;
}

export function presentationTime(serverMs, clock, now = absoluteNow()) {
  if (!clock || !Number.isFinite(clock.at) || !Number.isFinite(now) || now - clock.at > STALE_AFTER_MS || now < clock.at) return null;
  const presentation = mapClockTime(serverMs, clock);
  return presentation !== null && Math.abs(now - presentation) <= 10000 ? presentation : null;
}

// Original implementation of bounded observation-window calibration and anchored
// affine conversion, the public concepts used by GStreamer's gstclock.c. Reference:
// https://github.com/GStreamer/gstreamer/blob/4f6d7395aef98e2411ef86c83f41e4c92b9a415e/subprojects/gstreamer/gst/gstclock.c
// No GStreamer implementation is copied. RTT filtering and robust regression below
// account for HTTP asymmetry: correlation of two large monotonic clocks alone cannot
// establish the much smaller rate error.
export function createClockEstimator(options = {}) {
  const config = { ...DEFAULTS, ...options };
  for (const value of Object.values(config)) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('Clock estimator limits must be positive finite numbers');
  }
  if (config.maxSamples < config.minRateSamples || config.maxSamples > 512 || config.jumpSamples < 2) {
    throw new RangeError('Invalid clock estimator history limits');
  }
  let history = [];
  let mapping = null;
  let lastObservation = null;
  let pendingJump = [];
  let pendingCalibration = [];
  let generation = 0;
  let resetReason = 'initial';
  let suspended = false;

  function reset(reason = 'explicit') {
    generation++;
    resetReason = reason;
    history = [];
    mapping = null;
    lastObservation = null;
    pendingJump = [];
    pendingCalibration = [];
  }

  function snapshot(now = absoluteNow()) {
    if (suspended || pendingJump.length || !mapping || !Number.isFinite(now) ||
        now < mapping.at || now - mapping.at > STALE_AFTER_MS) return null;
    return { ...mapping };
  }

  function calibrate() {
    // Low-delay observations across the whole bounded window, rather than only
    // the latest burst, separate network buffering noise from oscillator drift.
    const rtts = history.map(sample => sample.rtt).sort((a, b) => a - b);
    const minRtt = rtts[0];
    const rttLimit = rtts[Math.floor((rtts.length - 1) * 0.35)] + Math.max(2, minRtt * 0.5);
    let selected = history.filter(sample => sample.rtt <= rttLimit);
    const origin = selected[0];
    let points = selected.map(sample => {
      const x = sample.serverMs - origin.serverMs;
      return { ...sample, x, delta: (sample.localMs - origin.localMs) - x };
    });
    const span = points.at(-1).x - points[0].x;
    const slopes = [];
    // A robust pilot slope prevents a single low-RTT timestamp anomaly from
    // contaminating the least-squares fit. Short pairs only amplify jitter.
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const distance = points[j].x - points[i].x;
        if (distance >= Math.max(1000, span / 3)) slopes.push((points[j].delta - points[i].delta) / distance);
      }
    }
    const pilotSlope = slopes.length ? median(slopes) : 0;
    const pilotOffset = median(points.map(point => point.delta - point.x * pilotSlope));
    const residuals = points.map(point => point.delta - point.x * pilotSlope - pilotOffset);
    const deviation = median(residuals.map(Math.abs));
    const residualLimit = Math.max(2, 4 * 1.4826 * deviation);
    points = points.filter((point, i) => Math.abs(residuals[i]) <= residualLimit);
    // The median pilot always leaves at least one inlier.
    selected = points;

    const count = points.length;
    const xMean = points.reduce((sum, point) => sum + point.x, 0) / count;
    const dMean = points.reduce((sum, point) => sum + point.delta, 0) / count;
    let xx = 0, xd = 0;
    for (const point of points) {
      const centeredX = point.x - xMean;
      xx += centeredX * centeredX;
      xd += centeredX * (point.delta - dMean);
    }
    const measuredSlope = xx > 0 ? xd / xx : 0;
    const fitResiduals = points.map(point => point.delta - dMean - (point.x - xMean) * measuredSlope);
    const noiseMs = Math.max(0.02, Math.sqrt(fitResiduals.reduce((sum, value) => sum + value * value, 0) / Math.max(1, count - 2)));
    const rateUncertaintyPpm = xx > 0 ? noiseMs / Math.sqrt(xx) * 1e6 : null;
    const spanMs = points.at(-1).serverMs - points[0].serverMs;
    const rateReady = count >= config.minRateSamples && spanMs >= config.minRateSpanMs &&
      Math.abs(measuredSlope) * 1e6 <= config.maxRatePpm && rateUncertaintyPpm <= config.maxRateUncertaintyPpm;
    const rate = rateReady ? 1 + measuredSlope : (mapping?.rate ?? 1);
    const slope = rate - 1;
    // Estimate the offset at the newest origin with the accepted rate. All
    // products/accumulators use small deltas, never epoch-sized clock values.
    const newest = selected.at(-1);
    const offsetPoints = rateReady ? points : points.filter(point => newest.at - point.at <= 10000);
    const offsets = offsetPoints.map(point => point.delta - (point.x - newest.x) * slope);
    const offsetAtOrigin = median(offsets);
    const localAtOrigin = origin.localMs + newest.x + offsetAtOrigin;
    const uncertaintyMs = median(offsetPoints.map(point => point.rtt)) / 2 +
      Math.max(noiseMs, median(offsets.map(value => Math.abs(value - offsetAtOrigin))));
    mapping = {
      version: 2, generation, serverOriginMs: newest.serverMs, localOriginMs: localAtOrigin,
      rate, offset: localAtOrigin - newest.serverMs, rtt: minRtt, at: newest.at,
      offsetConfidence: 1 / (1 + uncertaintyMs / 10),
      rateConfidence: rateReady ? 1 / (1 + rateUncertaintyPpm / config.maxRateUncertaintyPpm) : 0,
      rateUncertaintyPpm, uncertaintyMs, sampleCount: count, historyCount: history.length,
      spanMs, state: rateReady ? 'tracking' : 'acquiring', resetReason,
    };
  }

  function observe(serverMs, start, end) {
    const sample = sampleClock(serverMs, start, end);
    if (!sample || suspended) return null;
    const observation = { serverMs, localMs: start + sample.rtt / 2, rtt: sample.rtt, at: end };
    if (lastObservation) {
      if (end < lastObservation.at) reset('local-backward');
      else if (end - lastObservation.at > STALE_AFTER_MS) reset('stale');
      else if (serverMs < lastObservation.serverMs - Math.max(2, sample.rtt + lastObservation.rtt)) reset('server-backward');
    }
    lastObservation = observation;
    if (mapping) {
      const error = observation.localMs - mapClockTime(serverMs, mapping);
      const jumpLimit = Math.max(config.jumpThresholdMs, mapping.uncertaintyMs * 8, (sample.rtt + mapping.rtt) / 2 + 8);
      const lowDelay = sample.rtt <= Math.max(mapping.rtt * 2, mapping.rtt + 8);
      if (Math.abs(error) > jumpLimit) {
        // A delayed/asymmetric reply must not become a seek or a large rate
        // correction. Confirm a coherent step with fresh low-delay probes.
        pendingCalibration = [];
        if (lowDelay) {
          const previous = pendingJump.at(-1);
          if (previous && Math.abs(error - previous.error) > Math.max(20, (sample.rtt + previous.rtt) / 2)) pendingJump = [];
          pendingJump.push({ ...observation, error });
          if (pendingJump.length >= config.jumpSamples && end - pendingJump[0].at >= config.jumpSpanMs) {
            const replacement = pendingJump;
            reset('clock-step');
            history = replacement;
            lastObservation = observation;
            calibrate();
            return snapshot(end);
          }
          pendingJump = pendingJump.slice(-config.jumpSamples);
        }
        return null;
      }
      // A confirmed small calibration change needs a fresh regression segment,
      // not a fictitious rate connecting the two phase plateaus. Preserve the
      // established rate and stream generation; playout slews this phase change.
      const phaseLimit = Math.max(8, mapping.uncertaintyMs * 4, (sample.rtt + mapping.rtt) / 2 + 4);
      if (lowDelay && mapping.rateConfidence > 0 && Math.abs(error) > phaseLimit) {
        const previous = pendingCalibration.at(-1);
        if (previous && Math.abs(error - previous.error) > Math.max(4, (sample.rtt + previous.rtt) / 2)) pendingCalibration = [];
        pendingCalibration.push({ ...observation, error });
        if (pendingCalibration.length >= config.jumpSamples && end - pendingCalibration[0].at >= config.jumpSpanMs) {
          history = pendingCalibration;
          pendingCalibration = [];
          pendingJump = [];
          calibrate();
          return snapshot(end);
        }
        pendingCalibration = pendingCalibration.slice(-config.jumpSamples);
      } else {
        pendingCalibration = [];
      }
    }
    pendingJump = [];
    history = history.filter(point => end - point.at <= config.historyMs);
    const previous = history.at(-1);
    if (previous && Math.floor(previous.at / config.bucketMs) === Math.floor(end / config.bucketMs)) {
      if (sample.rtt < previous.rtt) history[history.length - 1] = observation;
    } else {
      history.push(observation);
    }
    history = history.slice(-config.maxSamples);
    calibrate();
    return snapshot(end);
  }

  return {
    observe, snapshot, reset,
    suspend() { if (!suspended) { suspended = true; reset('suspend'); } },
    resume() { suspended = false; },
  };
}
