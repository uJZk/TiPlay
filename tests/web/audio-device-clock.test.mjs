// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioDeviceClock } from '../../site/play/audio-device-clock.js';

function measure(clock, rate, start, end, { quantum = 128 / 48, jitter = 0 } = {}) {
  for (let ms = start; ms <= end; ms += 40) {
    // Raw output timestamps may quantize the sample cursor and performance time.
    const contextMs = Math.floor(ms * rate / quantum) * quantum;
    const performanceMs = 1700000000000 + Math.round(ms + jitter * Math.sin(ms * 0.37));
    clock.observe(contextMs, performanceMs, performanceMs + 5);
  }
}

test('independent output clock acquires both drift signs through timestamp quantization and jitter', () => {
  for (const rate of [0.996, 1.004, 1]) {
    const clock = new AudioDeviceClock(); measure(clock, rate, 0, 45000, { jitter: 0.7 });
    assert.ok(Math.abs(clock.rate - rate) < 0.00006, `${rate}: ${clock.rate}`);
    assert.ok(clock.confidence > 0.3);
    assert.ok(clock.points.length <= 161);
    assert.equal(clock.generation, 1, 'sample quantization does not reset the output timeline');
  }
});

test('unavailable/repeated samples cannot fabricate device drift, and implausible rates stay nominal', () => {
  const clock = new AudioDeviceClock();
  for (let at = 0; at < 20000; at += 40) clock.observe(0, 1700000000000, 1700000000000 + at);
  assert.equal(clock.rate, 1); assert.equal(clock.confidence, 0);
  clock.observe(NaN, 1700000020000); assert.equal(clock.points.length, 1);
  const bad = new AudioDeviceClock(); measure(bad, 1.04, 0, 30000);
  assert.equal(bad.rate, 1); assert.equal(bad.confidence, 0);
});

test('real output steps, backwards pairs and long gaps start a new fit instead of becoming drift', () => {
  const clock = new AudioDeviceClock(); measure(clock, 0.996, 0, 15000);
  assert.ok(clock.rate < 0.997);
  let generation = clock.generation;
  clock.observe(15040 * 0.996 + 60, 1700000015040);
  assert.equal(clock.generation, ++generation); assert.equal(clock.reason, 'step'); assert.equal(clock.rate, 1);
  clock.observe(14000, 1700000015080);
  assert.equal(clock.generation, ++generation); assert.equal(clock.reason, 'backwards');
  clock.observe(17000, 1700000018000);
  assert.equal(clock.generation, ++generation); assert.equal(clock.reason, 'gap');
  clock.reset('suspended'); assert.equal(clock.points.length, 0); assert.equal(clock.confidence, 0);
});

test('isolated timestamp disturbance never trains a false long-lived output rate', () => {
  const clock = new AudioDeviceClock();
  for (let ms = 0; ms <= 30000; ms += 40) {
    const disturbance = ms === 14000 ? 18 : 0;
    clock.observe(ms + disturbance, 1700000000000 + ms);
  }
  assert.ok(Math.abs(clock.rate - 1) < 0.00001);
  assert.ok(clock.confidence > 0.5);
});
