/*! SPDX-License-Identifier: GPL-3.0-only */
import { INITIAL_MEDIA_DELAY, MAX_MEDIA_DELAY, MEDIA_DELAY_LIMITS, constantDelay, delayAt } from './delay-plan.js';

export function initialPlaybackPlans(at = 0) {
  return { video: constantDelay(INITIAL_MEDIA_DELAY, at), audio: constantDelay(INITIAL_MEDIA_DELAY, at) };
}
export const VIDEO_SUBMIT_MARGIN_MS = 20;
export function videoSubmissionMargin(plan) {
  return Math.max(0, VIDEO_SUBMIT_MARGIN_MS - Math.max(plan.from, plan.to));
}

/** Audio owns its source timeline. Video catch-up must never alter sample progress. */
export function audioDelayAt(plans, wallTime) {
  return delayAt(plans.audio, wallTime);
}

export function videoLimit(mode) { return MEDIA_DELAY_LIMITS[mode] ?? MAX_MEDIA_DELAY; }
export const audioLimit = videoLimit;

/** The available timestamp measures source presentation to canvas submission, not capture. */
export function videoExpired(source, mode, wallTime) {
  return Number.isFinite(source) && wallTime - source > videoLimit(mode);
}
