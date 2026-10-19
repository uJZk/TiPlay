/*! SPDX-License-Identifier: GPL-3.0-only */
import { AudioDeviceClock } from './audio-device-clock.js';

export const OUTPUT_REFERENCE_MAX_AGE_MS = 750;
export const OUTPUT_EXTRAPOLATION_MAX_MS = 1000;
const MAX_OUTPUT_LATENCY_MS = 1000;

/** Map rendered context samples to the performance clock at the output device.
 * getOutputTimestamp already includes the destination/device pipeline. Its pair
 * must never have baseLatency or outputLatency added to it a second time.
 */
export function createAudioOutputMapping({ now = () => performance.timeOrigin + performance.now(),
  timeOrigin = () => performance.timeOrigin } = {}) {
  let previousContext = null, previousTimestamp = null, timestampNotBefore = -Infinity;
  const deviceClock = new AudioDeviceClock();
  let diagnostics = { outputState: 'startup' };
  let feedbackAt = null;
  let outputUnavailableCount = 0, outputUnavailableReason = null;
  const unavailableCounts = {};
  const rejected = reason => { outputUnavailableCount++; outputUnavailableReason = reason;
    unavailableCounts[reason] = (unavailableCounts[reason] || 0) + 1; };
  const unavailable = reason => { diagnostics.outputState = reason; rejected(reason); return null; };

  function capture(context) {
    const at = now();
    if (!context || context.state !== 'running' || !Number.isFinite(context.currentTime)) {
      if (previousTimestamp || deviceClock.points.length) deviceClock.reset('suspended');
      previousTimestamp = null;
      timestampNotBefore = at;
      return unavailable('context-suspended');
    }
    if (context !== previousContext) { previousContext = context; previousTimestamp = null; deviceClock.reset('context'); }
    deviceClock.advance(at);
    const rendered = context.currentTime * 1000;
    Object.assign(diagnostics, { outputTimestampContextMs: null, outputTimestampPerformanceMs: null,
      outputTimestampAgeMs: null, outputRenderedContextMs: rendered });
    let timestamp;
    try { timestamp = context.getOutputTimestamp?.(); } catch (_) { /* Older implementations may throw. */ }
    if (timestamp && Number.isFinite(timestamp.contextTime) && Number.isFinite(timestamp.performanceTime)) {
      const contextTimeMs = timestamp.contextTime * 1000;
      const performanceTimeMs = timeOrigin() + timestamp.performanceTime;
      const age = at - performanceTimeMs;
      Object.assign(diagnostics, { outputTimestampContextMs: contextTimeMs, outputTimestampPerformanceMs: performanceTimeMs,
        outputTimestampAgeMs: age });
      // Zero pairs are the specified startup/unavailable value. A held timestamp
      // cannot remain an output reference after suspend or a stalled device.
      const fresh = timestamp.performanceTime > 0 && contextTimeMs >= 0 && contextTimeMs <= rendered + 10
        && age >= -20 && age <= OUTPUT_REFERENCE_MAX_AGE_MS && performanceTimeMs >= timestampNotBefore;
      const ordered = !previousTimestamp || (contextTimeMs >= previousTimestamp.contextTimeMs
        && performanceTimeMs >= previousTimestamp.performanceTimeMs);
      if (fresh && ordered) {
        diagnostics.outputState = 'timestamp';
        deviceClock.observe(contextTimeMs, performanceTimeMs, at);
        previousTimestamp = { contextTimeMs, performanceTimeMs };
        return { ...previousTimestamp, at, outputMethod: 'timestamp', uncertaintyMs: 0,
          deviceRate: deviceClock.rate, outputLatencyMs: Math.max(0, (rendered - contextTimeMs) / deviceClock.rate) };
      }
      if (previousTimestamp) {
        if (!ordered) { previousTimestamp = null; deviceClock.reset('backwards'); }
        return unavailable(!ordered ? 'timestamp-backwards' : age > OUTPUT_REFERENCE_MAX_AGE_MS ? 'timestamp-stale' : 'timestamp-invalid');
      }
    }
    // These are distinct stages: destination -> host audio subsystem, then host
    // -> device. Missing outputLatency cannot bound the audible time; presenting
    // an active A/V stream then would silently assume a zero device delay.
    const base = context.baseLatency, output = context.outputLatency;
    if (![base, output].every(value => Number.isFinite(value) && value >= 0)) return unavailable('missing-latency');
    const outputLatencyMs = (base + output) * 1000;
    if (outputLatencyMs > MAX_OUTPUT_LATENCY_MS) return unavailable('latency-unbounded');
    diagnostics.outputState = 'latency-estimate';
    const quantumMs = 128000 / (Number.isFinite(context.sampleRate) && context.sampleRate > 0 ? context.sampleRate : 48000);
    return { contextTimeMs: rendered, performanceTimeMs: at + outputLatencyMs, at,
      outputMethod: 'latency-estimate', uncertaintyMs: quantumMs / deviceClock.rate, outputLatencyMs, deviceRate: deviceClock.rate };
  }

  return {
    capture,
    deviceClock: () => deviceClock.snapshot(),
    diagnostics: () => ({ ...diagnostics, outputFeedbackAgeMs: feedbackAt === null ? null : Math.max(0, now() - feedbackAt),
      outputUnavailableCount, outputUnavailableReason, outputUnavailableCounts: { ...unavailableCounts } }),
    reference(feedback, context) {
      if (!feedback || typeof feedback !== 'object') return null;
      const at = now(), unavailable = reason => ({ ...feedback, at, audibleTimeMs: null,
        playoutState: feedback.state, state: reason, outputMethod: null, uncertaintyMs: null });
      feedbackAt = at;
      diagnostics.outputFeedbackContextMs = Number.isFinite(feedback.contextTimeMs) ? feedback.contextTimeMs : null;
      diagnostics.outputFeedbackDeltaMs = null;
      if (feedback.state !== 'playing') return unavailable(feedback.state || 'output-unavailable');
      if (![feedback.contextTimeMs, feedback.sourceTimeMs, feedback.mediaRate].every(Number.isFinite)
        || feedback.mediaRate <= 0) { rejected('invalid-feedback'); return unavailable('output-unavailable'); }
      const mapping = capture(context);
      diagnostics.outputFeedbackDeltaMs = mapping ? (feedback.contextTimeMs - mapping.contextTimeMs) / mapping.deviceRate : null;
      if (!mapping || Math.abs(feedback.contextTimeMs - mapping.contextTimeMs) / mapping.deviceRate > OUTPUT_EXTRAPOLATION_MAX_MS) {
        if (mapping) { diagnostics.outputState = 'feedback-distance'; rejected('feedback-distance'); }
        return unavailable('output-unavailable');
      }
      // sourceTimeMs describes the content actually emitted at contextTimeMs;
      // the resampler's filter delay is already reflected in that content time.
      const renderAgeMs = Math.max(0, (context.currentTime * 1000 - feedback.contextTimeMs) / mapping.deviceRate);
      return { ...feedback, at: at - renderAgeMs, audibleTimeMs: mapping.performanceTimeMs + (feedback.contextTimeMs - mapping.contextTimeMs) / mapping.deviceRate,
        mediaRate: feedback.mediaRate * mapping.deviceRate, deviceRatePpm: (mapping.deviceRate - 1) * 1e6,
        outputMethod: mapping.outputMethod, uncertaintyMs: mapping.uncertaintyMs + Math.max(0, feedback.filterUncertaintyMs || 0),
        outputLatencyMs: mapping.outputLatencyMs };
    },
    reset() { previousContext = previousTimestamp = null; timestampNotBefore = now(); deviceClock.reset('reset');
      diagnostics = { outputState: 'reset' }; feedbackAt = null; },
  };
}

