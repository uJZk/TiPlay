/*! SPDX-License-Identifier: GPL-3.0-only */
import { MEDIA_DELAY_LIMITS, constantDelay, delayAt, planDelay, playbackProfile } from './delay-plan.js';
import { initialPlaybackPlans, audioDelayAt, VIDEO_SUBMIT_MARGIN_MS } from './playback-window.js';
export { INITIAL_MEDIA_DELAY, MAX_MEDIA_DELAY } from './delay-plan.js';

/** Compatibility plans for audio/diagnostics; native video owns its playback clock. */
export function createMediaTiming(change = () => {}, now = () => performance.timeOrigin + performance.now()) {
  let plans = initialPlaybackPlans(), first = { video: true, audio: true }, mode = null;
  // Diagnostic counts span this timing owner's lifetime, including stream/epoch resets.
  let profileSwitches = 0, planChanges = 0;
  let decision = { reason: 'initial' };
  const tracks = new Map();
  const policy = () => playbackProfile(mode);
  const decorate = (profile, previous = plans.video.playbackProfile) => {
    if (plans.video.playbackProfile === profile.name) return false;
    if (previous !== profile.name) profileSwitches++;
    plans = { ...plans, video: { ...plans.video, playbackProfile: profile.name } };
    return true;
  };
  function targetPlan(track, target, profile = policy()) {
    if (target === plans[track].to) return track === 'video' && decorate(profile);
    const video = track === 'video';
    const previousProfile = plans.video.playbackProfile;
    plans = { ...plans, [track]: first[track] ? constantDelay(target, now())
      : planDelay(plans[track], target, now(), video ? {
        decreaseRate: profile.videoDecreaseRate,
      } : undefined) };
    if (video) { planChanges++; decorate(profile, previousProfile); }
    return true;
  }
  return {
    observe(track, source, ready = now()) {
      if (!['video', 'audio'].includes(track) || !Number.isFinite(source) || !Number.isFinite(ready)) return;
      const profile = policy();
      const previous = tracks.get(track);
      const elapsed = previous ? Math.max(0, ready - previous.at) : 0;
      const decay = track === 'video' ? profile.readinessDecay : 0.005;
      const delay = Math.max(0, ready - source, (previous?.delay ?? 0) - elapsed * decay);
      tracks.set(track, { delay, at: ready });
      const target = Math.min(Math.max(0, profile.maxDelayMs - VIDEO_SUBMIT_MARGIN_MS),
        Math.max(profile.initialDelayMs, delay + (track === 'video' ? profile.jitterMarginMs : 20)));
      if (track === 'video') decision = { readiness: delay, margin: profile.jitterMarginMs,
        reason: target < Math.max(profile.initialDelayMs, delay + profile.jitterMarginMs)
          ? 'ceiling' : profile.initialDelayMs > delay + profile.jitterMarginMs ? 'initial-floor' : 'readiness' };
      if (targetPlan(track, target, profile)) change(plans);
      first[track] = false;
    },
    mode(value) {
      if (!Object.hasOwn(MEDIA_DELAY_LIMITS, value) || value === mode) return;
      mode = value; tracks.clear();
      const profile = policy();
      // Audio configurations/epochs are managed separately by the audio path.
      // A video mode notification must not seek an already running audio plan.
      if (plans.video.playbackProfile !== profile.name) profileSwitches++;
      planChanges++; decision = { reason: 'initial' };
      plans = { video: { ...constantDelay(profile.initialDelayMs, now()), playbackProfile: profile.name }, audio: plans.audio };
      change(plans);
    },
    reset() { tracks.clear(); first = { video: true, audio: true }; mode = null;
      decision = { reason: 'initial' };
      plans = initialPlaybackPlans(now()); change(plans); },
    started() { first = { video: false, audio: false }; },
    delay: (track = 'video') => track === 'audio' ? audioDelayAt(plans, now()) : delayAt(plans.video, now()),
    plan: (track = 'video') => plans[track],
    plans: () => plans,
    profile: policy,
    limit: () => policy().maxDelayMs,
    /** Read-only compatibility statistics; these are not native jitter-buffer measurements. */
    stats() {
      const at = now(), plan = plans.video, applied = playbackProfile(plan.playbackProfile);
      return { policyVideoReadinessMs: decision.readiness, policyVideoMarginMs: decision.margin,
        policyVideoTargetMs: plan.to, policyVideoPlanFromMs: plan.from, policyVideoPlanDurationMs: plan.duration,
        policyVideoPlanRemainingMs: Math.max(0, plan.duration - Math.max(0, at - plan.at)),
        policyVideoLeadRemainingMs: Math.max(0, plan.at - at), policyTargetReason: decision.reason,
        policyInteractionActive: false, policyHoldRemainingMs: 0,
        policyInteractionStarts: 0, policyInteractionReleases: 0,
        policyProfileSwitches: profileSwitches, policyPlanChanges: planChanges,
        policyMaxDelayMs: applied.maxDelayMs, policyMaxVideoFrames: applied.maxVideoFrames,
        policyMaxVideoBytes: applied.maxVideoBytes, policySubmitMarginMs: VIDEO_SUBMIT_MARGIN_MS };
    },
  };
}
