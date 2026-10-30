// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFpsWindow, createReceiveProcessingTracker, formatPerformanceMonitor, performanceStats } from '../../site/play/fps-window.js';
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
  assert.equal(formatPerformanceMonitor('H.264'), 'H.264 · — fps · recv — ms · RTC — / app — drops');
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

test('performance monitor separates receive processing and browser, transfer and renderer drops', () => {
  const stats = { currentFps: 60, currentDelta: 5.2, presentationOffset90: 99, presentationOffsetHigh5: 34.1,
    decodeDroppedFrames: 1, scheduledDroppedFrames: 2, transferDroppedFrames: 3, renderDroppedFrames: 4 };
  const rtp = { state: 'selected', sampleAgeMs: 20, receiveProcessingMs: 8.1, framesDropped: 83 };
  assert.equal(formatPerformanceMonitor('HEVC', stats, rtp), 'HEVC · 60 fps · recv 8 ms · RTC 83 / app pre — in — out 3 render 4 drops');
  assert.equal(formatPerformanceMonitor('HEVC', stats).split(' · ').length, 4);
  assert.equal(formatPerformanceMonitor('HEVC', { ...stats, mainTransferDroppedFrames: 2 }, { ...rtp, sampleAgeMs: 5001 }),
    'HEVC · 60 fps · recv — ms · RTC — / app pre — in 2 out 3 render 4 drops');
  assert.equal(formatPerformanceMonitor('HEVC', stats, rtp, 'zh'),
    'HEVC · 60 fps · 接收处理 8 ms · RTC 83 / 应用 预 — 入 — 出 3 绘制 4 丢帧');
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
  assert.equal(formatPerformanceMonitor('HEVC', stats), 'HEVC · 20 fps · recv — ms · RTC — / app — drops');
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
  assert.equal(formatPerformanceMonitor('HEVC', window.stats()), 'HEVC · 0 fps · recv — ms · RTC — / app — drops');
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

test('receive processing uses fresh consecutive samples of the same RTP stream and generation', () => {
  const tracker = createReceiveProcessingTracker();
  const stats = (id, timestamp, framesDecoded, totalProcessingDelay) => ({ id, timestamp, framesDecoded, totalProcessingDelay });
  assert.equal(tracker.sample(stats('one', 1000, 10, .1), 1), null);
  assert.ok(Math.abs(tracker.sample(stats('one', 2000, 30, .3), 1) - 10) < 1e-8);
  assert.equal(tracker.sample(stats('two', 3000, 40, .4), 1), null);
  assert.equal(tracker.sample(stats('two', 4000, 50, .5), 2), null);
  assert.equal(tracker.sample(stats('two', 10000, 60, .6), 2), null, 'stale baseline');
  assert.equal(tracker.sample(stats('two', 11000, 60, .6), 2), null, 'no new frames');
  assert.equal(tracker.sample(stats('two', 12000, 70, .1), 2), null, 'counter reset');
  assert.equal(tracker.sample({ timestamp: 13000, framesDecoded: 80, totalProcessingDelay: .2 }, 2), null, 'no identity');
  assert.equal(tracker.sample(stats('two', 14000, 90, .3), 2), null, 'invalid sample clears baseline');
  tracker.reset();
  assert.equal(tracker.sample(stats('two', 15000, 100, .4), 2), null);
});
