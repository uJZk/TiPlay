// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFpsWindow, formatDebugFps } from '../../site/play/fps-window.js';
import { sampleClock, presentationTime } from '../../site/play/clock-sync.js';

test('middle 90% excludes both tails, slow FPS and worst presentation offset use the upper duration tail', () => {
  const window = createFpsWindow({ now: () => 1000 });
  let at = 0;
  window.frame(at);
  for (const duration of [1, ...Array(18).fill(10), 100]) {
    at += duration;
    window.frame(at, 1, duration);
  }
  const stats = window.stats(at);
  assert.equal(stats.fps90, 100);
  assert.equal(stats.fpsLow5, 10);
  assert.equal(stats.presentationOffset90, 10);
  assert.equal(stats.presentationOffsetHigh5, 100);
  assert.equal(stats.fpsSamples, 20);
});

test('warm-up, expiration and reset never retain stale data', () => {
  const window = createFpsWindow();
  window.frame(0);
  window.frame(20, 1, 0);
  assert.ok(Math.abs(window.stats(20).fps90 - 50) < 1e-9);
  assert.equal(window.stats(20).presentationOffset90, 0);
  assert.equal(window.stats(5020).fps90, null);
  assert.equal(window.stats(5020).presentationOffset90, null);
  window.reset();
  window.frame(6000, 1, -1);
  assert.equal(window.stats(6000).fps90, null);
  assert.equal(window.stats(6000).presentationOffset90, -1);
  assert.equal(formatDebugFps('H.264'), 'H.264 · — fps · — ms · — ms');
});

test('browser clock bridge preserves scheduled future presentation and rejects unrelated clocks', () => {
  const clock = sampleClock(100, 1000, 1020);
  assert.equal(clock.offset, 910);
  assert.equal(presentationTime(90, clock, 1030), 1000);
  assert.equal(sampleClock(undefined, 1000, 1020), null);
  assert.equal(sampleClock(100, 1000, 2101), null);
  assert.equal(presentationTime(90, clock, 16021), null);
  assert.equal(presentationTime(1000, clock, 1030), 1910);
  assert.equal(presentationTime(10121, clock, 1030), null);
  assert.equal(presentationTime(90, null, 1030), null);
});

test('Debug has exactly four fields without hardware/software labels', () => {
  const stats = { currentFps: 60, fps90: 99, fpsLow5: 12, presentationOffset90: 5.2, presentationOffsetHigh5: 34.1, acceleration: 'prefer-hardware' };
  assert.equal(formatDebugFps('HEVC', stats), 'HEVC · 60 fps · 5 ms · 34 ms');
  assert.equal(formatDebugFps('HEVC', { ...stats, acceleration: 'prefer-software' }), 'HEVC · 60 fps · 5 ms · 34 ms');
  assert.equal(formatDebugFps('HEVC', stats).split(' · ').length, 4);
});

test('early presentation stays negative and the slowest tail contains the largest signed offsets', () => {
  const window = createFpsWindow();
  let at = 0;
  for (const offset of [-100, ...Array(18).fill(-40), -10]) window.frame(at += 16, 1, offset);
  const stats = window.stats(at);
  assert.equal(stats.presentationOffset90, -40);
  assert.equal(stats.presentationOffsetHigh5, -10);
  assert.equal(formatDebugFps('HEVC', stats), 'HEVC · 20 fps · -40 ms · -10 ms');
});

test('current FPS counts actual draws in a rolling second and reaches zero while offsets retain their five-second window', () => {
  let now = 0;
  const window = createFpsWindow({ now: () => now });
  assert.equal(window.stats().currentFps, 0);
  window.frame(0, 1, -40);
  window.frame(250, 1, -40);
  window.frame(500, 99, -40); // Delivery counts cannot multiply the actual draw count.
  now = 500;
  assert.equal(window.stats().currentFps, 3);
  now = 1000;
  assert.equal(window.stats().currentFps, 2);
  now = 1250;
  assert.equal(window.stats().currentFps, 1);
  now = 1500;
  assert.equal(window.stats().currentFps, 0);
  assert.equal(window.stats().presentationOffset90, -40);
  assert.equal(formatDebugFps('HEVC', window.stats()), 'HEVC · 0 fps · -40 ms · -40 ms');
  window.reset();
  assert.equal(window.stats().currentFps, 0);
  assert.equal(window.stats().presentationOffset90, null);
});
