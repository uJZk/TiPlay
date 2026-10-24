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
  let previousContext = null, previousTimestamp = null, pendingTimestamp = null, timestampNotBefore = -Infinity;
  let renderQuanta = new WeakMap();
  let renderCaptureAt = null, renderCandidateAt = -Infinity, renderProbeSequence = 0, renderProbe = null, renderDomain = null;
  let renderObservation = null, renderHistory = [], renderRateRange = null, fallbackAnchor = null;
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
    renderObservation = null; renderHistory = []; renderRateRange = null; fallbackAnchor = null;
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
    const selected = fresh(timestampClock) ? timestampClock : fresh(renderClock) && renderRateRange ? renderClock : null;
    if (deviceClock.lastAdvance !== null && at - deviceClock.lastAdvance > 1000)
      deviceClock.targetRate = deviceClock.rate;
    deviceClock.advance(at);
    if (selected) {
      selectedClock = selected; rateSource = selected === timestampClock ? 'native' : 'render';
      // A callback frontier occurred somewhere inside its causal interval.
      // Moving ACK latency can move midpoint fits without proving any drift.
      // Correct only the part of the applied rate excluded by every interval.
      deviceClock.targetRate = selected === renderClock
        ? Math.max(renderRateRange.minimum, Math.min(renderRateRange.maximum, deviceClock.rate)) : selected.targetRate;
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
  function stageRenderObservation(context, at) {
    if (renderCaptureAt !== null && (at < renderCaptureAt || at - renderCaptureAt > 1000)) {
      const reason = at < renderCaptureAt ? 'backwards' : 'gap';
      renderClock.reset(reason); deviceClock.reset(reason); clearRenderProbes();
      selectedClock = renderClock; rateSource = 'holdover';
    }
    renderCaptureAt = at;
    if (renderProbe && at - renderProbe.at > OUTPUT_REFERENCE_MAX_AGE_MS) {
      renderProbe = null; probeRejected('expired');
    }
    // Keep one request at the existing fit-point cadence. Only a returned
    // process frontier supplies the sample coordinate; the getter supplies none.
    if (!renderProbe && at - renderCandidateAt >= 100 && Number.isFinite(context.sampleRate) && context.sampleRate > 0) {
      renderCandidateAt = at;
      renderProbe = { token: ++renderProbeSequence, context, at,
        sampleRate: context.sampleRate, sent: false };
    }
  }
  function takeRenderProbe() {
    if (!renderProbe || renderProbe.sent) return null;
    const at = now();
    if (renderProbe.context !== previousContext || renderProbe.context?.state !== 'running'
      || at < renderProbe.at || at - renderProbe.at > OUTPUT_REFERENCE_MAX_AGE_MS) {
      renderProbe = null; probeRejected('expired'); return null;
    }
    renderProbe.sent = true; renderProbe.sentAt = at;
    return renderProbe.token;
  }
  function fitRenderIntervals() {
    let minimum = 1 - MAX_RATE_ERROR, maximum = 1 + MAX_RATE_ERROR, pairs = 0;
    for (let i = 0; i < renderHistory.length; i++) for (let j = i + 1; j < renderHistory.length; j++) {
      const first = renderHistory[i], last = renderHistory[j];
      const longest = last.latestAt - first.earliestAt, shortest = last.earliestAt - first.latestAt;
      if (shortest < 2000) continue;
      const framesMs = last.contextTimeMs - first.contextTimeMs;
      minimum = Math.max(minimum, framesMs / longest);
      maximum = Math.min(maximum, framesMs / shortest); pairs++;
    }
    renderRateRange = pairs && minimum <= maximum ? { minimum, maximum } : null;
  }
  function verifiedRender(context, at = now()) {
    const observation = renderObservation;
    return observation && observation.context === context && context?.state === 'running'
      && at >= observation.receivedAt && at - observation.earliestAt <= OUTPUT_REFERENCE_MAX_AGE_MS ? observation : null;
  }
  function acknowledgeRenderProbe(proof, context) {
    const candidate = renderProbe, at = now();
    if (!candidate || !proof || proof.token !== candidate.token || !candidate.sent) return;
    renderProbe = null;
    if (context !== candidate.context || context !== previousContext || context?.state !== 'running'
      || at < candidate.sentAt || at - candidate.sentAt > OUTPUT_REFERENCE_MAX_AGE_MS
      || ![proof.generation, proof.startFrame, proof.endFrame, proof.renderQuantumFrames].every(Number.isSafeInteger)
      || proof.generation < 0 || proof.startFrame < 0 || proof.endFrame <= proof.startFrame
      || proof.renderQuantumFrames < 1 || proof.renderQuantumFrames > proof.endFrame - proof.startFrame) {
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
        renderHistory = []; renderRateRange = null; renderObservation = null; fallbackAnchor = null;
        previousTimestamp = pendingTimestamp = null; timestampNotBefore = candidate.sentAt;
        timestampClock.reset('sample-domain', { preserveRate: true });
      }
      renderDomain = proof.generation;
    }
    if (renderObservation && (proof.startFrame !== renderObservation.startFrame || proof.endFrame <= renderObservation.endFrame)) {
      probeRejected('outside-run'); return;
    }
    observeRenderQuantum(context, proof.renderQuantumFrames);
    const quantumMs = proof.renderQuantumFrames * 1000 / candidate.sampleRate;
    // The callback observes the start of this block and reports its end. Reserve
    // one block beyond ACK receipt; neither request/response asymmetry nor that
    // logical frontier may be treated as an exact performance-clock sample.
    const earliestAt = candidate.sentAt, latestAt = at + quantumMs / (1 - MAX_RATE_ERROR);
    const point = { context, generation: proof.generation, startFrame: proof.startFrame, endFrame: proof.endFrame,
      contextTimeMs: proof.endFrame * 1000 / candidate.sampleRate, quantumMs,
      earliestAt, latestAt, performanceTimeMs: earliestAt + (latestAt - earliestAt) / 2,
      uncertaintyMs: (latestAt - earliestAt) / 2, receivedAt: at };
    renderObservation = point;
    renderHistory.push(point);
    while (renderHistory.length > 161 || point.earliestAt - renderHistory[0].earliestAt > 16000) renderHistory.shift();
    fitRenderIntervals();
    renderClock.observeRender(point.contextTimeMs, point.performanceTimeMs, point.earliestAt,
      2 * point.uncertaintyMs, proof.generation);
    if (debugEnabled) { renderProbeAccepted++; renderProbeReason = 'accepted'; }
    // The interval retains its request boundary; a delayed response cannot turn
    // its frontier into a point sampled at receipt.
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
  function plausibleNative(contextTimeMs, performanceTimeMs, render) {
    if (!render) return false;
    const earliest = performanceTimeMs - render.latestAt, latest = performanceTimeMs - render.earliestAt;
    const lower = render.contextTimeMs + earliest * (earliest < 0 ? 1 + MAX_RATE_ERROR : 1 - MAX_RATE_ERROR);
    const upper = render.contextTimeMs + latest * (latest < 0 ? 1 - MAX_RATE_ERROR : 1 + MAX_RATE_ERROR);
    return contextTimeMs <= upper + render.quantumMs
      && contextTimeMs >= lower - MAX_OUTPUT_LATENCY_MS * (1 + MAX_RATE_ERROR) - render.quantumMs;
  }
  function fallback(context, render, at, quantumMs) {
    if (!render) return unavailable('timestamp-invalid');
    const base = context.baseLatency, output = context.outputLatency;
    if (![base, output].every(value => Number.isFinite(value) && value >= 0)) return unavailable('missing-latency');
    const outputLatencyMs = (base + output) * 1000;
    if (outputLatencyMs > MAX_OUTPUT_LATENCY_MS) return unavailable('latency-unbounded');
    const sameRoute = fallbackAnchor && fallbackAnchor.generation === render.generation
      && Math.abs(fallbackAnchor.base - base) * 1000 <= quantumMs
      && Math.abs(fallbackAnchor.output - output) * 1000 <= quantumMs;
    if (!sameRoute) fallbackAnchor = { generation: render.generation, base, output,
      contextTimeMs: render.contextTimeMs, performanceTimeMs: render.performanceTimeMs + outputLatencyMs,
      deviceRate: deviceClock.rate, observedEndFrame: null };
    if (fallbackAnchor.observedEndFrame !== render.endFrame) {
      // Keep the chosen phase continuous when ACK asymmetry changes. A newer
      // causal interval can widen uncertainty without moving the audio cursor.
      fallbackAnchor.performanceTimeMs += (render.contextTimeMs - fallbackAnchor.contextTimeMs) / fallbackAnchor.deviceRate;
      fallbackAnchor.contextTimeMs = render.contextTimeMs; fallbackAnchor.deviceRate = deviceClock.rate;
      fallbackAnchor.observedEndFrame = render.endFrame;
      fallbackAnchor.uncertaintyMs = Math.max(
        Math.abs(fallbackAnchor.performanceTimeMs - (render.earliestAt + outputLatencyMs)),
        Math.abs(fallbackAnchor.performanceTimeMs - (render.latestAt + outputLatencyMs)));
    }
    diagnostics.outputState = 'latency-estimate';
    // Latency attributes are browser estimates, not a measured acoustic bound.
    // Reserve the complete probe interval and age/drift; never a getter quantum.
    return { contextTimeMs: fallbackAnchor.contextTimeMs, performanceTimeMs: fallbackAnchor.performanceTimeMs, at,
      outputMethod: 'latency-estimate', uncertaintyMs: fallbackAnchor.uncertaintyMs
        + Math.max(0, at - render.earliestAt) * MAX_RATE_ERROR,
      outputLatencyMs, deviceRate: deviceClock.rate };
  }

  function capture(context) {
    const startedAt = now();
    if (!context || context.state !== 'running') {
      if (previousTimestamp || renderClock.points.length || renderProbe || renderDomain !== null) resetClocks('suspended');
      previousTimestamp = pendingTimestamp = null;
      timestampNotBefore = startedAt;
      return unavailable('context-suspended');
    }
    if (context !== previousContext) { previousContext = context; previousTimestamp = pendingTimestamp = null;
      resetClocks('context'); }
    let timestamp;
    try { timestamp = context.getOutputTimestamp?.(); } catch (_) { /* Older implementations may throw. */ }
    // Native getters can block or yield a newer snapshot. Validate against clocks
    // sampled after that call, rather than misclassifying its result as future.
    let getter = null;
    if (debugEnabled) try { const value = context.currentTime * 1000; if (Number.isFinite(value)) getter = value; } catch (_) {}
    const at = now();
    observeRenderQuantum(context, context.renderQuantumSize);
    // Preserve the established 128-frame measurement allowance on smaller
    // blocks; larger observed blocks must expand it rather than be underbound.
    const quantumMs = Math.max(128, renderQuanta.get(context) || 0) * 1000
      / (Number.isFinite(context.sampleRate) && context.sampleRate > 0 ? context.sampleRate : 48000);
    Object.assign(diagnostics, { outputTimestampContextMs: null, outputTimestampPerformanceMs: null,
      outputTimestampAgeMs: null, outputRenderedContextMs: getter,
      outputTimestampCaptureMs: Math.max(0, at - startedAt), outputTimestampHoldoverAgeMs: null });
    if (context.state !== 'running') {
      previousTimestamp = pendingTimestamp = null; timestampNotBefore = at;
      resetClocks('suspended');
      return unavailable('context-suspended');
    }
    stageRenderObservation(context, at);
    // Staging can retire evidence after a real capture gap. Never use a local
    // frontier retained before that retirement to validate this native pair.
    const render = verifiedRender(context, at);
    const rendered = render ? render.contextTimeMs + (at - render.performanceTimeMs) * deviceClock.rate : null;
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
      const continuous = elapsed >= 0 && render && render.generation === previous.renderGeneration
        && render.endFrame >= previous.renderEndFrame;
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
      const fresh = timestamp.performanceTime > 0 && contextTimeMs >= 0 && plausibleNative(contextTimeMs, performanceTimeMs, render)
        && age >= -20 && age <= OUTPUT_REFERENCE_MAX_AGE_MS && performanceTimeMs >= timestampNotBefore;
      const ordered = !previousTimestamp || (contextTimeMs >= previousTimestamp.contextTimeMs
        && performanceTimeMs >= previousTimestamp.performanceTimeMs);
      const moved = !previousTimestamp || contextTimeMs !== previousTimestamp.contextTimeMs
        || performanceTimeMs !== previousTimestamp.performanceTimeMs;
      const candidate = { contextTimeMs, performanceTimeMs, at, rendered,
        renderGeneration: render?.generation, renderEndFrame: render?.endFrame,
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
        timestampClock.observe(contextTimeMs, performanceTimeMs, performanceTimeMs);
        if (timestampClock.generation !== timestampGeneration && timestampClock.reason === 'gap') {
          // A reference outage may hide a real rate change. Keep the baseline
          // gap reset; only native phase/offset steps retain render-rate evidence.
          deviceClock.reset('gap'); renderClock.reset('gap');
          // Native timestamp sampling can stop while process proofs continue.
          // Retire rate history without discarding a fresh actual frontier or
          // its unrelated in-flight request/receipt interval.
          renderHistory = []; renderRateRange = null;
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
    return fallback(context, render, at, quantumMs);
  }

  return {
    capture,
    observeRenderQuantum,
    takeRenderProbe,
    acknowledgeRenderProbe,
    renderObservation: context => {
      const at = now(), render = verifiedRender(context, at);
      return render ? { contextTimeMs: render.contextTimeMs, performanceTimeMs: render.performanceTimeMs,
        earliestAt: render.earliestAt, latestAt: render.latestAt, uncertaintyMs: render.uncertaintyMs,
        ageMs: at - render.earliestAt, generation: render.generation } : null;
    },
    debug: enabled => {
      debugEnabled = enabled === true;
      renderProbeAccepted = renderProbeRejected = renderDomainChanges = 0; renderProbeReason = null;
      renderClock.debug(enabled); timestampClock.debug(enabled);
    },
    deviceClock: () => rateSnapshot(now()),
    diagnostics: () => ({ ...diagnostics, outputFeedbackAgeMs: feedbackAt === null ? null : Math.max(0, now() - feedbackAt),
      outputTimestampFitUncertaintyMs: timestampClock.uncertaintyMs,
      outputTimestampFitPoints: timestampClock.points.length,
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
      const audibleTimeMs = mapping.performanceTimeMs + (feedback.contextTimeMs - mapping.contextTimeMs) / mapping.deviceRate;
      const render = verifiedRender(context, mapping.at);
      if (!render) return unavailable('output-unavailable');
      const renderSpan = feedback.contextTimeMs - render.contextTimeMs;
      // Freshness belongs to the actual rendered sample event, not ACK receipt
      // or its later audible time. Use the earliest causal event compatible
      // with the sample frontier and the permitted oscillator range.
      const eventAt = render.earliestAt + renderSpan / (renderSpan >= 0 ? 1 + MAX_RATE_ERROR : 1 - MAX_RATE_ERROR);
      const referenceAt = Math.min(mapping.at, eventAt);
      return { ...feedback, at: referenceAt, audibleTimeMs,
        mediaRate: feedback.mediaRate * mapping.deviceRate, deviceRatePpm: (mapping.deviceRate - 1) * 1e6,
        outputMethod: mapping.outputMethod, uncertaintyMs: mapping.uncertaintyMs
          + rateProjectionUncertainty(feedback.contextTimeMs - mapping.contextTimeMs, mapping.deviceRate)
          + Math.max(0, feedback.filterUncertaintyMs || 0),
        outputLatencyMs: mapping.outputLatencyMs };
    },
    reset() { previousContext = previousTimestamp = pendingTimestamp = null; renderQuanta = new WeakMap();
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
