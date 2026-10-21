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
