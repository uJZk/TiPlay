/*! SPDX-License-Identifier: GPL-3.0-only */
export const INITIAL_MEDIA_DELAY = 60;
export const MAX_MEDIA_DELAY = 500;
// These are bounded scheduling policies, not measured end-to-end guarantees.
// URL casting has a receiver-owned media clock and can prebuffer; live media
// retains the independently measured sender-relative deadline.
export const PLAYBACK_PROFILES = Object.freeze({
  'carplay-touch': Object.freeze({ name: 'carplay-touch', maxDelayMs: 300, initialDelayMs: 0,
    jitterMarginMs: 8, readinessDecay: 0.05, videoDecreaseRate: 0.25,
    maxVideoFrames: 24, maxVideoBytes: 64 * 1024 * 1024, interactionHoldMs: 750 }),
  carplay: Object.freeze({ name: 'carplay', maxDelayMs: 300, initialDelayMs: 0,
    jitterMarginMs: 20, readinessDecay: 0.01, videoDecreaseRate: 0.02,
    maxVideoFrames: 24, maxVideoBytes: 64 * 1024 * 1024, interactionHoldMs: 750 }),
  'airplay-mirror': Object.freeze({ name: 'airplay-mirror', maxDelayMs: 300, initialDelayMs: 40,
    jitterMarginMs: 30, readinessDecay: 0.005, videoDecreaseRate: 0.01,
    maxVideoFrames: 24, maxVideoBytes: 64 * 1024 * 1024 }),
  'airplay-cast': Object.freeze({ name: 'airplay-cast', maxDelayMs: 3000, initialDelayMs: 750,
    jitterMarginMs: 100, readinessDecay: 0.005, videoDecreaseRate: 0.005,
    startupBufferMs: 750, resumeBufferMs: 1500, maxVideoAheadMs: 2000, maxAudioAheadMs: 3000,
    maxVideoFrames: 32, maxVideoBytes: 96 * 1024 * 1024 }),
  default: Object.freeze({ name: 'default', maxDelayMs: MAX_MEDIA_DELAY, initialDelayMs: INITIAL_MEDIA_DELAY,
    jitterMarginMs: 20, readinessDecay: 0.005, videoDecreaseRate: 0.005,
    maxVideoFrames: 24, maxVideoBytes: 64 * 1024 * 1024 }),
});
export function playbackProfile(mode, interacting = false) {
  return PLAYBACK_PROFILES[mode === 'carplay' && interacting ? 'carplay-touch' : mode] ?? PLAYBACK_PROFILES.default;
}
export const MEDIA_DELAY_LIMITS = Object.freeze(Object.fromEntries(
  Object.entries(PLAYBACK_PROFILES).filter(([key]) => key !== 'default').map(([key, value]) => [key, value.maxDelayMs])));
const PLAN_HISTORY_MS = 125;
export const DELAY_PLAN_LEAD_MS = 85;

export function constantDelay(value = INITIAL_MEDIA_DELAY, at = 0) {
  return { from: value, to: value, at, duration: 0 };
}

/** Pure absolute-clock mapping shared by the presenter and every audio sample. */
export function delayAt(plan, time) {
  if (time < plan.at && plan.previous) return delayAt(plan.previous, time);
  let progress = plan.duration > 0 ? Math.max(0, Math.min(1, (time - plan.at) / plan.duration)) : 1;
  if (plan.smooth) progress = progress * progress * progress * (10 + progress * (-15 + progress * 6));
  return plan.from + (plan.to - plan.from) * progress;
}

function remainingPlan(plan, now) {
  const { previous, ...current } = plan;
  if (plan.at > now && previous) current.previous = remainingPlan(previous, now);
  return current;
}

/** A future activation lets both execution contexts receive the same continuous plan. */
export function planDelay(previous, target, now, { leadMs = DELAY_PLAN_LEAD_MS,
  increaseRate = 0.02, decreaseRate = 0.005, smooth = false } = {}) {
  const at = now + leadMs, from = delayAt(previous, at);
  const rate = target > from ? increaseRate : decreaseRate;
  // A new activation supersedes old plans that had not begun before it. They
  // cannot affect any earlier lookup, and retaining them grows the linked
  // history during same-clock bursts or immediate touch catch-up.
  let retained = previous;
  while (retained.previous && retained.at >= at) retained = retained.previous;
  // Quintic smoothstep's maximum derivative is 1.875. Scale its duration
  // so the requested source-clock speed limit is respected throughout.
  return { from, to: target, at, duration: Math.abs(target - from) / rate * (smooth ? 1.875 : 1),
    ...(smooth ? { smooth: true } : {}), previous: remainingPlan(retained, now - PLAN_HISTORY_MS) };
}

/** Invert the strictly increasing source clock, including changes not yet active. */
export function mediaDeadline(source, plan, now) {
  if (now - delayAt(plan, now) >= source) return now;
  let maximum = Math.max(plan.from, plan.to), previous = plan.previous;
  while (previous) { maximum = Math.max(maximum, previous.from, previous.to); previous = previous.previous; }
  let low = now, high = Math.max(now, source + maximum);
  for (let i = 0; i < 40; i++) {
    const middle = (low + high) / 2;
    if (middle - delayAt(plan, middle) >= source) high = middle;
    else low = middle;
  }
  return high;
}
