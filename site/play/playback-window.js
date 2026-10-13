/*! SPDX-License-Identifier: GPL-3.0-only */
import { INITIAL_MEDIA_DELAY, MAX_MEDIA_DELAY, MEDIA_DELAY_LIMITS, AUDIO_EARLY_MS, AUDIO_LATE_MS, constantDelay, delayAt } from './delay-plan.js';

export function initialPlaybackPlans(at = 0) {
  return { video: constantDelay(INITIAL_MEDIA_DELAY, at), audio: constantDelay(INITIAL_MEDIA_DELAY, at) };
}
export const VIDEO_SUBMIT_MARGIN_MS = 20;
export const AUDIO_PLANNED_EARLY_MS = AUDIO_EARLY_MS - VIDEO_SUBMIT_MARGIN_MS;

/** Clamp against matching video deadlines, including the video clock's recent history. */
export function audioDelayAt(plans, wallTime) {
  const earliest = delayAt(plans.video, wallTime + AUDIO_PLANNED_EARLY_MS) - AUDIO_PLANNED_EARLY_MS;
  const latest = delayAt(plans.video, wallTime - AUDIO_LATE_MS) + AUDIO_LATE_MS;
  return Math.min(latest, Math.max(earliest, delayAt(plans.audio, wallTime)));
}

export function videoLimit(mode) { return MEDIA_DELAY_LIMITS[mode] ?? MAX_MEDIA_DELAY; }

/** The available timestamp measures source presentation to canvas submission, not capture. */
export function videoExpired(source, mode, wallTime) {
  return Number.isFinite(source) && wallTime - source > videoLimit(mode);
}

export function videoMissedDeadline(source, videoPlan, wallTime) {
  const deadlineBefore = wallTime - VIDEO_SUBMIT_MARGIN_MS;
  return Number.isFinite(source) && videoPlan && source < deadlineBefore - delayAt(videoPlan, deadlineBefore);
}
