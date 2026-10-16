// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClockEstimator, mapClockTime, presentationTime, sampleClock } from '../../site/play/clock-sync.js';

function simulation({ rate = 1.00018, serverOrigin = 3_000_000_000_000, localOrigin = 1_800_000_000_000 } = {}) {
  const local = elapsed => localOrigin + elapsed * rate;
  return {
    local, server: elapsed => serverOrigin + elapsed,
    probe(estimator, elapsed, { outbound = 2, inbound = 2, serverStep = 0, localStep = 0 } = {}) {
      return estimator.observe(serverOrigin + elapsed + serverStep,
        local(elapsed) + localStep - outbound, local(elapsed) + localStep + inbound);
    },
  };
}

function train(estimator, clock, { until = 120000, step = 5000, from = 0 } = {}) {
  let result;
  for (let elapsed = from; elapsed <= until; elapsed += step) result = clock.probe(estimator, elapsed);
  return result;
}

test('single probe compatibility and centered snapshot conversion reject invalid clocks', () => {
  assert.deepEqual(sampleClock(100, 1000, 1020), { offset: 910, rtt: 20, at: 1020 });
  assert.equal(sampleClock(100, 1100, 1099), null);
  assert.equal(sampleClock(NaN, 1000, 1001), null);
  assert.equal(sampleClock(100, 1000, 2001), null);
  assert.equal(mapClockTime(100, { offset: 10 }), 110);
  assert.equal(mapClockTime(100, { version: 2, serverOriginMs: 100, localOriginMs: 200, rate: 1.002 }), 200);
  assert.equal(mapClockTime(100, { version: 2, serverOriginMs: 100, localOriginMs: 200, rate: 0 }), null);
  assert.equal(mapClockTime(100, { offset: NaN }), null);
  assert.equal(presentationTime(1, { offset: 0 }, 1), null);
});

test('offset can be available while short-span probes cannot calibrate rate', () => {
  const estimator = createClockEstimator();
  const clock = simulation();
  const first = clock.probe(estimator, 0);
  assert.equal(first.rate, 1);
  assert.equal(first.rateConfidence, 0);
  assert.ok(first.offsetConfidence > 0.8);
  for (let elapsed = 1000; elapsed <= 59000; elapsed += 1000) {
    const result = clock.probe(estimator, elapsed, { outbound: 2, inbound: elapsed % 3 ? 4 : 2 });
    assert.equal(result.rate, 1, 'network correlation over a short span is not oscillator calibration');
    assert.equal(result.rateConfidence, 0);
  }
  const result = train(estimator, clock, { from: 60000, until: 120000 });
  assert.ok(result.rateConfidence > 0.5);
  assert.ok(Math.abs(result.rate - 1.00018) < 0.00001);
  assert.equal(result.generation, first.generation);
  assert.equal(result.state, 'tracking');
});

test('eight-hour virtual playback estimates both drift signs without epoch-sized regression', () => {
  for (const rate of [0.99983, 1.00024]) {
    const estimator = createClockEstimator();
    const clock = simulation({ rate });
    let maximumError = 0;
    let result;
    for (let tick = 0; tick <= 2880; tick++) {
      const elapsed = tick * 10000;
      // Bursty downstream delay and a small, non-constant low-delay noise floor.
      const jitter = Math.sin(tick * 2.17) * 0.15;
      result = clock.probe(estimator, elapsed, tick % 9 === 4 ?
        { outbound: 2, inbound: 200 + tick % 53 } : { outbound: 2 - jitter, inbound: 2 + jitter });
      if (elapsed >= 300000 && result) {
        maximumError = Math.max(maximumError,
          Math.abs(mapClockTime(clock.server(elapsed + 2000), result) - clock.local(elapsed + 2000)));
      }
    }
    assert.ok(maximumError < 1, `rate ${rate}: largest future-anchor error ${maximumError} ms`);
    assert.ok(Math.abs(result.rate - rate) * 1e6 < 5);
    assert.ok(result.historyCount <= 96, 'memory does not grow with session length');
    assert.ok(result.spanMs <= 600000);
    assert.equal(result.generation, 0, 'normal drift never becomes a stream reset');
  }
});

