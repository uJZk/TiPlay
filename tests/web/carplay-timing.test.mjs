// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaTiming, createTimedFrames, createVideoCatchUpCursor } from '../../site/play/media-timing.js';
import { audioDelayAt, videoExpired } from '../../site/play/playback-window.js';
import { constantDelay } from '../../site/play/delay-plan.js';

test('CarPlay never grows a buffer from readiness or couples audio to video', () => {
  let at = 1000;
  const timing = createMediaTiming(() => {}, () => at);
  timing.mode('carplay'); timing.observe('video', 900); timing.observe('audio', 500);
  assert.equal(timing.limit(), 300); assert.equal(timing.delay('video'), 0); assert.equal(timing.delay('audio'), 0);
  at += 1000; timing.observe('audio', 700); assert.equal(timing.delay(), 0);
  const plans = { video: constantDelay(290), audio: constantDelay(-30) };
  assert.equal(audioDelayAt(plans, at, 'carplay'), -30, 'preserve signed delay without a new lower bound');
  plans.audio = constantDelay(200); assert.equal(audioDelayAt(plans, at, 'carplay'), 200);
  plans.video = constantDelay(-200); assert.equal(audioDelayAt(plans, at, 'carplay'), 200);
  plans.audio = constantDelay(500); assert.equal(audioDelayAt(plans, at, 'carplay'), 300);
  assert.equal(videoExpired(1000, 'carplay', 1300), false);
  assert.equal(videoExpired(1000, 'carplay', 1300.001), true);
});

test('touch cursor converges continuously, repeated events preserve speed and release never restores backlog', () => {
  const cursor = createVideoCatchUpCursor(); cursor.start(750, 1000); cursor.touch(1000);
  let previousPosition = 750, previousSpeed = 1;
  for (let at = 1008; at <= 2500; at += 8) {
    const position = cursor.advance(at), speed = cursor.speed();
    assert.ok(position >= previousPosition); assert.ok(position <= at);
    assert.ok(Math.abs(speed - previousSpeed) <= .004 * 8 + 1e-9);
    if (at < 1300) {
      cursor.touch(at); assert.equal(cursor.speed(), speed); assert.equal(cursor.advance(at), position);
    }
    previousPosition = position; previousSpeed = speed;
  }
  assert.ok(cursor.stats(2496).videoCursorDeltaMs < 1);
  assert.equal(cursor.active(), false);
  cursor.advance(4000); assert.ok(cursor.stats(4000).videoCursorDeltaMs < 1);
});

test('touch skips decoded pictures while leaving independent audio plans untouched', () => {
  let now = 1000;
  const shown = [], plans = { video: constantDelay(0), audio: constantDelay(37) };
  const frames = createTimedFrames((frame, config, id, timing, window) => {
    assert.equal(window, null); shown.push({ source: timing, at: now }); frame.close();
  }, { now: () => now, schedule: () => 1, cancel() {} });
  frames.delay(plans.video);
  frames.audio({ mode: 'carplay', type: 0, state: 'paused', generation: 1, sequence: 1, at: now });
  let source = 800;
  frames.present({ close() {} }, { mode: 'carplay' }, 1, source);
  frames.touch();
  for (let step = 1; step <= 60; step++) {
    now = 1000 + step * 20;
    while (source + 1000 / 60 <= now - 40) {
      source += 1000 / 60; frames.present({ close() {} }, { mode: 'carplay' }, 1, source);
    }
    frames.delay(plans.video);
    if (step < 50) frames.touch();
    assert.ok(frames.stats().decodedQueueSize <= 20);
  }
  assert.ok(shown.length > 50);
  assert.ok(shown.every(item => item.at - item.source <= 300));
  assert.ok(shown.at(-1).at - shown.at(-1).source < 70, 'converges to available decoded frontier');
  assert.ok(frames.stats().touchSkippedFrames > 0);
  assert.equal(plans.audio.to, 37); assert.equal(frames.stats().audioSyncDroppedFrames, 0);
  frames.reset();
});
