/*! SPDX-License-Identifier: GPL-3.0-only */
import { AudioDeviceClock, MAX_RATE_ERROR, rateProjectionUncertainty } from './audio-device-clock.js';

export const OUTPUT_REFERENCE_MAX_AGE_MS = 750;
export const OUTPUT_EXTRAPOLATION_MAX_MS = 1000;
const MAX_OUTPUT_LATENCY_MS = 1000;

/** Map rendered context samples to the performance clock at the output device.
 * getOutputTimestamp already includes the destination/device pipeline. Its pair
 * must never have baseLatency or outputLatency added to it a second time.
 */
export function createAudioOutputMapping({ now = () => performance.timeOrigin + performance.now(),
  timeOrigin = () => performance.timeOrigin } = {}) {
  let previousContext = null, previousTimestamp = null, pendingTimestamp = null, previousRendered = null, timestampNotBefore = -Infinity;
  let renderQuanta = new WeakMap();
  let renderCaptureAt = null, renderCandidateAt = -Infinity, renderProbeSequence = 0, renderProbe = null, renderDomain = null;
  let debugEnabled = false, renderProbeAccepted = 0, renderProbeRejected = 0, renderDomainChanges = 0, renderProbeReason = null;
  // One controller owns the applied slew. Fits may choose its target without
  // switching two already-applied rates or steering from an unachieved old fit.
  const deviceClock = new AudioDeviceClock();
  const renderClock = new AudioDeviceClock();
  // A native pair locates an output sample at the speaker; a render pair tracks
  // effective progress of the context sample domain. Native pipeline offsets
  // must not repeatedly erase the latter's independently advancing evidence.
  // Keep native noise separate so render quantization cannot widen phase gates.
  const timestampClock = new AudioDeviceClock();
  let selectedClock = renderClock, rateSource = 'holdover';
  let diagnostics = { outputState: 'startup' };
  let feedbackAt = null;
  let outputUnavailableCount = 0, outputUnavailableReason = null;
  const unavailableCounts = {};
  const rejected = reason => { outputUnavailableCount++; outputUnavailableReason = reason;
    unavailableCounts[reason] = (unavailableCounts[reason] || 0) + 1; };
  const unavailable = reason => { diagnostics.outputState = reason; rejected(reason); return null; };
  function clearRenderProbes() {
    renderProbe = null; renderDomain = null; renderCandidateAt = -Infinity; renderCaptureAt = null;
    // Tokens are never reused, including across reset in the same live node.
  }
  function resetClocks(reason) {
    deviceClock.reset(reason); renderClock.reset(reason); timestampClock.reset(reason);
    clearRenderProbes();
    selectedClock = renderClock; rateSource = 'holdover';
  }
  function selectRate(at) {
    const fresh = clock => clock.fitStatus === 'tracking' && clock.acceptedFitAt !== null
      && at >= clock.acceptedFitAt && at - clock.acceptedFitAt <= OUTPUT_REFERENCE_MAX_AGE_MS;
    const selected = fresh(timestampClock) ? timestampClock : fresh(renderClock) ? renderClock : null;
    if (deviceClock.lastAdvance !== null && at - deviceClock.lastAdvance > 1000)
      deviceClock.targetRate = deviceClock.rate;
    deviceClock.advance(at);
    if (selected) {
      selectedClock = selected; rateSource = selected === timestampClock ? 'native' : 'render';
      deviceClock.targetRate = selected.targetRate;
    } else { rateSource = 'holdover'; deviceClock.targetRate = deviceClock.rate; }
  }
  function rateSnapshot(at) {
    const evidence = selectedClock.snapshot(at);
    return { ...evidence, source: rateSource, rate: deviceClock.rate, ratePpm: (deviceClock.rate - 1) * 1e6,
      targetRatePpm: (deviceClock.targetRate - 1) * 1e6, generation: renderClock.generation, reason: renderClock.reason,
      ...(rateSource === 'holdover' ? { confidence: 0, fitStatus: selectedClock.acceptedFitAt === null ? 'acquiring' : 'holdover' } : {}) };
  }
  function observeRenderQuantum(context, frames) {
    if (!context || typeof context !== 'object' || !Number.isSafeInteger(frames) || frames <= 0) return;
    // The render block can change. Keep the largest observation in this context
    // so a smaller later block cannot understate quantization/holdover error.
    renderQuanta.set(context, Math.max(renderQuanta.get(context) || 0, frames));
  }
  function probeRejected(reason) {
    if (debugEnabled) { renderProbeRejected++; renderProbeReason = reason; }
  }
  function stageRenderObservation(context, rendered, at, quantumMs) {
    if (renderCaptureAt !== null && (at < renderCaptureAt || at - renderCaptureAt > 1000)) {
      const reason = at < renderCaptureAt ? 'backwards' : 'gap';
      renderClock.reset(reason); deviceClock.reset(reason); clearRenderProbes();
      selectedClock = renderClock; rateSource = 'holdover';
    }
    renderCaptureAt = at;
    if (renderProbe && at - renderProbe.at > OUTPUT_REFERENCE_MAX_AGE_MS) {
      renderProbe = null; probeRejected('expired');
    }
    // Keep one candidate at the existing fit-point cadence. A render block is
    // not the resolution of the asynchronously published main-thread getter.
    if (!renderProbe && at - renderCandidateAt >= 100 && Number.isFinite(context.sampleRate) && context.sampleRate > 0) {
      renderCandidateAt = at;
      renderProbe = { token: ++renderProbeSequence, context, contextTimeMs: rendered, at, quantumMs,
        sampleRate: context.sampleRate, domain: renderDomain, sent: false };
    }
  }
  function takeRenderProbe() {
    if (!renderProbe || renderProbe.sent) return null;
    renderProbe.sent = true;
    return renderProbe.token;
  }
  function acknowledgeRenderProbe(proof, context) {
    const candidate = renderProbe, at = now();
    if (!candidate || !proof || proof.token !== candidate.token || !candidate.sent) return;
    renderProbe = null;
    if (context !== candidate.context || context !== previousContext || context?.state !== 'running'
      || at < candidate.at || at - candidate.at > OUTPUT_REFERENCE_MAX_AGE_MS
      || ![proof.generation, proof.startFrame, proof.endFrame].every(Number.isSafeInteger)
      || proof.generation < 0 || proof.startFrame < 0 || proof.endFrame <= proof.startFrame) {
      probeRejected('invalid-proof'); return;
    }
    if (renderDomain !== null && proof.generation < renderDomain) { probeRejected('old-domain'); return; }
    if (proof.generation !== renderDomain) {
      if (renderDomain !== null) {
        renderClock.reset('sample-domain', { preserveRate: true });
        // Retiring render evidence cannot leave its unachieved target steering
        // the controller until another capture. Current native evidence may
        // independently supply a target below.
        if (rateSource === 'render') deviceClock.targetRate = deviceClock.rate;
        if (debugEnabled) renderDomainChanges++;
      }
      renderDomain = proof.generation;
      probeRejected('domain-acquiring'); selectRate(at); return;
    }
    const frame = candidate.contextTimeMs * candidate.sampleRate / 1000;
    // Only representational roundoff is allowed at the run endpoints. A later
    // frontier alone cannot grant an old candidate a different sample domain.
    const tolerance = Number.EPSILON * Math.abs(frame) + Number.EPSILON * proof.endFrame;
    if (candidate.domain !== proof.generation || frame < proof.startFrame - tolerance || frame > proof.endFrame + tolerance) {
      probeRejected('outside-run'); return;
    }
    renderClock.observeRender(candidate.contextTimeMs, candidate.at, candidate.at, candidate.quantumMs, proof.generation);
    if (debugEnabled) { renderProbeAccepted++; renderProbeReason = 'accepted'; }
    // The original observation time determines freshness, never port arrival.
    selectRate(at);
  }
  function comparePairs(previous, next, quantumMs) {
    const elapsedMs = next.performanceTimeMs - previous.performanceTimeMs;
    const innovationMs = (next.contextTimeMs - previous.contextTimeMs) / deviceClock.rate - elapsedMs;
    const withinSpan = Math.abs(elapsedMs) <= OUTPUT_REFERENCE_MAX_AGE_MS;
    return { innovationMs, withinSpan, coherent: withinSpan
      && Math.abs(innovationMs) <= (quantumMs + (timestampClock.uncertaintyMs || 0)) / deviceClock.rate
        + Math.abs(elapsedMs) * MAX_RATE_ERROR };
  }
  function compatiblePhysicalRate(previous, next, quantumMs) {
    const elapsedMs = next.performanceTimeMs - previous.performanceTimeMs;
    // Reacquisition cannot assume the old oscillator still applies. Use the
    // same permitted rate range as the fit, plus the existing measurement bound.
    return elapsedMs > 0 && elapsedMs <= OUTPUT_REFERENCE_MAX_AGE_MS
      && Math.abs(next.contextTimeMs - previous.contextTimeMs - elapsedMs)
        <= quantumMs + (timestampClock.uncertaintyMs || 0) + elapsedMs * MAX_RATE_ERROR;
  }

  function capture(context) {
    const startedAt = now();
    if (!context || context.state !== 'running' || !Number.isFinite(context.currentTime)) {
      if (previousTimestamp || renderClock.points.length || renderProbe || renderDomain !== null) resetClocks('suspended');
      previousTimestamp = pendingTimestamp = previousRendered = null;
      timestampNotBefore = startedAt;
      return unavailable('context-suspended');
    }
    if (context !== previousContext) { previousContext = context; previousTimestamp = pendingTimestamp = previousRendered = null;
      resetClocks('context'); }
    let timestamp;
    try { timestamp = context.getOutputTimestamp?.(); } catch (_) { /* Older implementations may throw. */ }
    // Native getters can block or yield a newer snapshot. Validate against clocks
    // sampled after that call, rather than misclassifying its result as future.
    const rendered = context.currentTime * 1000, at = now();
    observeRenderQuantum(context, context.renderQuantumSize);
    // Preserve the established 128-frame measurement allowance on smaller
    // blocks; larger observed blocks must expand it rather than be underbound.
    const quantumMs = Math.max(128, renderQuanta.get(context) || 0) * 1000
      / (Number.isFinite(context.sampleRate) && context.sampleRate > 0 ? context.sampleRate : 48000);
    Object.assign(diagnostics, { outputTimestampContextMs: null, outputTimestampPerformanceMs: null,
      outputTimestampAgeMs: null, outputRenderedContextMs: rendered,
      outputTimestampCaptureMs: Math.max(0, at - startedAt), outputTimestampHoldoverAgeMs: null });
    if (context.state !== 'running' || !Number.isFinite(rendered)) {
      previousTimestamp = pendingTimestamp = previousRendered = null; timestampNotBefore = at;
      resetClocks('suspended');
      return unavailable('context-suspended');
    }
    if (previousRendered !== null && rendered < previousRendered) {
      // Unlike a backward output measurement, a backward render cursor really
      // retires the old sample domain. The worklet observes its own counter too.
      previousTimestamp = pendingTimestamp = null; timestampNotBefore = at;
      resetClocks('context-backwards');
    }
    previousRendered = rendered;
    // A later process acknowledgement proves that the candidate stayed inside
    // one continuous worklet frame domain. Port arrival is not a clock sample.
    stageRenderObservation(context, rendered, at, quantumMs);
    selectRate(at);
    const holdover = (reason = null, candidate = null) => {
      if (reason) rejected(reason);
      diagnostics.outputState = reason || 'timestamp-holdover';
      const refuse = () => reason ? null : unavailable('timestamp-invalid');
      const previous = previousTimestamp;
      if (!previous) return refuse();
      // A known pipeline contradiction retires trust in the old anchor until
      // advancing native samples establish a mapping again, even if the driver
      // briefly returns that old snapshot among its newer samples.
      if (pendingTimestamp) {
        if (candidate) pendingTimestamp = candidate;
        return refuse();
      }
      const age = at - previous.performanceTimeMs, elapsed = at - previous.at;
      const unchangedLatency = name => !reason && context[name] === undefined && previous[name] === undefined
        || Number.isFinite(context[name]) && Number.isFinite(previous[name])
          && Math.abs(context[name] - previous[name]) * 1000 <= quantumMs;
      const continuous = elapsed >= 0 && rendered >= previous.rendered
        && Math.abs(rendered - previous.rendered - elapsed * deviceClock.rate) <= 40;
      if (age < -20 || age > OUTPUT_REFERENCE_MAX_AGE_MS || !continuous
        || !unchangedLatency('baseLatency') || !unchangedLatency('outputLatency')) {
        if (candidate) pendingTimestamp = candidate;
        return refuse();
      }
      let innovationMs = 0;
      if (timestamp && timestamp.performanceTime > 0 && Number.isFinite(timestamp.contextTime)
        && Number.isFinite(timestamp.performanceTime)) {
        const relation = comparePairs(previous, { contextTimeMs: timestamp.contextTime * 1000,
          performanceTimeMs: timeOrigin() + timestamp.performanceTime }, quantumMs);
        innovationMs = relation.innovationMs;
        // Continuous rendering and unchanged latency attributes do not establish
        // an unchanged speaker pipeline. A contradictory native pair may be a
        // real latency step; only a nearby pair consistent with the old mapping
        // can justify holding it, with that disagreement reserved as uncertainty.
        if (!relation.coherent) {
          if (candidate) pendingTimestamp = candidate;
          return refuse();
        }
      }
      diagnostics.outputState = 'timestamp-holdover'; diagnostics.outputTimestampHoldoverAgeMs = Math.max(0, age);
      return { contextTimeMs: previous.contextTimeMs, performanceTimeMs: previous.performanceTimeMs, at,
        outputMethod: 'timestamp-holdover',
        // This is static native measurement uncertainty. Rate uncertainty over
        // the held anchor's actual projection distance is added by each caller;
        // adding age*rate here too would count the same interval twice.
        uncertaintyMs: (quantumMs + (timestampClock.uncertaintyMs || 0)) / deviceClock.rate
          + Math.abs(innovationMs),
        deviceRate: deviceClock.rate, outputLatencyMs: Math.max(0, (rendered - previous.contextTimeMs) / deviceClock.rate - age) };
    };
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
      const moved = !previousTimestamp || contextTimeMs !== previousTimestamp.contextTimeMs
        || performanceTimeMs !== previousTimestamp.performanceTimeMs;
      const candidate = { contextTimeMs, performanceTimeMs, at, rendered,
        baseLatency: context.baseLatency, outputLatency: context.outputLatency };
      const previousAgeMs = previousTimestamp ? at - previousTimestamp.performanceTimeMs : Infinity;
      const previousFresh = previousAgeMs >= -20 && previousAgeMs <= OUTPUT_REFERENCE_MAX_AGE_MS;
      let confirmed = false, outputStep = false, preserveDeviceRate = false;
      if (fresh && pendingTimestamp) {
        // A contradiction needs two new advancing samples, even when both
        // coordinates happen to be ahead of the last trusted pair. Repeated
        // snapshots cannot confirm a route or refresh its pending evidence.
        const pendingAgeMs = at - pendingTimestamp.performanceTimeMs;
        confirmed = moved && pendingTimestamp.performanceTimeMs > previousTimestamp.performanceTimeMs
          && pendingAgeMs >= -20 && pendingAgeMs <= OUTPUT_REFERENCE_MAX_AGE_MS
          && contextTimeMs > pendingTimestamp.contextTimeMs && performanceTimeMs > pendingTimestamp.performanceTimeMs
          && compatiblePhysicalRate(pendingTimestamp, candidate, quantumMs);
        if (!confirmed) {
          if (moved && performanceTimeMs > previousTimestamp.performanceTimeMs
            && performanceTimeMs > pendingTimestamp.performanceTimeMs)
            pendingTimestamp = candidate;
          return unavailable('timestamp-discontinuity');
        }
        // A confirmed new rate must retire an incompatible old oscillator fit,
        // including after reference expiry. Expiry alone is not a rate change.
        const previousRelation = comparePairs(previousTimestamp, candidate, quantumMs);
        preserveDeviceRate = comparePairs(pendingTimestamp, candidate, quantumMs).coherent;
        outputStep = !preserveDeviceRate
          || previousFresh && previousRelation.withinSpan && !previousRelation.coherent;
      } else if (fresh && ordered && moved && previousTimestamp
        && (!previousFresh || !comparePairs(previousTimestamp, candidate, quantumMs).coherent)) {
        pendingTimestamp = candidate;
        return unavailable('timestamp-discontinuity');
      }
      // A real pipeline increase can put both new output samples below the old
      // counter. Their own coherent advance establishes that changed mapping.
      if (fresh && (ordered || confirmed)) {
        if (outputStep) timestampClock.reset('output-step', { preserveRate: preserveDeviceRate });
        if (!moved) return holdover();
        diagnostics.outputState = 'timestamp';
        const timestampGeneration = timestampClock.generation;
        timestampClock.observe(contextTimeMs, performanceTimeMs, at);
        if (timestampClock.generation !== timestampGeneration && timestampClock.reason === 'gap') {
          // A reference outage may hide a real rate change. Keep the baseline
          // gap reset; only native phase/offset steps retain render-rate evidence.
          deviceClock.reset('gap'); renderClock.reset('gap');
          clearRenderProbes();
          selectedClock = renderClock; rateSource = 'holdover';
        }
        selectRate(at);
        previousTimestamp = candidate;
        pendingTimestamp = null;
        return { contextTimeMs, performanceTimeMs, at, outputMethod: 'timestamp', uncertaintyMs: 0,
          deviceRate: deviceClock.rate, outputLatencyMs: Math.max(0, (rendered - contextTimeMs) / deviceClock.rate) };
      }
      if (previousTimestamp) {
        return holdover(!ordered ? 'timestamp-backwards' : age > OUTPUT_REFERENCE_MAX_AGE_MS ? 'timestamp-stale' : 'timestamp-invalid',
          fresh && performanceTimeMs > previousTimestamp.performanceTimeMs ? { contextTimeMs, performanceTimeMs } : null);
      }
    }
    if (previousTimestamp) return holdover('timestamp-invalid');
    // These are distinct stages: destination -> host audio subsystem, then host
    // -> device. Missing outputLatency cannot bound the audible time; presenting
    // an active A/V stream then would silently assume a zero device delay.
    const base = context.baseLatency, output = context.outputLatency;
    if (![base, output].every(value => Number.isFinite(value) && value >= 0)) return unavailable('missing-latency');
    const outputLatencyMs = (base + output) * 1000;
    if (outputLatencyMs > MAX_OUTPUT_LATENCY_MS) return unavailable('latency-unbounded');
    diagnostics.outputState = 'latency-estimate';
    return { contextTimeMs: rendered, performanceTimeMs: at + outputLatencyMs, at,
      outputMethod: 'latency-estimate', uncertaintyMs: quantumMs / deviceClock.rate, outputLatencyMs, deviceRate: deviceClock.rate };
  }

  return {
    capture,
    observeRenderQuantum,
    takeRenderProbe,
    acknowledgeRenderProbe,
    debug: enabled => {
      debugEnabled = enabled === true;
      renderProbeAccepted = renderProbeRejected = renderDomainChanges = 0; renderProbeReason = null;
      renderClock.debug(enabled); timestampClock.debug(enabled);
    },
    deviceClock: () => rateSnapshot(now()),
    diagnostics: () => ({ ...diagnostics, outputFeedbackAgeMs: feedbackAt === null ? null : Math.max(0, now() - feedbackAt),
      outputTimestampFitUncertaintyMs: timestampClock.uncertaintyMs,
      outputTimestampFitStatus: timestampClock.fitStatus, outputTimestampFitGeneration: timestampClock.generation,
      renderClockDomainGeneration: renderDomain,
      renderClockProbeState: renderProbe ? renderProbe.sent ? 'waiting-ack' : 'pending' : 'idle',
      ...(renderProbe ? { renderClockProbeAgeMs: Math.max(0, now() - renderProbe.at) } : {}),
      renderClockProbeAccepted: renderProbeAccepted, renderClockProbeRejected: renderProbeRejected,
      renderClockProbeReason: renderProbeReason, renderClockDomainChanges: renderDomainChanges,
      outputUnavailableCount, outputUnavailableReason, outputUnavailableCounts: { ...unavailableCounts } }),
    reference(feedback, context) {
      if (!feedback || typeof feedback !== 'object') return null;
      observeRenderQuantum(context, feedback.renderQuantumFrames);
      observeRenderQuantum(context, feedback.renderQuantumMaxFrames);
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
      return { ...feedback, at: mapping.at - renderAgeMs, audibleTimeMs: mapping.performanceTimeMs + (feedback.contextTimeMs - mapping.contextTimeMs) / mapping.deviceRate,
        mediaRate: feedback.mediaRate * mapping.deviceRate, deviceRatePpm: (mapping.deviceRate - 1) * 1e6,
        outputMethod: mapping.outputMethod, uncertaintyMs: mapping.uncertaintyMs
          + rateProjectionUncertainty(feedback.contextTimeMs - mapping.contextTimeMs, mapping.deviceRate)
          + Math.max(0, feedback.filterUncertaintyMs || 0),
        outputLatencyMs: mapping.outputLatencyMs };
    },
    reset() { previousContext = previousTimestamp = pendingTimestamp = previousRendered = null; renderQuanta = new WeakMap();
      timestampNotBefore = now(); resetClocks('reset');
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
