/*! SPDX-License-Identifier: GPL-3.0-only */
import { INITIAL_MEDIA_DELAY, MAX_MEDIA_DELAY, MEDIA_DELAY_LIMITS, AUDIO_EARLY_MS, AUDIO_LATE_MS, constantDelay, delayAt, mediaDeadline, planDelay } from './delay-plan.js';
import { initialPlaybackPlans, audioDelayAt, videoExpired, videoLimit, videoSubmissionMargin, AUDIO_PLANNED_EARLY_MS, VIDEO_SUBMIT_MARGIN_MS } from './playback-window.js';
import { Samples } from './link.js';
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
      if (!Number.isFinite(source) || mode === 'carplay') return;
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
      plans = mode === 'carplay' ? { video: constantDelay(0, now()), audio: constantDelay(0, now()) }
        : { video: constantDelay(Math.max(0, Math.min(video, limit - VIDEO_SUBMIT_MARGIN_MS)), now()), audio: constantDelay(audio, now()) };
      change(plans);
    },
    reset() { tracks.clear(); first = { video: true, audio: true }; mode = null; limit = MAX_MEDIA_DELAY; plans = initialPlaybackPlans(now()); change(plans); },
    started() { first = { video: false, audio: false }; },
    delay: (track = 'video') => track === 'audio' ? audioDelayAt(plans, now(), mode) : delayAt(plans.video, now()),
    plan: (track = 'video') => plans[track],
    plans: () => plans,
    limit: () => limit,
  };
}
/** Schedules decoded pictures; CarPlay retains WebCodecs output order. Encoded input is untouched. */
export function createTimedFrames(present, { now = () => performance.timeOrigin + performance.now(), schedule = setTimeout, cancel = clearTimeout, observe = () => {} } = {}) {
  let queue = [], timer = null, plan = constantDelay(), last = -Infinity, expiredFrames = 0, droppedFrames = 0;
  let syncDroppedFrames = 0, syncUnavailableFrames = 0, syncState = 'video-only', outputMethod = null;
  const audioReferences = createAudioReferenceTimeline();
  const cursor = createVideoCatchUpCursor();
  const decodedToSchedulerMs = new Samples();
  let catchUpSkippedFrames = 0, ceilingViolations = 0, coalescedFrames = 0, staleFrames = 0, capacityFrames = 0;
  const drop = frame => { droppedFrames++; frame.close(); };

  function outputWindow(item, at) {
    if (item.config?.mode === 'carplay') { syncState = 'independent'; outputMethod = null; return null; }
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
    const videoPosition = cursor.advance(at);
    let selected = null;
    let nextAt = null;
    while (queue.length && queue[0].ready) {
      const item = queue[0];
      if (videoExpired(item.timing, item.config?.mode, at)) { queue.shift(); expiredFrames++; if (item.config?.mode === 'carplay') ceilingViolations++; drop(item.frame); continue; }
      const window = outputWindow(item, at);
      if (window?.unavailable || (window && (window.earliest > window.latest || at > window.latest))) {
        queue.shift(); syncDroppedFrames++; if (window.unavailable) syncUnavailableFrames++; drop(item.frame); continue;
      }
      const carplay = item.config?.mode === 'carplay';
      const networkAt = carplay ? at + Math.max(0, item.timing - videoPosition) / cursor.speed()
        : mediaDeadline(item.timing - margin, plan, at);
      const due = window ? Math.min(window.latest, Math.max(window.earliest, networkAt)) : networkAt;
      if (at < due) { nextAt = due; break; }
      queue.shift();
      if (selected) { coalescedFrames++; if (carplay && cursor.active()) catchUpSkippedFrames++; drop(selected.frame); }
      selected = { ...item, window };
    }
    if (selected) {
      if (Number.isFinite(selected.config?.stageTiming?.decodedAtMs)) decodedToSchedulerMs.add(at - selected.config.stageTiming.decodedAtMs);
      last = selected.order; present(selected.frame, selected.config, selected.id, selected.timing, selected.window); }
    if (nextAt !== null) timer = schedule(pump, Math.max(1, nextAt - now()));
  }
  return {
    present(frame, config, id, timing, source) {
      if (!Number.isFinite(timing)) {
        const resolved = config?.mode === 'carplay' ? { required: false } : audioReferences.resolve(config?.mode, null, source?.clockGeneration, now());
        if (resolved.required) { syncState = 'source-time-unavailable'; syncDroppedFrames++; syncUnavailableFrames++; drop(frame); }
        else present(frame, config, id, null);
        return;
      }
      const sourceTimeMs = typeof source === 'number' ? source : source?.sourceTimeMs;
      // Refining the network clock can move its mapped presentation estimate;
      // decoded media order belongs to the stable source coordinate instead.
      const order = Number.isFinite(sourceTimeMs) ? sourceTimeMs : timing;
      if (order <= last || (config?.mode === 'carplay' && queue.length && order <= queue.at(-1).order) || queue.some(item => item.order === order)) { staleFrames++; drop(frame); return; }
      if (videoExpired(timing, config?.mode, now())) { expiredFrames++; if (config?.mode === 'carplay') ceilingViolations++; drop(frame); return; }
      const item = { frame, config, id, timing, sourceTimeMs, order, clockGeneration: source?.clockGeneration, ready: false };
      if (config?.mode === 'carplay') cursor.start(timing, now());
      queue.push(item);
      if (config?.mode !== 'carplay') queue.sort((a, b) => a.order - b.order);
      // Applying the local observation may synchronously update the plan and pump.
      // Keep this item pending until that observation has completed.
      observe(timing, now());
      item.ready = true;
      while (queue.length > (config?.mode === 'carplay' ? 20 : 60)) { capacityFrames++; drop(queue.shift().frame); }
      pump();
    },
    delay(value) { plan = value; pump(); },
    touch() { cursor.touch(now()); pump(); },
    audio(reference) {
      if (!audioReferences.update(reference)) return;
      pump();
    },
    stats: () => ({ scheduledExpiredFrames: expiredFrames, scheduledDroppedFrames: droppedFrames,
      scheduledCoalescedFrames: coalescedFrames, scheduledStaleFrames: staleFrames, scheduledCapacityFrames: capacityFrames,
      audioSyncDroppedFrames: syncDroppedFrames, audioSyncUnavailableFrames: syncUnavailableFrames,
      audioSyncState: syncState, audioOutputMethod: outputMethod, decodedToSchedulerMsP95: decodedToSchedulerMs.percentile(95), decodedQueueSize: queue.length,
      videoCeilingViolations: ceilingViolations, touchSkippedFrames: catchUpSkippedFrames, ...cursor.stats(now()) }),
    plan: () => plan,
    reset() { if (timer !== null) cancel(timer); timer = null; for (const item of queue) item.frame.close(); queue = []; last = -Infinity;
      expiredFrames = droppedFrames = syncDroppedFrames = syncUnavailableFrames = catchUpSkippedFrames = ceilingViolations = coalescedFrames = staleFrames = capacityFrames = 0;
      cursor.reset(); syncState = 'video-only'; },
  };
}

