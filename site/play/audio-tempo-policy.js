// SPDX-License-Identifier: GPL-3.0-only
export const AUDIO_CATCH_UP_LIMIT = .2;
export const MANUAL_TEMPO_MIN = .25, MANUAL_TEMPO_MAX = 4;
export const EFFECTIVE_TEMPO_MIN = MANUAL_TEMPO_MIN * (1 - AUDIO_CATCH_UP_LIMIT);
export const EFFECTIVE_TEMPO_MAX = MANUAL_TEMPO_MAX * (1 + AUDIO_CATCH_UP_LIMIT);
export const TEMPO_POLICY = Object.freeze({ responseMs: 1000, derivativeMs: 400,
  sampleMs: 20, fullScaleRampMs: 2000, delayMargin: 2 });
export const VIDEO_SYNC_MIN_MS = -45, VIDEO_SYNC_MAX_MS = 125;
export const VIDEO_SYNC_TARGET_MS = (VIDEO_SYNC_MIN_MS + VIDEO_SYNC_MAX_MS) / 2;

/** User intent remains separate from the bounded synchronization multiplier. */
export function playbackTempo(manualRate, correction = 0) {
  if (!Number.isFinite(manualRate) || manualRate < MANUAL_TEMPO_MIN || manualRate > MANUAL_TEMPO_MAX || !Number.isFinite(correction))
    throw new RangeError('Invalid playback tempo.');
  return manualRate * (1 + Math.max(-AUDIO_CATCH_UP_LIMIT, Math.min(AUDIO_CATCH_UP_LIMIT, correction)));
}

/** Signed PD; no threshold episode, held tempo or accumulating integral. */
export function updateTempoCorrection(state, contextMs, quantumMs) {
  const previous = state.catchUpObservation;
  if (previous && contextMs === previous.contextMs) return state.catchUpCorrection || 0;
  const elapsed = previous && contextMs > previous.contextMs
    ? Math.min(2 * TEMPO_POLICY.sampleMs, contextMs - previous.contextMs) : quantumMs;
  // Normalize media-time error to playback time so 2x user tempo does not double loop gain.
  const manual = state.manualPlaybackRate || 1, error = state.phaseErrorMs / manual;
  const sample = state.catchUpTrendSample;
  if (!sample || contextMs < sample.contextMs || contextMs - sample.contextMs > TEMPO_POLICY.responseMs) {
    state.catchUpTrend = 0; state.catchUpTrendSample = { contextMs, errorMs: error };
  } else if (contextMs - sample.contextMs >= TEMPO_POLICY.sampleMs) {
    const dt = contextMs - sample.contextMs, change = error - sample.errorMs;
    const slopeLimit = AUDIO_CATCH_UP_LIMIT * 1000;
    // Reject phase steps outside the actuator's physical slope plus two quanta of jitter.
    if (Math.abs(change) > AUDIO_CATCH_UP_LIMIT * dt + 2 * quantumMs) state.catchUpTrend = 0;
    else {
      const slope = Math.max(-slopeLimit, Math.min(slopeLimit, change * 1000 / dt));
      state.catchUpTrend = (state.catchUpTrend || 0) + (-Math.expm1(-dt / TEMPO_POLICY.derivativeMs))
        * (slope - (state.catchUpTrend || 0));
    }
    state.catchUpTrendSample = { contextMs, errorMs: error };
  }
  // Preprocessed URL PCM delays a command; reduce gain using its measured queue horizon.
  state.responseHorizonMs = Math.max(TEMPO_POLICY.responseMs, TEMPO_POLICY.delayMargin * (state.controlDelayMs || 0));
  const desired = Math.max(-AUDIO_CATCH_UP_LIMIT, Math.min(AUDIO_CATCH_UP_LIMIT,
    (error + (state.catchUpTrend || 0) * TEMPO_POLICY.derivativeMs / 1000) / state.responseHorizonMs));
  const current = state.catchUpCorrection || 0, target = current * desired < 0 ? 0 : desired;
  const delta = AUDIO_CATCH_UP_LIMIT * elapsed / TEMPO_POLICY.fullScaleRampMs;
  state.catchUpCorrection = current + Math.max(-delta, Math.min(delta, target - current));
  state.catchUpObservation = { contextMs, errorMs: error };
  return state.catchUpCorrection;
}

/** A breach enables continuous PD around the window centre until pause/seek/reset. */
export function updateVideoTempoCorrection(state, skewMs, contextMs, quantumMs) {
  if (skewMs > VIDEO_SYNC_MAX_MS || skewMs < VIDEO_SYNC_MIN_MS) state.active = true;
  state.phaseErrorMs = state.active ? VIDEO_SYNC_TARGET_MS - skewMs : 0;
  return updateTempoCorrection(state, contextMs, quantumMs);
}
