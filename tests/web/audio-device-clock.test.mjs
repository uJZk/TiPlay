// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioDeviceClock, MAX_RATE_ERROR, rateProjectionUncertainty } from '../../site/play/audio-device-clock.js';

function measure(clock, rate, start, end, { quantum = 128 / 48, jitter = 0 } = {}) {
  for (let ms = start; ms <= end; ms += 40) {
    // Raw output timestamps may quantize the sample cursor and performance time.
    const contextMs = Math.floor(ms * rate / quantum) * quantum;
    const performanceMs = 1700000000000 + Math.round(ms + jitter * Math.sin(ms * 0.37));
    clock.observe(contextMs, performanceMs, performanceMs + 5);
  }
}

test('context projection uncertainty covers independent physical rates including opposite range endpoints', () => {
  for (const applied of [.98, .986, 1, 1.014, 1.02]) for (const physical of [.98, .994, 1, 1.006, 1.02]) {
    for (const span of [-1000, -200, 0, 200, 1000]) {
      const projectedWall = span / applied, actualWall = span / physical;
      assert.ok(Math.abs(projectedWall - actualWall) <= rateProjectionUncertainty(span, applied) + 1e-12);
    }
  }
  assert.ok(rateProjectionUncertainty(1000, .98) > 40, '2% times span cannot cover a switch between opposite endpoints');
});

test('an even two-bin quantized history uses centered MAD without inventing a full block of noise', () => {
  const clock = new AudioDeviceClock(), quantumMs = 1024 / 48;
  clock.debug(true);
  for (let i = 0; i < 40; i++) {
    const at = 10000 + i * 200;
    clock.observe(at + (i % 2 ? quantumMs : 0), at, at, quantumMs);
  }
  const fit = clock.snapshot();
  assert.equal(fit.fitStatus, 'tracking');
  assert.ok(fit.fitDispersionMs <= quantumMs / 2 + 1e-9);
  assert.ok(fit.uncertaintyMs >= quantumMs / 2);
});

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
  const clock = new AudioDeviceClock(); clock.debug(true); measure(clock, 1.04, 0, 30000);
  const snapshot = clock.snapshot(1700000030005);
  assert.equal(snapshot.fitStatus, 'acquiring'); assert.equal(snapshot.fitRejectReason, 'out-of-range');
  assert.ok(snapshot.fitRejected > 0); assert.equal(snapshot.acceptedFitAgeMs, undefined);
  assert.equal(snapshot.ratePpm, 0); assert.equal(snapshot.targetRatePpm, 0);
  assert.ok(Number.isFinite(snapshot.fitDispersionMs)); assert.equal(snapshot.uncertaintyMs, null);
});

test('the device MAD gate accepts 3 ms inclusively and rejects just above it', () => {
  // Binary fractions keep the fixture's rate and residuals exactly representable.
  // This balanced noise has median=0, fitted slope=rate and MAD=dispersion.
  const rate = 1 + 1 / 256, pattern = [-1, -1, 0, 1, 1], epsilonMs = 1 / 4096;
  for (const dispersion of [3 - epsilonMs, 3, 3 + epsilonMs]) {
    const clock = new AudioDeviceClock(); clock.debug(true);
    for (let i = 0; i <= 40; i++) {
      const at = i * 200;
      clock.observe(100 + at * rate + pattern[i % pattern.length] * dispersion, at, at);
    }
    const snapshot = clock.snapshot(8500);
    assert.equal(snapshot.generation, 1, 'noise cannot turn this fit-gate fixture into a timeline reset');
    assert.equal(snapshot.points, 41);
    assert.equal(snapshot.fitDispersionMs, dispersion, 'the current attempt is logged even when rejected');
    if (dispersion <= 3) {
      assert.equal(snapshot.fitStatus, 'tracking'); assert.equal(snapshot.fitRejectReason, 'none');
      assert.equal(snapshot.fitRejected, 0); assert.equal(snapshot.uncertaintyMs, dispersion);
      assert.equal(clock.targetRate, rate); assert.ok(snapshot.confidence > 0);
      assert.equal(snapshot.acceptedFitAgeMs, 700);
    } else {
      assert.equal(snapshot.fitStatus, 'acquiring'); assert.equal(snapshot.fitRejectReason, 'noisy');
      assert.ok(snapshot.fitRejected > 0); assert.equal(snapshot.confidence, 0);
      assert.equal(snapshot.uncertaintyMs, null); assert.equal(snapshot.acceptedFitAgeMs, undefined);
      assert.equal(clock.targetRate, 1);
    }
  }
});

