// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSourceClock } from '../../site/play/audio-source-clock.js';

test('the source oscillator includes exact ±1000ppm endpoints while rejecting genuinely wider drift', () => {
  for (const arrival of [false, true]) for (const browserRate of arrival ? [1, 1.00012, 1.002] : [1])
    for (const rate of [.999, 1.001, .998999999, 1.001000001]) {
    const clock = new AudioSourceClock(48000, { arrival });
    for (let ms = 0; ms <= 120000; ms += 1000)
      clock.observe(ms * 48, 1000000 + ms * (browserRate / rate), browserRate);
    if (rate === .999 || rate === 1.001) {
      assert.ok(Math.abs(clock.targetRate - rate) < 1e-12, `${rate}: exact source oscillator endpoint must be accepted`);
      assert.equal(clock.confidence, arrival ? .5 : 1);
    } else {
      assert.equal(clock.targetRate, 1, `${rate}: a genuinely out-of-range source oscillator remains unaccepted`);
      assert.equal(clock.confidence, 0);
    }
  }
});

test('opt-in source clock evidence separates missing samples, fit maturity and an expired history without inventing wall time', () => {
  const clock = new AudioSourceClock(48000);
  assert.equal(clock.snapshot(0), null);
  clock.debug(true);
  assert.deepEqual(clock.snapshot(0), { status: 'acquiring', reason: 'no-samples', points: 0, spanMs: 0, rejected: 0 });
  for (let ms = 0; ms <= 38000; ms += 2000) clock.observe(ms * 48, 1000000 + ms, 1, 5000 + ms);
  assert.equal(clock.snapshot(43000).reason, 'insufficient-points');
  assert.equal(clock.snapshot(43000).points, 20); assert.equal(clock.snapshot(43000).spanMs, 38000);
  assert.equal(clock.confidence, 0);
  for (let ms = 40000; ms <= 48000; ms += 2000) clock.observe(ms * 48, 1000000 + ms, 1, 5000 + ms);
  const fitted = clock.snapshot(56000);
  assert.deepEqual(fitted, { status: 'tracking', reason: 'none', points: 25, spanMs: 48000,
    rejected: 0, dispersionMs: 0, acceptedFitAgeMs: 3000 });
  assert.equal(Object.hasOwn(clock.snapshot(), 'acceptedFitAgeMs'), false, 'a source/server coordinate is never substituted for render context time');
  assert.equal(Object.hasOwn(clock.snapshot(52999), 'acceptedFitAgeMs'), false, 'future fit evidence remains unknown');
  clock.observe(200000 * 48, 1200000, 1, 205000);
  assert.deepEqual(clock.snapshot(205000), { status: 'holdover', reason: 'insufficient-span', points: 1,
    spanMs: 0, rejected: 0, acceptedFitAgeMs: 152000 });
  clock.debug(false); assert.equal(clock.snapshot(300000), null); assert.equal(clock.diagnostics, null);
  clock.debug(true);
  assert.equal(clock.snapshot(300000).reason, 'not-observed');
  assert.equal(Object.hasOwn(clock.snapshot(300000), 'acceptedFitAgeMs'), false, 'reopening Debug does not invent a previous capture age');
});

test('source clock rejection evidence identifies drift versus noise and diagnostic reads leave the oscillator unchanged', () => {
  for (const arrival of [false, true]) for (const input of ['stable', 'drift', 'noise']) {
    const control = new AudioSourceClock(48000, { arrival }), observed = new AudioSourceClock(48000, { arrival });
    observed.debug(true);
    for (let ms = 0; ms <= 120000; ms += 1000) {
      const rate = input === 'drift' ? 1.002 : 1;
      const jitter = input === 'noise' ? Math.sin(ms / 1000 * 1.618) * 10 : 0;
      const at = 2000 + ms;
      for (const clock of [control, observed]) {
        clock.observe(ms * 48, 1000000 + ms / rate + jitter, 1, at);
        clock.advance(at);
      }
      const before = { rate: observed.rate, target: observed.targetRate, confidence: observed.confidence,
        points: structuredClone(observed.points), lastUpdate: observed.lastUpdate, lastFit: observed.lastFit };
      observed.snapshot(at); observed.snapshot(at + 1000);
      assert.deepEqual({ rate: observed.rate, target: observed.targetRate, confidence: observed.confidence,
        points: observed.points, lastUpdate: observed.lastUpdate, lastFit: observed.lastFit }, before);
      assert.equal(observed.rate, control.rate); assert.equal(observed.targetRate, control.targetRate);
      assert.equal(observed.confidence, control.confidence);
    }
    const snapshot = observed.snapshot(122000);
    assert.equal(snapshot.reason, input === 'stable' ? 'none' : input === 'drift' ? 'out-of-range' : 'noisy');
    assert.ok(Number.isFinite(snapshot.dispersionMs));
    assert.equal(snapshot.rejected > 0, input !== 'stable');
  }
});

