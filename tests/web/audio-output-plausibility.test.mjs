// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioOutputMapping } from '../../site/play/audio-output-clock.js';

// Exactly representable clock perturbations remain well above the rounding
// introduced by converting a 10-second context cursor to/from seconds.
const EPSILON_MS = 2 ** -20;
function fixture() {
  let at = 10000, renderedMs = 10000, timestamp = null, getter = seconds => seconds;
  const domain = { generation: 0, startFrame: 0 };
  const context = { state: 'running', sampleRate: 48000, get currentTime() { return getter(renderedMs / 1000); },
    baseLatency: .01, outputLatency: .19, getOutputTimestamp: () => timestamp };
  const mapping = createAudioOutputMapping({ now: () => at, timeOrigin: () => 0 });
  const capture = () => {
    const output = mapping.capture(context), token = mapping.takeRenderProbe();
    if (token !== null) mapping.acknowledgeRenderProbe({ token, generation: domain.generation,
      startFrame: domain.startFrame, endFrame: Math.round(renderedMs * 48), renderQuantumFrames: 128 }, context);
    return output;
  };
  // Certify the physical sample frontier before offering a native phase pair.
  capture(); timestamp = { contextTime: 9.8, performanceTime: 10000 };
  return { mapping, context,
    getter(value) { getter = value; },
    elapse(ms) { at += ms; },
    sample(time, rendered, pair, { sampleDomainJump = false } = {}) {
      at = time; renderedMs = rendered; timestamp = pair;
      if (sampleDomainJump) {
        domain.generation++; domain.startFrame = Math.round(rendered * 48) - 128;
        capture();
        // A changed actual domain is learned in the ACK, then governs capture.
        return mapping.capture(context);
      }
      return capture();
    },
    reference(time, rendered, pair) {
      at = time; renderedMs = rendered; timestamp = pair;
      return mapping.reference({ state: 'playing', contextTimeMs: rendered,
        sourceTimeMs: 5000, mediaRate: 1 }, context);
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

test('native context plausibility uses a verified block interval rather than a getter lead allowance', () => {
  for (const leadMs of [0, 2, 10, 1000]) {
    const h = fixture(); delete h.context.baseLatency; delete h.context.outputLatency;
    const output = h.sample(10000, 10000, { contextTime: (10000 + leadMs) / 1000, performanceTime: 10000 });
    if (leadMs <= 2) {
      assert.equal(output?.outputMethod, 'timestamp');
      assert.ok(Math.abs(output.contextTimeMs - 10000 - leadMs) < 1e-9);
    } else {
      assert.equal(output, null);
      assert.equal(h.mapping.deviceClock().points, 1, 'native phase rejection does not discard a valid render observation');
      assert.equal(h.mapping.deviceClock().source, 'holdover');
    }
  }
});

test('stalled, biased, reversed and unavailable public getters cannot change verified native holdover', () => {
  for (const getter of [() => 0, () => NaN, () => Infinity, seconds => seconds + 5000,
    seconds => -seconds, seconds => seconds * .98, () => { throw new Error('Unreliable getter'); }]) {
    const h = fixture(); assert.equal(h.capture()?.outputMethod, 'timestamp');
    const before = h.mapping.deviceClock();
    const nativeGeneration = h.mapping.diagnostics().outputTimestampFitGeneration;
    h.getter(getter);
    const output = h.sample(10100, 10100, null);
    assert.equal(output?.outputMethod, 'timestamp-holdover');
    assert.equal(output.performanceTimeMs, 10000, 'holdover cannot refresh the trusted sample age');
    assert.equal(output.contextTimeMs, 9800); assert.ok(output.uncertaintyMs > 0);
    assert.equal(h.mapping.diagnostics().outputTimestampHoldoverAgeMs, 100);
    assert.equal(h.mapping.deviceClock().generation, before.generation, 'a public getter cannot retire actual sample evidence');
    assert.equal(h.mapping.diagnostics().outputTimestampFitGeneration, nativeGeneration);
    const restored = h.sample(10200, 10200,
      { contextTime: 10, performanceTime: 10200 });
    assert.equal(restored?.outputMethod, 'timestamp', 'a fresh coherent native sample restores measurement after holdover/rejection');
    assert.equal(h.mapping.diagnostics().outputTimestampFitGeneration, nativeGeneration);
  }
});

test('an actual sample-domain discontinuity retires old native phase and reacquires from a new native pair', () => {
  const h = fixture(); delete h.context.baseLatency; delete h.context.outputLatency;
  assert.equal(h.capture()?.outputMethod, 'timestamp');
  const before = h.mapping.deviceClock(), nativeGeneration = h.mapping.diagnostics().outputTimestampFitGeneration;
  assert.equal(h.sample(10100, 10140, null, { sampleDomainJump: true }), null,
    'the old phase cannot be revived across a confirmed frame-domain jump');
  assert.equal(h.mapping.deviceClock().generation, before.generation + 1);
  assert.equal(h.mapping.diagnostics().outputTimestampFitGeneration, nativeGeneration + 1);
  const restored = h.sample(10200, 10240, { contextTime: 10.04, performanceTime: 10200 });
  assert.equal(restored?.outputMethod, 'timestamp'); assert.equal(restored.contextTimeMs, 10040);
  assert.equal(restored.performanceTimeMs, 10200);
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
  assert.equal(h.sample(10000, 10000, { contextTime: 10.002, performanceTime: 10000 })?.outputMethod, 'timestamp');
  const output = h.sample(10040, 10040,
    { contextTime: 10.045, performanceTime: 10040 });
  assert.equal(output?.outputMethod, 'timestamp-holdover');
  assert.equal(output.performanceTimeMs, 10000);
  assert.equal(output.contextTimeMs, 10002);
  assert.equal(h.mapping.deviceClock().points, 1, 'bounded holdover and native acceptance are separate decisions');
  assert.equal(h.sample(10080, 10080, { contextTime: 10.082, performanceTime: 10080 })?.outputMethod, 'timestamp');
});

test('native reacquisition after an outage cannot invalidate the frame proof used by the same reference call', () => {
  const h = fixture(); assert.equal(h.capture()?.outputMethod, 'timestamp');
  for (let at = 10100; at <= 11900; at += 100) h.sample(at, at, null);
  assert.equal(h.sample(12000, 12000, { contextTime: 11.8, performanceTime: 12000 }), null,
    'one new native pair cannot bypass the existing reacquisition barrier');
  assert.doesNotThrow(() => h.reference(12100, 12100, { contextTime: 11.9, performanceTime: 12100 }),
    'native fit gap handling cannot make reference dereference a retired render observation');
  h.sample(12200, 12200, { contextTime: 12, performanceTime: 12200 });
  const recovered = h.reference(12200, 12200, { contextTime: 12, performanceTime: 12200 });
  assert.equal(recovered.state, 'playing');
  assert.equal(recovered.audibleTimeMs, 12400, 'the independent device still has its real 200ms pipeline');
});

test('Standard playback never reads the public getter and Debug getter delays consume proof freshness', () => {
  const standard = fixture(); let reads = 0;
  standard.getter(() => { reads++; throw new Error('Public getter unavailable'); });
  assert.equal(standard.sample(10100, 10100, { contextTime: 9.9, performanceTime: 10100 })?.outputMethod, 'timestamp');
  assert.equal(reads, 0, 'a diagnostic-only getter cannot influence Standard capture latency');

  const debug = fixture(); assert.equal(debug.capture()?.outputMethod, 'timestamp'); debug.mapping.debug(true);
  debug.getter(seconds => { debug.elapse(1000); return seconds; });
  const delayed = debug.reference(10100, 10100, { contextTime: 9.9, performanceTime: 10100 });
  assert.equal(delayed.state, 'output-unavailable', 'a blocked diagnostic getter cannot return expired native phase');
  assert.equal(delayed.audibleTimeMs, null);
  assert.equal(debug.mapping.diagnostics().outputTimestampAgeMs, 1000);
  assert.equal(debug.mapping.renderObservation(debug.context), null, 'receipt time cannot refresh a stale proof');
});

test('native rate-fit freshness belongs to the paired output event rather than its later receipt', () => {
  const h = fixture(); assert.equal(h.capture()?.outputMethod, 'timestamp');
  for (let at = 10100; at <= 30000; at += 100)
    h.sample(at, at, { contextTime: (at - 700) / 1000, performanceTime: at - 500 });
  assert.equal(h.mapping.deviceClock().source, 'native', 'fresh delayed samples can establish a real device-rate fit');
  const expired = h.reference(30300, 30300, { contextTime: 29.3, performanceTime: 29500 });
  assert.equal(expired.state, 'output-unavailable');
  assert.notEqual(h.mapping.deviceClock().source, 'native',
    'an 800ms-old native event cannot steer from a receipt-promoted 300ms-old fit');
});
