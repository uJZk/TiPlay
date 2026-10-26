// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaTiming } from '../../site/play/media-timing.js';
import { constantDelay, delayAt, planDelay } from '../../site/play/delay-plan.js';
import { audioDelayAt } from '../../site/play/playback-window.js';

test('audio readiness and video readiness retain independent bounded plans', () => {
  let now = 1000;
  const timing = createMediaTiming(() => {}, () => now); timing.mode('carplay');
  timing.observe('video', 950); const video = timing.plan();
  timing.observe('audio', 0);
  assert.equal(timing.plan(), video); assert.equal(timing.delay(), 70);
  assert.equal(timing.delay('audio'), 280);
  const audio = timing.plan('audio'); now = 1200; timing.observe('video', 1190);
  assert.equal(timing.plan('audio'), audio);
  timing.reset(); assert.equal(timing.delay(), 60); assert.equal(timing.delay('audio'), 60);
});

test('the first timestamp after fallback playback cannot jump the effective delay', () => {
  let now = 1000;
  const timing = createMediaTiming(() => {}, () => now);
  timing.started();
  timing.observe('audio', 800);
  assert.equal(timing.plan('audio').to, 220); assert.equal(timing.delay('audio'), 60); assert.equal(timing.delay(), 60);
  now = 1086; assert.ok(Math.abs(timing.delay('audio') - 60.02) < 0.000001);
});

test('CarPlay and AirPlay mirror use their own shared delay caps', () => {
  for (const [mode, limit] of [['carplay', 300], ['airplay-mirror', 300]]) {
    const changes = [], timing = createMediaTiming(plan => changes.push(plan), () => 1000);
    timing.mode(mode); timing.observe('audio', -10000); timing.observe('video', -10000);
    assert.equal(timing.limit(), limit); assert.equal(timing.delay(), Math.max(0, limit - 20)); assert.equal(timing.plan().to, Math.max(0, limit - 20));
    assert.ok(changes.every(plans => plans.video.from >= 0 && plans.video.to >= 0 && plans.video.from <= limit && plans.video.to <= limit));
    const same = timing.plan(); timing.mode(mode); assert.equal(timing.plan(), same, 'same-mode codec/resize config preserves the common ramp');
  }
});

test('frequent video ramp changes never alter audio source position', () => {
  const audio = planDelay(constantDelay(60), 90, 900);
  let video = constantDelay(80);
  for (const [at, target] of [[1000, 120], [1050, 200], [1100, 0], [1150, 180], [1200, 70]]) {
    video = planDelay(video, target, at);
    for (let wall = at; wall < at + 125; wall += 0.125) {
      assert.equal(audioDelayAt({ video, audio }, wall), delayAt(audio, wall));
    }
  }
});
