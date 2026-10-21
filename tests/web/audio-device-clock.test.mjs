// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioDeviceClock, MAX_RATE_ERROR } from '../../site/play/audio-device-clock.js';

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

test('the permitted oscillator endpoints are inclusive and truly out-of-range rates remain rejected', () => {
  for (const rate of [1 - MAX_RATE_ERROR, 1 + MAX_RATE_ERROR]) {
    const clock = new AudioDeviceClock();
    for (let ms = 0; ms <= 60000; ms += 100) clock.observe(ms * rate, 1000000 + ms, 1000000 + ms);
    const snapshot = clock.snapshot(1060000);
    assert.equal(snapshot.fitStatus, 'tracking');
    assert.equal(snapshot.fitRejectReason, 'none');
    assert.equal(snapshot.fitRejected, 0, 'subtracting one must not move an inclusive endpoint outside its own range');
    assert.ok(Math.abs(clock.rate - rate) < 1e-12);
  }
  for (const rate of [1 - MAX_RATE_ERROR - .000001, 1 + MAX_RATE_ERROR + .000001]) {
    const clock = new AudioDeviceClock();
    for (let ms = 0; ms <= 60000; ms += 100) clock.observe(ms * rate, 1000000 + ms, 1000000 + ms);
    const snapshot = clock.snapshot(1060000);
    assert.equal(snapshot.fitStatus, 'acquiring');
    assert.equal(snapshot.fitRejectReason, 'out-of-range');
    assert.ok(snapshot.fitRejected > 0);
    assert.equal(clock.rate, 1);
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

test('rejected fits identify retained device-rate holdover without refreshing accepted evidence', () => {
  const clock = new AudioDeviceClock(), origin = 1700000000000;
  assert.equal(clock.snapshot(origin).acceptedFitAgeMs, undefined);
  for (let ms = 0; ms <= 9000; ms += 100) clock.observe(ms * .988, origin + ms, origin + ms + 5);
  const tracked = clock.snapshot(origin + 9005);
  assert.equal(tracked.fitStatus, 'tracking'); assert.equal(tracked.fitRejectReason, 'none');
  assert.equal(tracked.acceptedFitAgeMs, 0); assert.equal(tracked.fitRejected, 0);
  assert.ok(Math.abs(tracked.targetRatePpm + 12000) < .001);
  for (let ms = 9100; ms <= 30000; ms += 100) {
    const noise = (((ms / 100 * 37) % 101) / 100 - .5) * 24;
    clock.observe(ms * .988 + noise, origin + ms, origin + ms + 5);
  }
  const held = clock.snapshot(origin + 30005), later = clock.snapshot(origin + 32005);
  assert.equal(held.fitStatus, 'holdover'); assert.equal(held.fitRejectReason, 'noisy');
  assert.equal(held.confidence, 0); assert.ok(held.fitRejected > 0);
  assert.ok(held.acceptedFitAgeMs > 10000, 'rejected observations cannot renew the accepted fit');
  assert.ok(Math.abs(held.targetRatePpm + 12000) < .001);
  assert.ok(Math.abs(held.ratePpm + 12000) < .001, 'the existing correction remains active during holdover');
  assert.equal(later.acceptedFitAgeMs, held.acceptedFitAgeMs + 2000);
  assert.deepEqual({ ...later, acceptedFitAgeMs: held.acceptedFitAgeMs }, held, 'a read cannot advance the rate or refresh its evidence');
  assert.equal(clock.generation, tracked.generation);
  clock.reset('suspended');
  const reset = clock.snapshot(origin + 33005);
  assert.equal(reset.acceptedFitAgeMs, undefined); assert.equal(reset.fitRejected, 0);
  assert.equal(reset.fitStatus, 'acquiring'); assert.equal(reset.fitRejectReason, 'none'); assert.equal(reset.ratePpm, 0);
});

test('an out-of-range fit remains unaccepted and has an explicit bounded rejection reason', () => {
  const clock = new AudioDeviceClock(); measure(clock, 1.04, 0, 30000);
  const snapshot = clock.snapshot(1700000030005);
  assert.equal(snapshot.fitStatus, 'acquiring'); assert.equal(snapshot.fitRejectReason, 'out-of-range');
  assert.ok(snapshot.fitRejected > 0); assert.equal(snapshot.acceptedFitAgeMs, undefined);
  assert.equal(snapshot.ratePpm, 0); assert.equal(snapshot.targetRatePpm, 0);
});
