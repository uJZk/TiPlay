// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFpsWindow, formatPerformanceMonitor, performanceStats } from '../../site/play/fps-window.js';
import { sampleClock, presentationTime } from '../../site/play/clock-sync.js';

test('average draw count exposes burst spacing instead of establishing display refresh rate', () => {
  const window = createFpsWindow();
  for (let refresh = 0; refresh < 20; refresh++) {
    window.frame(1 + refresh * 50);
    window.frame(2 + refresh * 50);
  }
  const stats = window.stats(1000);
  assert.equal(stats.currentFps, 40);
  assert.equal(stats.frameIntervalP95Ms, 49);
  assert.equal(stats.frameIntervalMaxMs, 49);
  assert.equal(stats.lastDrawAgeMs, 48);
});

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
  assert.equal(formatPerformanceMonitor('H.264'), 'H.264 · — fps · — ms · — drops');
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

test('performance monitor has codec, current FPS, current Delta and explicit dropped-frame total', () => {
  const stats = { currentFps: 60, currentDelta: 5.2, presentationOffset90: 99, presentationOffsetHigh5: 34.1,
    decodeDroppedFrames: 1, scheduledDroppedFrames: 2, transferDroppedFrames: 3, renderDroppedFrames: 4 };
  assert.equal(formatPerformanceMonitor('HEVC', stats), 'HEVC · 60 fps · 5 ms · 10 drops');
  assert.equal(formatPerformanceMonitor('HEVC', stats).split(' · ').length, 4);
  assert.equal(performanceStats(stats).droppedFrames, 10);
  assert.equal(performanceStats({ decoded: 100, expiredFrames: 20 }).droppedFrames, null, 'unrelated counts never imply drops');
});

test('early presentation stays negative and the slowest tail contains the largest signed offsets', () => {
  const window = createFpsWindow();
  let at = 0;
  for (const offset of [-100, ...Array(18).fill(-40), -10]) window.frame(at += 16, 1, offset);
  const stats = window.stats(at);
  assert.equal(stats.presentationOffset90, -40);
  assert.equal(stats.presentationOffsetHigh5, -10);
  assert.equal(formatPerformanceMonitor('HEVC', stats), 'HEVC · 20 fps · -10 ms · — drops');
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
  assert.equal(formatPerformanceMonitor('HEVC', window.stats()), 'HEVC · 0 fps · — ms · — drops');
  window.reset();
  assert.equal(window.stats().currentFps, 0);
  assert.equal(window.stats().presentationOffset90, null);
});

test('current Delta belongs to the latest successful draw and never reuses a previous timed frame', () => {
  const window = createFpsWindow();
  window.frame(0, 1, -40);
  window.frame(20, 1, 7);
  assert.equal(window.stats(20).currentDelta, 7);
  window.frame(40, 1, null);
  assert.equal(window.stats(40).currentDelta, null);
  assert.ok(Number.isFinite(window.stats(40).presentationOffset90), 'older window diagnostics remain available');
  window.frame(60, 1, 0);
  assert.equal(window.stats(60).currentDelta, 0);
  assert.equal(window.stats(1060).currentDelta, null);
  window.reset();
  assert.equal(window.stats(1060).currentDelta, null);
});
