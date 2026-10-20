/*! SPDX-License-Identifier: GPL-3.0-only */
import { MEDIA_DELAY_LIMITS, constantDelay, delayAt, mediaDeadline, planDelay, playbackProfile, DELAY_PLAN_LEAD_MS } from './delay-plan.js';
import { initialPlaybackPlans, audioDelayAt, videoExpired, videoSubmissionMargin, VIDEO_SUBMIT_MARGIN_MS } from './playback-window.js';
import { createAudioReferenceTimeline } from './audio-output-clock.js';
import { Samples } from './link.js';
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

/** Independent live clocks share policy, never each other's presentation cursor. */
export function createMediaTiming(change = () => {}, now = () => performance.timeOrigin + performance.now()) {
  let plans = initialPlaybackPlans(), first = { video: true, audio: true }, mode = null;
  let touching = false, interactionUntil = -Infinity, lastVideoProfile = null;
  // Diagnostic counts span this timing owner's lifetime, including stream/epoch resets.
  let interactionStarts = 0, interactionReleases = 0, profileSwitches = 0, planChanges = 0;
  let decision = { reason: 'initial' };
  const tracks = new Map();
  const policy = () => playbackProfile(mode, mode === 'carplay' && (touching || now() < interactionUntil));
  const decorate = (profile, previous = plans.video.playbackProfile) => {
    if (plans.video.playbackProfile === profile.name) return false;
    if (previous !== profile.name) profileSwitches++;
    plans = { ...plans, video: { ...plans.video, playbackProfile: profile.name } };
    return true;
  };
  function targetPlan(track, target, profile = policy(), immediate = false) {
    if (target === plans[track].to) return track === 'video' && decorate(profile);
    const video = track === 'video';
    const previousProfile = plans.video.playbackProfile;
    plans = { ...plans, [track]: first[track] ? constantDelay(target, now())
      : planDelay(plans[track], target, now(), video ? {
        leadMs: immediate ? 0 : DELAY_PLAN_LEAD_MS,
        decreaseRate: profile.videoDecreaseRate, smooth: immediate,
      } : undefined) };
    if (video) { planChanges++; decorate(profile, previousProfile); }
    return true;
  }
  return {
    observe(track, source, ready = now()) {
      if (!['video', 'audio'].includes(track) || !Number.isFinite(source) || !Number.isFinite(ready)) return;
      const profile = policy();
      // A pre-touch readiness peak describes the old backlog. Do not rebuild it
      // when returning to ordinary playback; measure the available frontier anew.
      if (track === 'video' && lastVideoProfile === 'carplay-touch' && profile.name !== lastVideoProfile) tracks.delete('video');
      if (track === 'video') lastVideoProfile = profile.name;
      const previous = tracks.get(track);
      const elapsed = previous ? Math.max(0, ready - previous.at) : 0;
      const decay = track === 'video' ? profile.readinessDecay : 0.005;
      const delay = Math.max(0, ready - source, (previous?.delay ?? 0) - elapsed * decay);
      tracks.set(track, { delay, at: ready });
      const interacting = profile.name === 'carplay-touch';
      const target = track === 'video' && interacting ? 0
        : Math.min(Math.max(0, profile.maxDelayMs - VIDEO_SUBMIT_MARGIN_MS),
          Math.max(profile.initialDelayMs, delay + (track === 'video' ? profile.jitterMarginMs : 20)));
      if (track === 'video') decision = { readiness: delay, margin: interacting ? 0 : profile.jitterMarginMs,
        reason: interacting ? 'touch' : target < Math.max(profile.initialDelayMs, delay + profile.jitterMarginMs)
          ? 'ceiling' : profile.initialDelayMs > delay + profile.jitterMarginMs ? 'initial-floor' : 'readiness' };
      if (targetPlan(track, target, profile, track === 'video' && interacting)) change(plans);
      first[track] = false;
    },
    mode(value) {
      if (!Object.hasOwn(MEDIA_DELAY_LIMITS, value) || value === mode) return;
      mode = value; touching = false; interactionUntil = -Infinity; lastVideoProfile = null; tracks.clear();
      const profile = policy();
      // Audio configurations/epochs are managed separately by the audio path.
      // A video mode notification must not seek an already running audio plan.
      if (plans.video.playbackProfile !== profile.name) profileSwitches++;
      planChanges++; decision = { reason: 'initial' };
      plans = { video: { ...constantDelay(profile.initialDelayMs, now()), playbackProfile: profile.name }, audio: plans.audio };
      change(plans);
    },
    interaction(active = true) {
      if (mode !== 'carplay') return;
      const already = policy().name === 'carplay-touch';
      if (Boolean(active) !== touching) { if (active) interactionStarts++; else interactionReleases++; }
      touching = Boolean(active); interactionUntil = now() + playbackProfile('carplay').interactionHoldMs;
      if (active && !already) tracks.delete('video');
      if (active) lastVideoProfile = 'carplay-touch';
      // Repeated move/down events extend the hold without restarting convergence.
      // Release never restores the pre-touch delay or changes the audio plan.
      if (active && !already) decision = { reason: 'touch', margin: 0 };
      if (active && targetPlan('video', 0, policy(), true)) change(plans);
    },
    reset() { tracks.clear(); first = { video: true, audio: true }; mode = null;
      touching = false; interactionUntil = -Infinity; lastVideoProfile = null; decision = { reason: 'initial' };
      plans = initialPlaybackPlans(now()); change(plans); },
    started() { first = { video: false, audio: false }; },
    delay: (track = 'video') => track === 'audio' ? audioDelayAt(plans, now()) : delayAt(plans.video, now()),
    plan: (track = 'video') => plans[track],
    plans: () => plans,
    profile: policy,
    limit: () => policy().maxDelayMs,
    /** Read only the applied video plan. Eligibility can expire before another frame applies it. */
    stats() {
      const at = now(), plan = plans.video, applied = playbackProfile(plan.playbackProfile);
      return { policyVideoReadinessMs: decision.readiness, policyVideoMarginMs: decision.margin,
        policyVideoTargetMs: plan.to, policyVideoPlanFromMs: plan.from, policyVideoPlanDurationMs: plan.duration,
        policyVideoPlanRemainingMs: Math.max(0, plan.duration - Math.max(0, at - plan.at)),
        policyVideoLeadRemainingMs: Math.max(0, plan.at - at), policyTargetReason: decision.reason,
        policyInteractionActive: touching, policyHoldRemainingMs: Math.max(0, interactionUntil - at),
        policyInteractionStarts: interactionStarts, policyInteractionReleases: interactionReleases,
        policyProfileSwitches: profileSwitches, policyPlanChanges: planChanges,
        policyMaxDelayMs: applied.maxDelayMs, policyMaxVideoFrames: applied.maxVideoFrames,
        policyMaxVideoBytes: applied.maxVideoBytes, policySubmitMarginMs: VIDEO_SUBMIT_MARGIN_MS };
    },
  };
}
/** Schedule decoded pictures. CarPlay preserves WebCodecs presentation order; compressed dependencies remain untouched. */
export function createTimedFrames(present, { now = () => performance.timeOrigin + performance.now(), schedule = setTimeout, cancel = clearTimeout, observe = () => {} } = {}) {
  let queue = [], timer = null, plan = constantDelay(), last = -Infinity, expiredFrames = 0, droppedFrames = 0;
  let syncDroppedFrames = 0, syncUnavailableFrames = 0, syncState = 'video-only', outputMethod = null;
  let queuedBytes = 0, resourceDroppedFrames = 0, untimedFrames = 0;
  let coalescedFrames = 0, staleFrames = 0, catchUpSkippedFrames = 0, ceilingViolations = 0, lastFrontier = null;
  const decodedToSchedulerMs = new Samples();
  const cursorSpeed = at => 1 - (delayAt(plan, at + 0.5) - delayAt(plan, at - 0.5));
  const catchingUp = at => /^carplay(?:-touch)?$/.test(plan.playbackProfile)
    && ((plan.playbackProfile === 'carplay-touch' && delayAt(plan, at) > 0.5) || cursorSpeed(at) > 1.0001);
  const audioReferences = createAudioReferenceTimeline();
  const drop = frame => { droppedFrames++; frame.close(); };
  const shift = () => { const item = queue.shift(); queuedBytes -= item.bytes; return item; };

  function outputWindow(item, at) {
    const resolved = audioReferences.resolve(item.config?.mode, item.sourceTimeMs, item.clockGeneration, at);
    const { reference, audioAt, uncertaintyMs: uncertainty } = resolved;
    syncState = resolved.state; outputMethod = reference?.outputMethod ?? null;
    if (!resolved.required) return null;
    // Audio output evidence is diagnostic. Missing/late audio cannot freeze an
    // independent live-video timeline or drive touch catch-up.
    return { audioAt, uncertaintyMs: uncertainty, sourceTimeMs: item.sourceTimeMs,
      at: reference?.at, mode: reference?.mode, type: reference?.type, epoch: reference?.epoch,
      generation: reference?.generation, sequence: reference?.sequence, clockGeneration: reference?.clockGeneration,
      outputMethod: reference?.outputMethod };
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
      if (videoExpired(item.timing, item.config?.mode, at)) { shift(); expiredFrames++;
        if (item.config?.mode === 'carplay') ceilingViolations++; drop(item.frame); continue; }
      const window = outputWindow(item, at);
      const networkAt = mediaDeadline(item.timing - margin, plan, at);
      const due = networkAt;
      if (at < due) { nextAt = due; break; }
      shift();
      if (selected) { coalescedFrames++;
        if (selected.config?.mode === 'carplay' && catchingUp(at)) catchUpSkippedFrames++;
        drop(selected.frame); }
      selected = { ...item, window };
    }
    if (selected) {
      if (Number.isFinite(selected.config?.stageTiming?.decodedAtMs)) decodedToSchedulerMs.add(at - selected.config.stageTiming.decodedAtMs);
      last = selected.order; present(selected.frame, selected.config, selected.id, selected.timing, selected.window);
    }
    if (nextAt !== null) timer = schedule(pump, Math.max(1, nextAt - now()));
  }
  return {
    present(frame, config, id, timing, source) {
      if (!Number.isFinite(timing)) {
        syncState = 'source-time-unavailable'; untimedFrames++;
        present(frame, config, id, null);
        return;
      }
      const sourceTimeMs = typeof source === 'number' ? source : source?.sourceTimeMs;
      // Refining the network clock can move its mapped presentation estimate;
      // decoded media order belongs to the stable source coordinate instead.
      const order = Number.isFinite(sourceTimeMs) ? sourceTimeMs : timing;
      if (order <= last || (config?.mode === 'carplay' && queue.length && order <= queue.at(-1).order)
        || queue.some(item => item.order === order)) { staleFrames++; drop(frame); return; }
      // Conservative RGBA surface accounting also bounds GPU-backed frames.
      const width = Number(frame.codedWidth || frame.displayWidth || config?.width || 0);
      const height = Number(frame.codedHeight || frame.displayHeight || config?.height || 0);
      const bytes = Number.isFinite(width * height) ? Math.max(0, width * height * 4) : Infinity;
      const profile = playbackProfile(plan.playbackProfile || config?.mode);
      if (bytes > profile.maxVideoBytes) { resourceDroppedFrames++; drop(frame); return; }
      const item = { frame, config, id, timing, sourceTimeMs, order, bytes, clockGeneration: source?.clockGeneration, ready: false };
      lastFrontier = timing;
      queue.push(item);
      if (config?.mode !== 'carplay') queue.sort((a, b) => a.order - b.order);
      queuedBytes += bytes;
      // Applying the local observation may synchronously update the plan and pump.
      // Keep this item pending until that observation has completed.
      observe(timing, now());
      item.ready = true;
      while (queue.length > profile.maxVideoFrames || queuedBytes > profile.maxVideoBytes) {
        resourceDroppedFrames++; drop(shift().frame);
      }
      pump();
    },
    delay(value) { plan = value; pump(); },
    audio(reference) {
      if (!audioReferences.update(reference)) return;
      pump();
    },
    stats: () => ({ scheduledExpiredFrames: expiredFrames, scheduledDroppedFrames: droppedFrames,
      scheduledCoalescedFrames: coalescedFrames, scheduledStaleFrames: staleFrames, scheduledCapacityFrames: resourceDroppedFrames,
      decodedToSchedulerMsP95: decodedToSchedulerMs.percentile(95), decodedQueueSize: queue.length,
      videoCeilingViolations: ceilingViolations, touchSkippedFrames: catchUpSkippedFrames,
      videoCursorSpeed: cursorSpeed(now()), videoCursorDeltaMs: lastFrontier === null ? null : delayAt(plan, now()),
      decodedFrontierDeltaMs: lastFrontier === null ? null : now() - lastFrontier, touchCatchUpActive: catchingUp(now()),
      audioSyncDroppedFrames: syncDroppedFrames, audioSyncUnavailableFrames: syncUnavailableFrames,
      audioSyncState: syncState, audioOutputMethod: outputMethod, decodedQueueFrames: queue.length,
      decodedQueueBytes: queuedBytes, decodedResourceDroppedFrames: resourceDroppedFrames, untimedScheduledFrames: untimedFrames,
      playbackProfile: plan.playbackProfile || 'default' }),
    plan: () => plan,
    reset() { if (timer !== null) cancel(timer); timer = null; for (const item of queue) item.frame.close(); queue = []; last = -Infinity;
      queuedBytes = resourceDroppedFrames = untimedFrames = coalescedFrames = staleFrames = catchUpSkippedFrames = ceilingViolations = 0; lastFrontier = null;
      expiredFrames = droppedFrames = syncDroppedFrames = syncUnavailableFrames = 0; syncState = 'video-only'; },
  };
}
