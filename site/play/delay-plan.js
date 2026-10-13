/*! SPDX-License-Identifier: GPL-3.0-only */
export const INITIAL_MEDIA_DELAY = 60;
export const MAX_MEDIA_DELAY = 400;
export const MEDIA_DELAY_LIMITS = Object.freeze({ carplay: 100, 'airplay-mirror': 200, 'airplay-video': 400 });
export const AUDIO_EARLY_MS = 45;
export const AUDIO_LATE_MS = 125;
export const DELAY_PLAN_LEAD_MS = 85;

export function constantDelay(value = INITIAL_MEDIA_DELAY, at = 0) {
  return { from: value, to: value, at, duration: 0 };
}

/** Pure absolute-clock mapping shared by the presenter and every audio sample. */
export function delayAt(plan, time) {
  if (time < plan.at && plan.previous) return delayAt(plan.previous, time);
  const progress = plan.duration > 0 ? Math.max(0, Math.min(1, (time - plan.at) / plan.duration)) : 1;
  return plan.from + (plan.to - plan.from) * progress;
}

function remainingPlan(plan, now) {
  const { previous, ...current } = plan;
  if (plan.at > now && previous) current.previous = remainingPlan(previous, now);
  return current;
}

/** A future activation lets both execution contexts receive the same continuous plan. */
export function planDelay(previous, target, now) {
  const at = now + DELAY_PLAN_LEAD_MS, from = delayAt(previous, at);
  const rate = target > from ? 0.02 : 0.005;
  return { from, to: target, at, duration: Math.abs(target - from) / rate, previous: remainingPlan(previous, now - AUDIO_LATE_MS) };
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