/** A short, centered extrapolation avoids epoch-sized arithmetic in A/V rate math. */
export function audibleTime(sourceTimeMs, reference, at) {
  if (!reference || reference.state !== 'playing' || ![sourceTimeMs, reference.sourceTimeMs,
    reference.audibleTimeMs, reference.mediaRate, reference.at].every(Number.isFinite)
    || reference.mediaRate <= 0 || at < reference.at || at - reference.at > OUTPUT_REFERENCE_MAX_AGE_MS) return null;
  const delta = (sourceTimeMs - reference.sourceTimeMs) / reference.mediaRate;
  if (Math.abs(delta) > OUTPUT_EXTRAPOLATION_MAX_MS) return null;
  return reference.audibleTimeMs + delta;
}

/** References belong to audio producers, independently of video configuration/loans. */
export function createAudioReferenceTimeline() {
  const references = new Map();
  return {
    update(reference) {
      if (reference === null) { references.clear(); return true; }
      if (!reference || typeof reference.mode !== 'string') return false;
      const key = `${reference.mode}:${reference.type}`, previous = references.get(key);
      const sameSequenceInvalidation = previous && reference.generation === previous.generation
        && reference.sequence === previous.sequence && reference.state !== 'playing' && reference.at >= previous.at;
      if (previous && (reference.generation < previous.generation || (reference.generation === previous.generation
        && (reference.sequence < previous.sequence || (reference.sequence === previous.sequence && !sameSequenceInvalidation))))) return false;
      const required = !(reference.mode === 'carplay' && reference.anchoring === 'arrival')
        && (reference.state === 'playing' || reference.playoutState === 'playing' || (previous?.required
          && !['disabled', 'ended', 'stopped'].includes(reference.state)));
      references.set(key, { ...reference, required });
      return true;
    },
    resolve(mode, sourceTimeMs, clockGeneration, at) {
      const candidates = [...references.values()].filter(value => value.mode === mode
        && !(mode === 'carplay' && value.anchoring === 'arrival')
        && !['disabled', 'ended', 'stopped'].includes(value.state));
      if (!candidates.length) return { state: 'video-only', required: false };
      // Media remains the reference while navigation/alerts are mixed over it.
      // Invalid media must not be disguised by a different guidance stream.
      const media = value => (value.semanticType ?? value.type) === 0 || value.type === 6;
      candidates.sort((a, b) => (media(a) ? 0 : 1) - (media(b) ? 0 : 1)
        || b.at - a.at);
      const reference = candidates[0];
      if (!reference.required && reference.state !== 'playing') return { state: reference.state, required: false, reference };
      if (reference.clockGeneration !== undefined && clockGeneration !== undefined
        && reference.clockGeneration !== clockGeneration) return { state: 'clock-generation', required: true, reference };
      const audioAt = audibleTime(sourceTimeMs, reference, at);
      if (audioAt === null) return { state: reference.state === 'playing' ? 'audio-reference-stale' : reference.state, required: true, reference };
      return { state: 'audio-output', required: true, reference, audioAt, uncertaintyMs: Math.max(0, reference.uncertaintyMs || 0) };
    },
  };
}
