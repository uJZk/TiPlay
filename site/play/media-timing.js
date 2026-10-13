/*! SPDX-License-Identifier: GPL-3.0-only */
import { INITIAL_MEDIA_DELAY, MAX_MEDIA_DELAY, MEDIA_DELAY_LIMITS, constantDelay, delayAt, mediaDeadline, planDelay } from './delay-plan.js';
import { initialPlaybackPlans, audioDelayAt, videoExpired, videoMissedDeadline, AUDIO_PLANNED_EARLY_MS, VIDEO_SUBMIT_MARGIN_MS } from './playback-window.js';
import { AUDIO_LATE_MS } from './delay-plan.js';
export { INITIAL_MEDIA_DELAY, MAX_MEDIA_DELAY } from './delay-plan.js';

/** Recording calibration: report source timing, then draw now without a scheduling handshake. */
export function createImmediateFrames(present, observe = () => {}, now = () => performance.timeOrigin + performance.now()) {
  return {
    present(frame, config, id, timing) { observe(timing, now()); present(frame, config, id, timing); },
  };
}

/** A repeated configuration is not a new presentation epoch. */
export function createVideoEpochGuard(clear) {
  let epoch = null;
  return {
    message(message) {
      if (message.type === 'idle' || message.type === 'end') { this.reset(); return; }
      if (message.type === 'config' && message.config.epoch !== epoch) { clear(); epoch = message.config.epoch; }
    },
    reset() { epoch = null; clear(); },
  };
}

/** Video readiness sets its clock; audio follows its own readiness within the permitted skew. */
export function createMediaTiming(change = () => {}, now = () => performance.timeOrigin + performance.now()) {
  let plans = initialPlaybackPlans(), first = { video: true, audio: true }, mode = null, limit = MAX_MEDIA_DELAY;
  const tracks = new Map();
  function targetPlan(track, target) {
    if (target === plans[track].to) return false;
    plans = { ...plans, [track]: first[track] ? constantDelay(target, now()) : planDelay(plans[track], target, now()) };
    return true;
  }
  return {
    observe(track, source, ready = now()) {
      if (!Number.isFinite(source)) return;
      const previous = tracks.get(track);
      const elapsed = previous ? Math.max(0, ready - previous.at) : 0;
      tracks.set(track, { delay: Math.max(0, ready - source, (previous?.delay ?? 0) - elapsed * 0.005), at: ready });
      const videoEstimate = tracks.get('video');
      const videoTarget = track === 'video'
        ? Math.min(limit - VIDEO_SUBMIT_MARGIN_MS, Math.max(INITIAL_MEDIA_DELAY, (videoEstimate?.delay ?? 0) + 20))
        : plans.video.to;
      let changed = targetPlan('video', videoTarget);
      const audioEstimate = tracks.get('audio');
      if (audioEstimate) {
        const audioTarget = Math.min(videoTarget + AUDIO_LATE_MS, Math.max(Math.max(0, videoTarget - AUDIO_PLANNED_EARLY_MS), audioEstimate.delay + 20));
        changed = targetPlan('audio', audioTarget) || changed;
      }
      if (changed) change(plans);
      first[track] = false;
    },
    mode(value) {
      if (!Object.hasOwn(MEDIA_DELAY_LIMITS, value) || value === mode) return;
      const video = delayAt(plans.video, now()), audio = audioDelayAt(plans, now());
      if (mode !== null) tracks.clear();
      mode = value; limit = MEDIA_DELAY_LIMITS[value];
      plans = { video: constantDelay(Math.min(video, limit - 20), now()), audio: constantDelay(audio, now()) };
      change(plans);
    },
    reset() { tracks.clear(); first = { video: true, audio: true }; mode = null; limit = MAX_MEDIA_DELAY; plans = initialPlaybackPlans(now()); change(plans); },
    started() { first = { video: false, audio: false }; },
    delay: (track = 'video') => track === 'audio' ? audioDelayAt(plans, now()) : delayAt(plans.video, now()),
    plan: (track = 'video') => plans[track],
    plans: () => plans,
    limit: () => limit,
  };
}
/** Orders decoded frames only. Encoded video remains in decoder dependency order. */
export function createTimedFrames(present, { now = () => performance.timeOrigin + performance.now(), schedule = setTimeout, cancel = clearTimeout, observe = () => {} } = {}) {
  let queue = [], timer = null, plan = constantDelay(), last = -Infinity, serial = 0, expiredFrames = 0;
  function pump() {
    if (timer !== null) cancel(timer);
    timer = null;
    const at = now(), cutoff = at - delayAt(plan, at);
    let selected = null;
    while (queue.length && queue[0].ready && queue[0].timing <= cutoff) {
      const item = queue.shift();
      if (videoExpired(item.timing, item.config?.mode, at) || videoMissedDeadline(item.timing, plan, at)) { expiredFrames++; item.frame.close(); continue; }
      selected?.frame.close(); selected = item;
    }
    if (selected) { last = selected.timing; present(selected.frame, selected.config, selected.id, selected.timing); }
    if (queue[0]?.ready) timer = schedule(pump, Math.max(1, mediaDeadline(queue[0].timing, plan, now()) - now()));
  }
  return {
    present(frame, config, id, timing) {
      if (!Number.isFinite(timing)) { present(frame, config, id, null); return; }
      if (timing <= last || queue.some(item => item.timing === timing)) { frame.close(); return; }
      const token = ++serial, item = { frame, config, id, timing, token, ready: false };
      queue.push(item); queue.sort((a, b) => a.timing - b.timing);
      item.ready = observe(timing, now(), token) !== false;
      while (queue.length > 60) queue.shift().frame.close();
      pump();
    },
    delay(value) { plan = value; pump(); },
    ready(token, value) { const item = queue.find(item => item.token === token); if (!item) return; plan = value; item.ready = true; pump(); },
    stats: () => ({ scheduledExpiredFrames: expiredFrames }),
    plan: () => plan,
    reset() { if (timer !== null) cancel(timer); timer = null; for (const item of queue) item.frame.close(); queue = []; last = -Infinity; },
  };
}
