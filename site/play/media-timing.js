/*! SPDX-License-Identifier: GPL-3.0-only */
import { INITIAL_MEDIA_DELAY, MAX_MEDIA_DELAY, MEDIA_DELAY_LIMITS, AUDIO_EARLY_MS, AUDIO_LATE_MS, constantDelay, delayAt, mediaDeadline, planDelay } from './delay-plan.js';
import { initialPlaybackPlans, audioDelayAt, videoExpired, videoLimit, videoSubmissionMargin, AUDIO_PLANNED_EARLY_MS, VIDEO_SUBMIT_MARGIN_MS } from './playback-window.js';
import { createAudioReferenceTimeline } from './audio-output-clock.js';
export { INITIAL_MEDIA_DELAY, MAX_MEDIA_DELAY } from './delay-plan.js';

/** A repeated configuration is not a new presentation epoch. */
export function createVideoEpochGuard(clear) {
  let epoch = null, mode = null;
  return {
    message(message) {
      if (message.type === 'idle' || message.type === 'end') { this.reset(); return; }
      if (message.type === 'config' && (message.config.epoch !== epoch || message.config.mode !== mode)) {
        clear(); epoch = message.config.epoch; mode = message.config.mode;
      }
    },
    reset() { epoch = mode = null; clear(); },
  };
}

/** Readiness estimates network/decode buffering only. Output drift has a separate audio reference. */
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
        ? Math.min(Math.max(0, limit - VIDEO_SUBMIT_MARGIN_MS), Math.max(INITIAL_MEDIA_DELAY, (videoEstimate?.delay ?? 0) + 20))
        : plans.video.to;
      let changed = targetPlan('video', videoTarget);
      const audioEstimate = tracks.get('audio');
      if (audioEstimate) {
        const audioTarget = Math.min(videoTarget + AUDIO_LATE_MS - videoSubmissionMargin(plans.video), Math.max(Math.max(0, videoTarget - AUDIO_PLANNED_EARLY_MS), audioEstimate.delay + 20));
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
      plans = { video: constantDelay(Math.max(0, Math.min(video, limit - VIDEO_SUBMIT_MARGIN_MS)), now()), audio: constantDelay(audio, now()) };
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
  let queue = [], timer = null, plan = constantDelay(), last = -Infinity, expiredFrames = 0, droppedFrames = 0;
  let syncDroppedFrames = 0, syncUnavailableFrames = 0, syncState = 'video-only', outputMethod = null;
  const audioReferences = createAudioReferenceTimeline();
  const drop = frame => { droppedFrames++; frame.close(); };

  function outputWindow(item, at) {
    const resolved = audioReferences.resolve(item.config?.mode, item.sourceTimeMs, item.clockGeneration, at);
    const { reference, audioAt, uncertaintyMs: uncertainty } = resolved;
    syncState = resolved.state; outputMethod = reference?.outputMethod ?? null;
    if (!resolved.required) return null;
    if (!Number.isFinite(audioAt)) return { unavailable: true, reason: resolved.state };
    const earliest = audioAt + uncertainty - AUDIO_LATE_MS;
    const latest = Math.min(audioAt - uncertainty + AUDIO_EARLY_MS, item.timing + videoLimit(item.config?.mode));
    syncState = earliest <= latest ? 'audio-output' : 'infeasible';
    return { audioAt, earliest, latest, uncertaintyMs: uncertainty, sourceTimeMs: item.sourceTimeMs,
      at: reference.at, mode: reference.mode, type: reference.type, epoch: reference.epoch,
      generation: reference.generation, sequence: reference.sequence, clockGeneration: reference.clockGeneration,
      outputMethod: reference.outputMethod };
  }

  function pump() {
    if (timer !== null) cancel(timer);
    timer = null;
    // A zero-delay plan cannot reserve drawing time by becoming negative. Submit
    // those frames early instead; the final presenter still checks the raw cap.
    const margin = videoSubmissionMargin(plan);
    const at = now();
    let selected = null;
    let nextAt = null;
    while (queue.length && queue[0].ready) {
      const item = queue[0];
      if (videoExpired(item.timing, item.config?.mode, at)) { queue.shift(); expiredFrames++; drop(item.frame); continue; }
      const window = outputWindow(item, at);
      if (window?.unavailable || (window && (window.earliest > window.latest || at > window.latest))) {
        queue.shift(); syncDroppedFrames++; if (window.unavailable) syncUnavailableFrames++; drop(item.frame); continue;
      }
      const networkAt = mediaDeadline(item.timing - margin, plan, at);
      const due = window ? Math.min(window.latest, Math.max(window.earliest, networkAt)) : networkAt;
      if (at < due) { nextAt = due; break; }
      queue.shift();
      if (selected) drop(selected.frame);
      selected = { ...item, window };
    }
    if (selected) { last = selected.order; present(selected.frame, selected.config, selected.id, selected.timing, selected.window); }
    if (nextAt !== null) timer = schedule(pump, Math.max(1, nextAt - now()));
  }
  return {
    present(frame, config, id, timing, source) {
      if (!Number.isFinite(timing)) {
        const resolved = audioReferences.resolve(config?.mode, null, source?.clockGeneration, now());
        if (resolved.required) { syncState = 'source-time-unavailable'; syncDroppedFrames++; syncUnavailableFrames++; drop(frame); }
        else present(frame, config, id, null);
        return;
      }
      const sourceTimeMs = typeof source === 'number' ? source : source?.sourceTimeMs;
      // Refining the network clock can move its mapped presentation estimate;
      // decoded media order belongs to the stable source coordinate instead.
      const order = Number.isFinite(sourceTimeMs) ? sourceTimeMs : timing;
      if (order <= last || queue.some(item => item.order === order)) { drop(frame); return; }
      const item = { frame, config, id, timing, sourceTimeMs, order, clockGeneration: source?.clockGeneration, ready: false };
      queue.push(item); queue.sort((a, b) => a.order - b.order);
      // Applying the local observation may synchronously update the plan and pump.
      // Keep this item pending until that observation has completed.
      observe(timing, now());
      item.ready = true;
      while (queue.length > 60) drop(queue.shift().frame);
      pump();
    },
    delay(value) { plan = value; pump(); },
    audio(reference) {
      if (!audioReferences.update(reference)) return;
      pump();
    },
    stats: () => ({ scheduledExpiredFrames: expiredFrames, scheduledDroppedFrames: droppedFrames,
      audioSyncDroppedFrames: syncDroppedFrames, audioSyncUnavailableFrames: syncUnavailableFrames,
      audioSyncState: syncState, audioOutputMethod: outputMethod }),
    plan: () => plan,
    reset() { if (timer !== null) cancel(timer); timer = null; for (const item of queue) item.frame.close(); queue = []; last = -Infinity;
      expiredFrames = droppedFrames = syncDroppedFrames = syncUnavailableFrames = 0; syncState = 'video-only'; },
  };
}
