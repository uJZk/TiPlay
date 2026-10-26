// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaTiming } from '../../site/play/media-timing.js';
import { audioDelayAt, videoExpired } from '../../site/play/playback-window.js';
import { constantDelay } from '../../site/play/delay-plan.js';

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
