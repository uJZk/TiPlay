// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioOutputMapping } from '../../site/play/audio-output-clock.js';

// Exactly representable clock perturbations remain well above the rounding
// introduced by converting a 10-second context cursor to/from seconds.
const EPSILON_MS = 2 ** -20;
function fixture() {
  let at = 9900, timestamp = null;
  const domain = { generation: 0, startFrame: 9900 * 48 };
  const context = { state: 'running', sampleRate: 48000, currentTime: 9.9,
    baseLatency: .01, outputLatency: .19, getOutputTimestamp: () => timestamp };
  const mapping = createAudioOutputMapping({ now: () => at, timeOrigin: () => 0 });
  const capture = () => {
    const output = mapping.capture(context), token = mapping.takeRenderProbe();
    if (token !== null) mapping.acknowledgeRenderProbe({ token, generation: domain.generation,
      startFrame: domain.startFrame, endFrame: Math.ceil(context.currentTime * context.sampleRate) + 128 }, context);
    return output;
  };
  // Learn the frame domain without accepting an earlier native phase anchor.
  capture(); at = 10000; context.currentTime = 10; timestamp = { contextTime: 9.8, performanceTime: 10000 };
  return { mapping, context,
    sample(time, rendered, pair, { sampleDomainJump = false } = {}) {
      at = time; context.currentTime = rendered / 1000; timestamp = pair;
      if (sampleDomainJump) { domain.generation++; domain.startFrame = Math.floor(rendered * 48); }
      return capture();
    },
    capture,
  };
}

test('native performance timestamps accept exactly 20ms of future lead and reject the next representable test step', () => {
  for (const leadMs of [20 - EPSILON_MS, 20, 20 + EPSILON_MS]) {
    const h = fixture();
    // Omit estimates so a failed native measurement cannot be mistaken for an
    // independently valid baseLatency/outputLatency fallback.
    delete h.context.baseLatency; delete h.context.outputLatency;
    const output = h.sample(10000, 10000, { contextTime: 9.8, performanceTime: 10000 + leadMs });
    assert.ok(Math.abs(h.mapping.diagnostics().outputTimestampAgeMs + leadMs) < 1e-9);
    if (leadMs <= 20) {
      assert.equal(output?.outputMethod, 'timestamp');
      assert.equal(output.performanceTimeMs, 10000 + leadMs);
      assert.equal(h.mapping.deviceClock().points, 1);
    } else {
      assert.equal(output, null);
      assert.equal(h.mapping.deviceClock().points, 1, 'a separately valid render cursor remains observable');
      assert.equal(h.mapping.deviceClock().source, 'holdover', 'the rejected native pair cannot establish a selected rate');
    }
  }
});

test('native context timestamps accept exactly 10ms ahead of the rendered cursor', () => {
  for (const leadMs of [10 - EPSILON_MS, 10, 10 + EPSILON_MS]) {
    const h = fixture(); delete h.context.baseLatency; delete h.context.outputLatency;
    const output = h.sample(10000, 10000, { contextTime: (10000 + leadMs) / 1000, performanceTime: 10000 });
    if (leadMs <= 10) {
      assert.equal(output?.outputMethod, 'timestamp');
      assert.ok(Math.abs(output.contextTimeMs - 10000 - leadMs) < 1e-9);
    } else {
      assert.equal(output, null);
      assert.equal(h.mapping.deviceClock().points, 1, 'native phase rejection does not discard a valid render observation');
      assert.equal(h.mapping.deviceClock().source, 'holdover');
    }
  }
});

test('render holdover accepts exactly ±40ms of continuity disagreement without accepting a missing native pair', () => {
  for (const direction of [-1, 1]) for (const magnitudeMs of [40 - EPSILON_MS, 40, 40 + EPSILON_MS]) {
    const h = fixture(); assert.equal(h.capture()?.outputMethod, 'timestamp');
    const before = h.mapping.deviceClock();
    const nativeGeneration = h.mapping.diagnostics().outputTimestampFitGeneration;
    // 100ms of wall time keeps the render cursor monotonic on both sides.
    const output = h.sample(10100, 10100 + direction * magnitudeMs, null, { sampleDomainJump: true });
    if (magnitudeMs <= 40) {
      assert.equal(output?.outputMethod, 'timestamp-holdover');
      assert.equal(output.performanceTimeMs, 10000, 'holdover cannot refresh the trusted sample age');
      assert.equal(output.contextTimeMs, 9800);
      assert.ok(output.uncertaintyMs > 0);
      assert.equal(h.mapping.diagnostics().outputTimestampHoldoverAgeMs, 100);
    } else assert.equal(output, null, 'render continuity outside the bound cannot justify an old output mapping');
    assert.equal(h.mapping.deviceClock().generation, before.generation + 1, 'an out-of-rate render-coordinate step retires its own rate evidence');
    assert.equal(h.mapping.deviceClock().points, 0, 'the cross-domain candidate cannot train the new rate fit');
    assert.equal(h.mapping.diagnostics().outputTimestampFitGeneration, nativeGeneration, 'render continuity cannot replace the native anchor or its fit');
    const restored = h.sample(10200, 10200 + direction * magnitudeMs,
      { contextTime: 10, performanceTime: 10200 });
    assert.equal(restored?.outputMethod, 'timestamp', 'a fresh coherent native sample restores measurement after holdover/rejection');
    assert.equal(h.mapping.deviceClock().points, 1, 'a later same-domain worklet proof admits the new render point');
    assert.equal(h.mapping.diagnostics().outputTimestampFitGeneration, nativeGeneration);
  }
});

test('rejecting a future or render-leading pair does not poison the next physically coherent timestamp', () => {
  for (const pair of [
    { contextTime: 9.84, performanceTime: 10060 + EPSILON_MS },
    { contextTime: (10050 + EPSILON_MS) / 1000, performanceTime: 10040 },
  ]) {
    const h = fixture(); assert.equal(h.capture()?.outputMethod, 'timestamp');
    const before = h.mapping.deviceClock();
    assert.equal(h.sample(10040, 10040, pair), null);
    assert.equal(h.mapping.deviceClock().points, before.points);
    const restored = h.sample(10080, 10080, { contextTime: 9.88, performanceTime: 10080 });
    assert.equal(restored?.outputMethod, 'timestamp');
    assert.equal(restored.performanceTimeMs, 10080);
    assert.equal(restored.contextTimeMs, 9880);
    assert.equal(h.mapping.deviceClock().generation, before.generation);
  }
});

test('a render-leading native outlier may hold a coherent old anchor but never install the outlier', () => {
  const h = fixture();
  assert.equal(h.sample(10000, 10000, { contextTime: 10.01, performanceTime: 10000 })?.outputMethod, 'timestamp');
  const output = h.sample(10040, 10040,
    { contextTime: (10050 + EPSILON_MS) / 1000, performanceTime: 10040 });
  assert.equal(output?.outputMethod, 'timestamp-holdover');
  assert.equal(output.performanceTimeMs, 10000);
  assert.equal(output.contextTimeMs, 10010);
  assert.equal(h.mapping.deviceClock().points, 1, 'bounded holdover and native acceptance are separate decisions');
  assert.equal(h.sample(10080, 10080, { contextTime: 10.09, performanceTime: 10080 })?.outputMethod, 'timestamp');
});