test('RTT bursts and isolated low-RTT outliers cannot drive rate or reset the timeline', () => {
  const estimator = createClockEstimator();
  const clock = simulation({ rate: 1.00012 });
  const before = train(estimator, clock, { until: 300000 });
  for (let elapsed = 305000, tick = 0; elapsed <= 600000; elapsed += 5000, tick++) {
    const result = clock.probe(estimator, elapsed, tick % 3 === 0 ? { outbound: 2, inbound: 700 } :
      tick % 17 === 1 ? { outbound: 2, inbound: 2, serverStep: 80 } : {});
    if (result) {
      assert.equal(result.generation, before.generation);
      assert.ok(Math.abs(mapClockTime(clock.server(elapsed), result) - clock.local(elapsed)) < 1);
    }
  }
  const after = clock.probe(estimator, 605000);
  assert.ok(Math.abs(after.rate - 1.00012) * 1e6 < 5);
  assert.equal(after.generation, before.generation);
});

test('rate confidence rejects jitter that is large relative to the observation span', () => {
  const estimator = createClockEstimator({ maxRateUncertaintyPpm: 1 });
  const clock = simulation();
  let result;
  for (let tick = 0; tick <= 14; tick++) {
    const noise = Math.sin(tick * 1.2) * 3;
    result = clock.probe(estimator, tick * 5000, { outbound: 4 - noise, inbound: 4 + noise });
  }
  assert.equal(result.rateConfidence, 0);
  assert.equal(result.rate, 1);
  assert.ok(result.rateUncertaintyPpm > 1);
});

test('a same-burst minimum RTT does not overweight a sampling burst', () => {
  const estimator = createClockEstimator();
  const clock = simulation();
  clock.probe(estimator, 100, { outbound: 1, inbound: 101 });
  const best = clock.probe(estimator, 250);
  const worse = clock.probe(estimator, 300, { outbound: 1, inbound: 11 });
  assert.equal(best.historyCount, 1);
  assert.equal(worse.historyCount, 1);
  assert.equal(worse.at, best.at);
  assert.equal(worse.rateConfidence, 0);
  assert.ok(Math.abs(mapClockTime(clock.server(300), worse) - clock.local(300)) < 0.1);
});

test('a forward clock step is quarantined, then resets after distinct coherent probes', () => {
  const estimator = createClockEstimator();
  const clock = simulation();
  const before = train(estimator, clock);
  assert.equal(clock.probe(estimator, 125000, { serverStep: 2000 }), null);
  assert.equal(estimator.snapshot(clock.local(125000) + 2), null);
  assert.equal(clock.probe(estimator, 125100, { serverStep: 2000 }), null);
  assert.equal(clock.probe(estimator, 125200, { serverStep: 2000 }), null, 'one HTTP burst cannot confirm a discontinuity');
  const after = clock.probe(estimator, 130000, { serverStep: 2000 });
  assert.equal(after.generation, before.generation + 1);
  assert.equal(after.resetReason, 'clock-step');
  assert.equal(after.rate, 1, 'old oscillator fit is discarded after a real clock step');
  assert.equal(after.rateConfidence, 0);
  assert.ok(Math.abs(mapClockTime(clock.server(130000) + 2000, after) - clock.local(130000)) < 1);
});

test('an isolated large reply anomaly does not reset established history', () => {
  const estimator = createClockEstimator();
  const clock = simulation();
  const before = train(estimator, clock);
  assert.equal(clock.probe(estimator, 125000, { serverStep: 2000 }), null);
  const after = clock.probe(estimator, 130000);
  assert.equal(after.generation, before.generation);
  assert.ok(after.rateConfidence > 0.5);
});