test('a just-over-limit device MAD cannot replace an accepted correction or renew its age', () => {
  const clock = new AudioDeviceClock(), rate = 1 + 1 / 256;
  clock.debug(true);
  for (let at = 0; at <= 9000; at += 100) clock.observe(100 + at * rate, at, at);
  const accepted = clock.snapshot(9000);
  assert.equal(clock.rate, rate); assert.equal(clock.targetRate, rate);
  assert.equal(accepted.uncertaintyMs, 0); assert.equal(accepted.acceptedFitAgeMs, 0);
  assert.equal(accepted.fitDispersionMs, 0);

  // Replace only the fit window, isolating this exact rejection from gradual
  // mixtures of the old clean window and new noise. The final point still enters
  // through observe(), including timestamp ordering, reset and fit scheduling.
  const pattern = [-1, -1, 0, 1, 1], dispersion = 3 + 1 / 4096;
  const point = i => ({ performanceTimeMs: 10000 + i * 200,
    contextTimeMs: 100 + (10000 + i * 200) * rate + pattern[i % pattern.length] * dispersion });
  clock.points = Array.from({ length: 40 }, (_, i) => point(i));
  clock.last = clock.points.at(-1); clock.lastFit = -Infinity;
  const last = point(40); clock.observe(last.contextTimeMs, last.performanceTimeMs, 18000);
  const held = clock.snapshot(18500), later = clock.snapshot(20500);
  assert.equal(held.generation, accepted.generation); assert.equal(held.fitStatus, 'holdover');
  assert.equal(held.fitRejectReason, 'noisy'); assert.equal(held.fitRejected, 1);
  assert.equal(held.confidence, 0); assert.equal(held.uncertaintyMs, accepted.uncertaintyMs);
  assert.equal(held.fitDispersionMs, dispersion, 'a noisy attempt cannot masquerade as the retained zero uncertainty');
  assert.equal(held.ratePpm, accepted.ratePpm); assert.equal(held.targetRatePpm, accepted.targetRatePpm);
  assert.equal(held.acceptedFitAgeMs, 9500); assert.equal(later.acceptedFitAgeMs, 11500);
  assert.deepEqual({ ...later, acceptedFitAgeMs: held.acceptedFitAgeMs }, held);
});

test('device fit MAD starts unknown for each Debug interval and clears on a timeline reset', () => {
  const clock = new AudioDeviceClock(), rate = 1 + 1 / 256;
  for (let at = 0; at <= 9000; at += 100) clock.observe(100 + at * rate, at, at);
  assert.equal(clock.snapshot().fitDispersionMs, undefined);
  clock.debug(true);
  assert.equal(clock.snapshot().fitDispersionMs, undefined, 'an earlier fit outside this capture remains unknown');
  clock.observe(100 + 9100 * rate, 9100);
  assert.equal(clock.snapshot().fitDispersionMs, undefined, 'a sample without a new fit cannot invent a MAD');
  clock.observe(100 + 9500 * rate, 9500);
  assert.equal(clock.snapshot().fitDispersionMs, 0);
  clock.debug(false); clock.observe(100 + 10000 * rate, 10000);
  assert.equal(clock.fitDispersionMs, null); assert.equal(clock.snapshot().fitDispersionMs, undefined);
  clock.debug(true); assert.equal(clock.snapshot().fitDispersionMs, undefined);
  clock.reset('context');
  for (let at = 0; at < 4000; at += 100) clock.observe(100 + at * rate, at, at);
  assert.equal(clock.snapshot().fitDispersionMs, undefined, 'an immature replacement timeline has no fitted noise yet');
  clock.observe(100 + 4000 * rate, 4000);
  assert.equal(clock.snapshot().fitDispersionMs, 0);
});

test('collecting or reading current device-fit MAD cannot change the oscillator or its accepted evidence', () => {
  const control = new AudioDeviceClock(), observed = new AudioDeviceClock();
  for (let i = 0; i <= 250; i++) {
    if (i === 50 || i === 100) observed.debug(true);
    if (i === 75 || i === 175) observed.debug(false);
    const at = i * 100, noise = [-2, -1, 0, 1, 2][i % 5];
    for (const clock of [control, observed]) clock.observe(100 + at * (1 + 1 / 256) + noise, at, at);
    const { fitDispersionMs, ...evidence } = observed.snapshot(at);
    assert.deepEqual(evidence, control.snapshot(at));
    assert.deepEqual(observed.points, control.points);
    assert.equal(observed.rate, control.rate); assert.equal(observed.targetRate, control.targetRate);
    assert.equal(observed.lastFit, control.lastFit); assert.equal(observed.lastAdvance, control.lastAdvance);
    assert.deepEqual(observed.snapshot(at), { ...evidence, ...(fitDispersionMs === undefined ? {} : { fitDispersionMs }) });
  }
});

test('device-fit pairs include exactly 2 seconds and exclude just-shorter pairs', () => {
  // Asymmetric timestamp noise bounded by 1ms makes the extra near-2s pairs
  // change the median. Both sides keep 25 points, >4s span and MAD well below 3ms.
  const offsets = [-.75, -.5, -.25, -.25, .875, .125, -.375, .125, .625, -.875,
    0, -.375, .5, -.25, -.125, .125, -.5, .25, .75, -.25, -.125, 1, -.25, -1, -.5];
  for (const interval of [200 - 1 / 4096, 200, 200 + 1 / 4096]) {
    const clock = new AudioDeviceClock();
    for (let i = 0; i < offsets.length; i++) {
      const at = i * interval; clock.observe(100 + at + offsets[i], at, at);
    }
    // The shorter-pair exclusion chooses the 0→16 slope (0.25ms/16 intervals).
    // At and above the boundary, admitting the 10-interval pairs moves the
    // median to the 6→19 slope (0.125ms/13 intervals).
    const expected = interval < 200 ? 1 + .25 / (16 * interval) : 1 + .125 / (13 * interval);
    const snapshot = clock.snapshot();
    assert.equal(snapshot.fitStatus, 'tracking'); assert.equal(snapshot.fitRejectReason, 'none');
    assert.equal(snapshot.fitRejected, 0); assert.equal(snapshot.points, 25);
    assert.equal(snapshot.acceptedFitAgeMs, 0); assert.ok(snapshot.uncertaintyMs < 1);
    assert.equal(clock.targetRate, expected); assert.equal(snapshot.generation, 1);
  }
});
