// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaTiming, createTimedFrames } from '../../site/play/media-timing.js';
import { audioDelayAt, videoExpired } from '../../site/play/playback-window.js';
import { constantDelay, delayAt, playbackProfile } from '../../site/play/delay-plan.js';

test('policy evidence reads the applied target and used margin without changing playback', () => {
  let at = 1000;
  const timing = createMediaTiming(() => {}, () => at);
  timing.mode('carplay');
  assert.equal(timing.stats().policyVideoReadinessMs, undefined, 'unknown readiness cannot become a measured zero');
  timing.observe('video', 900);
  const plan = timing.plan(), before = timing.stats();
  assert.equal(before.policyVideoReadinessMs, 100); assert.equal(before.policyVideoMarginMs, 20);
  assert.equal(before.policyVideoTargetMs, 120); assert.equal(before.policyTargetReason, 'readiness');
  assert.equal(before.policyMaxDelayMs, 300); assert.equal(before.policySubmitMarginMs, 20);
  assert.equal(before.policyMaxVideoFrames, 24); assert.equal(before.policyMaxVideoBytes, 64 * 1024 * 1024);
  for (let i = 0; i < 10; i++) assert.deepEqual(timing.stats(), before);
  assert.equal(timing.plan(), plan, 'diagnostics cannot apply or replace a plan');
  timing.mode('airplay-mirror'); timing.observe('video', 995);
  assert.equal(timing.stats().policyVideoTargetMs, 40); assert.equal(timing.stats().policyVideoMarginMs, 30);
  assert.equal(timing.stats().policyTargetReason, 'initial-floor');
  timing.observe('video', 0);
  assert.equal(timing.stats().policyVideoTargetMs, 280); assert.equal(timing.stats().policyTargetReason, 'ceiling');
});

test('short touch evidence counts transitions once and separates physical touch, hold and applied convergence', () => {
  let at = 1000;
  const timing = createMediaTiming(() => {}, () => at);
  timing.mode('carplay'); timing.observe('video', 750); timing.started();
  const baseline = timing.stats();
  timing.interaction(true); timing.interaction(true);
  const entered = timing.stats(), plan = timing.plan();
  assert.equal(entered.policyInteractionStarts, 1); assert.equal(entered.policyProfileSwitches, baseline.policyProfileSwitches + 1);
  assert.equal(entered.policyVideoMarginMs, 0); assert.equal(entered.policyVideoTargetMs, 0);
  assert.equal(entered.policyTargetReason, 'touch'); assert.equal(entered.policyVideoLeadRemainingMs, 0);
  assert.ok(entered.policyVideoPlanDurationMs > 0); assert.equal(entered.policyInteractionActive, true);
  at += 10; timing.interaction(true); timing.interaction(false); timing.interaction(false);
  assert.equal(timing.stats().policyInteractionStarts, 1); assert.equal(timing.stats().policyInteractionReleases, 1);
  assert.equal(timing.plan(), plan, 'duplicate main/sink notifications and moves cannot restart convergence');
  at += 749;
  assert.equal(timing.stats().policyInteractionActive, false); assert.equal(timing.stats().policyHoldRemainingMs, 1);
  at += 2;
  const expired = timing.stats();
  assert.equal(expired.policyHoldRemainingMs, 0); assert.equal(timing.plan().playbackProfile, 'carplay-touch', 'reading expired eligibility cannot apply a different plan');
  timing.observe('video', at - 50);
  assert.equal(timing.plan().playbackProfile, 'carplay'); assert.equal(timing.stats().policyVideoMarginMs, 20);
  const counts = timing.stats(); timing.reset();
  for (const key of ['policyInteractionStarts', 'policyInteractionReleases', 'policyProfileSwitches', 'policyPlanChanges'])
    assert.equal(timing.stats()[key], counts[key], 'lifetime counters survive stream resets');
});