/** Video-only cursor. Repeated touch preserves both its position and speed.
 * These bounded rates are an initial test policy; physical smoothness needs device measurement.
 * No audio delay plan or compressed input is changed by this controller.
 */
export function createVideoCatchUpCursor({ maximumSpeed = 1.5, acceleration = 0.004 } = {}) {
  let position = null, previousAt = null, speed = 1, catching = false, lastFrontier = null;
  function advance(at) {
    if (position === null) return at;
    let remaining = Math.max(0, at - previousAt);
    // Integrate in short bounded steps so sparse callbacks do not restart the curve.
    while (remaining > 0) {
      const step = Math.min(8, remaining), wall = previousAt + step;
      const error = Math.max(0, previousAt - position);
      const braking = (speed - 1) ** 2 / (2 * acceleration);
      const target = catching && error > braking + 0.5 ? maximumSpeed : 1;
      const nextSpeed = speed + Math.max(-acceleration * step, Math.min(acceleration * step, target - speed));
      position += (speed + nextSpeed) * 0.5 * step;
      if (position > wall) position = wall;
      speed = nextSpeed; previousAt = wall; remaining -= step;
      if (catching && wall - position < 0.5 && speed <= 1.001) catching = false;
    }
    return position;
  }
  return {
    start(source, at) { lastFrontier = source; if (position === null) { position = Math.min(source, at); previousAt = at; } },
    advance,
    touch(at) { advance(at); catching = true; },
    active: () => catching,
    speed: () => speed,
    stats(at) { return { touchCatchUpActive: catching, videoCursorMs: position, videoCursorSpeed: speed,
      videoCursorDeltaMs: position === null ? null : at - position,
      decodedFrontierDeltaMs: lastFrontier === null ? null : at - lastFrontier }; },
    reset() { position = previousAt = lastFrontier = null; speed = 1; catching = false; },
  };
}
