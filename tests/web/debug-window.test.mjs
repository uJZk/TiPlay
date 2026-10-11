// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFpsWindow, formatDebugFps } from '../../site/play/fps-window.js';
import { sampleClock, captureTime } from '../../site/play/clock-sync.js';

test('middle 90% excludes both tails, slow FPS and worst latency use the upper duration tail', () => {
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
  assert.equal(stats.latency90, 10);
  assert.equal(stats.latencyHigh5, 100);
  assert.equal(stats.fpsSamples, 20);
});

test('warm-up, expiration and reset never retain stale data', () => {
  const window = createFpsWindow();
  window.frame(0);
  window.frame(20, 1, 0);
  assert.ok(Math.abs(window.stats(20).fps90 - 50) < 1e-9);
  assert.equal(window.stats(20).latency90, 0);
  assert.equal(window.stats(5020).fps90, null);
  assert.equal(window.stats(5020).latency90, null);
  window.reset();
  window.frame(6000, 1, -1);
  assert.equal(window.stats(6000).fps90, null);
  assert.equal(window.stats(6000).latency90, null);
  assert.equal(formatDebugFps('H.264'), 'H.264 • — • — • — • —');
});

test('browser clock bridge rejects missing, slow, expired and future timestamps', () => {
  const clock = sampleClock(100, 1000, 1020);
  assert.equal(clock.offset, 910);
  assert.equal(captureTime(90, clock, 1030), 1000);
  assert.equal(sampleClock(undefined, 1000, 1020), null);
  assert.equal(sampleClock(100, 1000, 2101), null);
  assert.equal(captureTime(90, clock, 16021), null);
  assert.equal(captureTime(1000, clock, 1030), null);
  assert.equal(captureTime(90, null, 1030), null);
});