test('CarPlay readiness keeps bounded independent timelines with a smoother non-interactive profile', () => {
  let at = 1000;
  const timing = createMediaTiming(() => {}, () => at);
  timing.mode('carplay'); timing.observe('video', 900);
  const video = timing.plan(); timing.observe('audio', 500);
  assert.equal(timing.limit(), 300); assert.equal(timing.plan(), video);
  assert.equal(timing.delay('video'), 120); assert.equal(timing.delay('audio'), 280);
  const plans = { video: constantDelay(290), audio: constantDelay(-30) };
  assert.equal(audioDelayAt(plans, at, 'carplay'), -30, 'signed audio delay is independent of video');
  plans.audio = constantDelay(200); assert.equal(audioDelayAt(plans, at, 'carplay'), 200);
  plans.video = constantDelay(-200); assert.equal(audioDelayAt(plans, at, 'carplay'), 200);
  plans.audio = constantDelay(500); assert.equal(audioDelayAt(plans, at, 'carplay'), 500, 'the output deadline controller validates age without rewriting the independent audio plan');
  assert.equal(videoExpired(1000, 'carplay', 1300), false);
  assert.equal(videoExpired(1000, 'carplay', 1300.001), true);
});

test('the shared video plan converges continuously and repeated touch preserves speed without reviving backlog', () => {
  let at = 1000;
  const timing = createMediaTiming(() => {}, () => at);
  timing.mode('carplay'); timing.observe('video', 750); timing.observe('audio', 900); timing.started();
  const audio = timing.plan('audio');
  timing.interaction(true);
  let previous = at - timing.delay(), previousSpeed = 1;
  for (at = 1008; at <= 6000; at += 8) {
    const position = at - timing.delay();
    const before = delayAt(timing.plan(), at - 0.5), after = delayAt(timing.plan(), at + 0.5);
    const speed = 1 - (after - before);
    assert.ok(position >= previous); assert.ok(position <= at + 1e-9);
    assert.ok(speed >= 1 - 1e-9 && speed <= 1.25 + 1e-6);
    assert.ok(Math.abs(speed - previousSpeed) <= 0.01, 'source-clock speed changes smoothly');
    if (at < 1300) {
      const plan = timing.plan(); timing.interaction(true);
      assert.equal(timing.plan(), plan); assert.equal(at - timing.delay(), position);
    } else if (at === 1304) timing.interaction(false);
    assert.equal(timing.plan('audio'), audio);
    previous = position; previousSpeed = speed;
  }
  assert.equal(timing.delay(), 0); assert.equal(timing.profile().name, 'carplay');
  at = 9000; assert.equal(timing.delay(), 0, 'release never restores the pre-touch video backlog');
});

test('touch skips decoded pictures while preserving full input semantics and the independent audio plan', () => {
  let now = 1000;
  const shown = [], timers = new Map(); let nextId = 0;
  const frames = createTimedFrames((frame, config, id, source, audioEvidence) => {
    assert.equal(audioEvidence?.earliest, undefined); assert.equal(audioEvidence?.latest, undefined);
    shown.push({ source, at: now }); frame.close();
  }, { now: () => now, schedule: (callback, delay) => {
    const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id;
  }, cancel: id => timers.delete(id) });
  const timing = createMediaTiming(plans => frames.delay(plans.video), () => now);
  timing.mode('carplay'); timing.observe('video', 750); timing.observe('audio', 900); timing.started();
  const audio = timing.plan('audio');
  frames.audio({ mode: 'carplay', type: 0, state: 'paused', generation: 1, sequence: 1, at: now });
  const advance = target => {
    now = target; // A busy display task processes overdue timers together, so selection must coalesce decoded pictures.
    for (;;) {
      const next = [...timers.entries()].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); next[1].callback();
    }
    now = target;
  };
  timing.interaction(true);
  let source = 750;
  for (let step = 1; step <= 240; step++) {
    advance(1000 + step * 20);
    while (source + 1000 / 60 <= now - 40) {
      source += 1000 / 60;
      frames.present({ displayWidth: 800, displayHeight: 480, close() {} }, { mode: 'carplay' }, 1, source);
    }
    if (step < 50) timing.interaction(true); else timing.interaction(false);
    assert.ok(frames.stats().decodedQueueFrames <= playbackProfile('carplay').maxVideoFrames);
    assert.equal(timing.plan('audio'), audio);
  }
  assert.ok(shown.length > 150); assert.ok(shown.every(item => item.at - item.source <= 300.001));
  assert.ok(shown.at(-1).at - shown.at(-1).source < 70, 'converges to the available decoded frontier');
  assert.ok(frames.stats().touchSkippedFrames > 0); assert.equal(frames.stats().audioSyncDroppedFrames, 0);
  frames.reset();
});