test('a small persistent calibration change updates phase without masquerading as rate or a seek', () => {
  const estimator = createClockEstimator();
  const clock = simulation();
  const before = train(estimator, clock, { until: 300000 });
  for (let elapsed = 305000; elapsed <= 315000; elapsed += 5000) {
    const result = clock.probe(estimator, elapsed, { localStep: 40 });
    assert.equal(result.generation, before.generation);
    assert.ok(Math.abs(result.rate - before.rate) * 1e6 < 1);
  }
  const after = clock.probe(estimator, 320000, { localStep: 40 });
  assert.ok(Math.abs(mapClockTime(clock.server(320000), after) - clock.local(320000) - 40) < 0.1);
  assert.ok(after.historyCount <= 4, 'a clock phase step must not pollute the next rate fit');
  assert.equal(after.generation, before.generation);
});

test('stale, suspended and restarted clocks reacquire with a fresh generation', () => {
  const estimator = createClockEstimator();
  const clock = simulation();
  const before = train(estimator, clock);
  assert.equal(estimator.snapshot(before.at + 15001), null);
  assert.equal(presentationTime(clock.server(120000), before, before.at + 15001), null);
  assert.ok(Number.isFinite(mapClockTime(clock.server(140000), before)), 'anchored audio may explicitly hold over stale calibration');
  const afterGap = clock.probe(estimator, 140000);
  assert.equal(afterGap.generation, before.generation + 1);
  assert.equal(afterGap.resetReason, 'stale');
  assert.equal(afterGap.rateConfidence, 0);
  estimator.suspend();
  estimator.suspend();
  assert.equal(clock.probe(estimator, 145000), null);
  estimator.resume();
  const afterSuspend = clock.probe(estimator, 150000);
  assert.equal(afterSuspend.generation, afterGap.generation + 1, 'repeated suspend notifications are idempotent');
  assert.equal(afterSuspend.resetReason, 'suspend');
  const restarted = estimator.observe(100, clock.local(155000) - 2, clock.local(155000) + 2);
  assert.equal(restarted.generation, afterSuspend.generation + 1);
  assert.equal(restarted.resetReason, 'server-backward');
  const localRestarted = estimator.observe(5100, clock.local(155000) - 1002, clock.local(155000) - 998);
  assert.equal(localRestarted.generation, restarted.generation + 1);
  assert.equal(localRestarted.resetReason, 'local-backward');
});

test('estimator snapshots survive JSON/worker transfer and preserve live guards', () => {
  const estimator = createClockEstimator();
  const clock = simulation();
  const result = train(estimator, clock);
  const transferred = JSON.parse(JSON.stringify(result));
  assert.deepEqual(transferred, result);
  const now = result.at;
  assert.ok(Math.abs(presentationTime(clock.server(121000), transferred, now) - clock.local(121000)) < 0.1);
  assert.equal(presentationTime(clock.server(140001), transferred, now), null);
  assert.equal(presentationTime(clock.server(120000), transferred, now - 1), null);
  estimator.reset('new-session');
  assert.equal(estimator.snapshot(now), null);
  const reset = clock.probe(estimator, 125000);
  assert.equal(reset.generation, result.generation + 1);
  assert.equal(reset.resetReason, 'new-session');
});

test('a short high-delay outage permits anchored holdover without turning network jitter into a seek', () => {
  const estimator = createClockEstimator();
  const clock = simulation();
  const before = train(estimator, clock);
  for (let elapsed = 125000; elapsed <= 145000; elapsed += 5000) {
    clock.probe(estimator, elapsed, { outbound: 2, inbound: 700 });
  }
  assert.equal(estimator.snapshot(clock.local(145000) + 700), null);
  const after = clock.probe(estimator, 150000);
  assert.equal(after.generation, before.generation);
  assert.ok(after.rateConfidence > 0.5);
  assert.ok(Math.abs(mapClockTime(clock.server(150000), after) - clock.local(150000)) < 0.1);
});