for (const arrival of [false, true]) test(`source ${arrival ? 'arrival' : 'mapped'} MAD gate accepts equality and holds its previous fit immediately above ${arrival ? 1.5 : .5} ms`, () => {
  const limit = arrival ? 1.5 : .5, epsilon = 2 ** -20;
  for (const delta of [-epsilon, 0, epsilon]) {
    const clock = new AudioSourceClock(1000, { arrival }); clock.debug(true);
    // Isolate the fit gate with an already accepted nonnominal oscillator and
    // a controlled, mature history; admission/bucket rules are exercised below.
    clock.points = Array.from({ length: 31 }, (_, i) => ({ frameMs: i * 1000,
      timeMs: 1000 + i * 1000 * .9995, browserRate: 1 }));
    clock.fit(1000); clock.advance(1000); clock.advance(2000);
    const previous = { targetRate: clock.targetRate, rate: clock.rate };
    assert.ok(previous.targetRate > 1.0005); assert.ok(previous.rate > 1);
    const dispersion = limit + delta;
    // Balanced four-point noise leaves the robust slope at one and has an
    // exactly representable MAD. It cannot accidentally hit the rate gate.
    clock.points = Array.from({ length: 31 }, (_, i) => ({ frameMs: i * 1000,
      timeMs: 1000 + i * 1000 + [-1, 0, 1, 0][i % 4] * dispersion, browserRate: 1 }));
    clock.fit(3000);
    const evidence = clock.snapshot(4000);
    assert.equal(evidence.dispersionMs, dispersion);
    assert.equal(evidence.reason, delta > 0 ? 'noisy' : 'none');
    assert.equal(evidence.status, delta > 0 ? 'holdover' : 'tracking');
    assert.equal(evidence.rejected, delta > 0 ? 1 : 0);
    assert.equal(evidence.acceptedFitAgeMs, delta > 0 ? 3000 : 1000);
    assert.equal(clock.confidence, delta > 0 ? 0 : arrival ? .5 : 1);
    assert.equal(clock.targetRate, delta > 0 ? previous.targetRate : 1);
    assert.equal(clock.rate, previous.rate, 'a fit decision cannot step the running sample rate');
    const later = clock.snapshot(6000);
    assert.deepEqual({ ...later, acceptedFitAgeMs: evidence.acceptedFitAgeMs }, evidence);
    assert.equal(later.acceptedFitAgeMs, evidence.acceptedFitAgeMs + 2000,
      'reads and rejected fits cannot refresh the last accepted context coordinate');
  }
});

test('source-second admission splits at the source bucket edge rather than elapsed arrival time', () => {
  const epsilon = 2 ** -10;
  for (const frameMs of [1000 - epsilon, 1000, 1000 + epsilon]) {
    const clock = new AudioSourceClock(1000); clock.debug(true);
    clock.observe(0, 1000);
    clock.observe(frameMs, 1000 + frameMs);
    assert.equal(clock.points.length, frameMs < 1000 ? 1 : 2);
    assert.equal(clock.snapshot().spanMs, frameMs < 1000 ? 0 : frameMs);
  }
  const clock = new AudioSourceClock(1000);
  clock.observe(1000 - epsilon, 2000 - epsilon);
  clock.observe(1000, 2000);
  assert.equal(clock.points.length, 2, 'crossing the bucket admits a new point even less than a millisecond after its predecessor');
});

test('one source bucket preserves its fastest queue offset and an equal-speed arrival cannot replace it', () => {
  for (const browserRate of [1, 1 + 1 / 1024]) {
    const clock = new AudioSourceClock(1000, { arrival: browserRate !== 1 });
    const observe = (frameMs, queueOffset) => clock.observe(frameMs, frameMs * browserRate + queueOffset, browserRate);
    observe(0, 1000); const first = clock.points[0];
    observe(250, 1000);
    assert.equal(clock.points[0], first, 'an equal queue offset keeps the original representative');
    observe(500, 900); const fastest = clock.points[0];
    assert.equal(fastest.frameMs, 500);
    observe(750, 1050); observe(999.5, 900);
    assert.equal(clock.points[0], fastest, 'later queued or equal-speed points cannot overwrite the minimum offset');
    observe(1000, 900);
    assert.equal(clock.points.length, 2); assert.equal(clock.points[1].frameMs, 1000);
    assert.equal(clock.points[0], fastest, 'starting the next bucket leaves the completed bucket unchanged');
  }
});

test('source fit includes pairs exactly ten seconds apart and excludes the side just below it', () => {
  const epsilon = 2 ** -10;
  for (const delta of [-epsilon, 0, epsilon]) {
    const clock = new AudioSourceClock(1000); clock.debug(true);
    // Moving point 10 brackets the 0→10 and 10→20 pairs around ten seconds.
    // Both enter at equality; otherwise only one enters. This small periodic
    // timing error makes their effect observable in the fitted median rate.
    for (let i = 0; i < 31; i++) {
      const frameMs = 500 + i * 1000 + (i === 10 ? delta : 0);
      clock.observe(frameMs, frameMs + (i % 7) * .01, 1, frameMs + 5000);
    }
    assert.equal(clock.points.length, 31); assert.equal(clock.snapshot(35500).spanMs, 30000);
    assert.equal(clock.snapshot(35500).reason, 'none');
    const expectedRate = delta === 0 ? 1 / (1 + .01 / 22000) : 1;
    assert.ok(Math.abs(clock.targetRate - expectedRate) < 1e-12, `${delta}: ten-second pair eligibility changes the robust result`);
    assert.equal(clock.snapshot(35500).acceptedFitAgeMs, 0);
  }
});
