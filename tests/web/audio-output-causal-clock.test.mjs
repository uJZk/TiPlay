// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioOutputMapping } from '../../site/play/audio-output-clock.js';

function harness({ getter = ms => ms / 1000, native = true, rate = 1 } = {}) {
  const origin = 1000000;
  let at = 10000, domain = 0, runStart = 0;
  const mapping = createAudioOutputMapping({ now: () => origin + at, timeOrigin: () => origin });
  const context = { state: 'running', sampleRate: 48000, baseLatency: .01, outputLatency: .07,
    get currentTime() { return getter(at); },
    getOutputTimestamp: native ? () => ({ contextTime: (at - 80) * rate / 1000, performanceTime: at }) : undefined };
  const request = ms => { at = ms; mapping.capture(context); return mapping.takeRenderProbe(); };
  const acknowledge = (token, receivedAt, processedAt = receivedAt, quantum = 128) => {
    at = receivedAt;
    mapping.acknowledgeRenderProbe({ token, generation: domain, startFrame: runStart,
      endFrame: Math.round(processedAt * rate * 48), renderQuantumFrames: quantum }, context);
  };
  const sample = ms => {
    const token = request(ms);
    if (token !== null) acknowledge(token, ms);
    return mapping.capture(context);
  };
  return { mapping, context, request, acknowledge, sample, now: () => at,
    at(ms) { at = ms; }, changeDomain(ms) { domain++; runStart = Math.round(ms * rate * 48); } };
}

test('native output phase, rate and reference age ignore frozen, biased, backward and throwing currentTime getters', () => {
  const getters = [ms => ms / 1000, () => 0, () => NaN, () => { throw new Error('Unreliable getter'); },
    ms => ms * .98 / 1000, ms => ms * 1.02 / 1000, ms => (ms + (Math.floor(ms / 500) % 2 ? 5000 : -5000)) / 1000];
  let expected;
  for (const getter of getters) {
    const h = harness({ getter });
    h.mapping.debug(true);
    for (let ms = 10000; ms <= 20000; ms += 100)
      assert.ok(['timestamp', 'timestamp-holdover'].includes(h.sample(ms)?.outputMethod));
    const reference = h.mapping.reference({ state: 'playing', contextTimeMs: 20000,
      sourceTimeMs: 800000, mediaRate: 1, filterUncertaintyMs: 1 }, h.context);
    const actual = { audibleTimeMs: reference.audibleTimeMs, at: reference.at,
      rate: h.mapping.deviceClock().rate, generation: h.mapping.deviceClock().generation };
    assert.ok(Math.abs(actual.audibleTimeMs - 1020080) < 1e-6);
    assert.equal(reference.at, 1020000, 'fresh frame feedback cannot become stale because of a public getter');
    if (expected) assert.deepEqual(actual, expected); else expected = actual;
  }
});

test('Standard capture never reads the public currentTime getter', () => {
  let calls = 0;
  const h = harness({ getter: () => { calls++; throw new Error('Public getter must stay outside control'); } });
  for (let ms = 10000; ms <= 12000; ms += 100) assert.ok(h.sample(ms));
  assert.equal(calls, 0);
});

test('a biased getter cannot train a false render rate when actual Worklet frontiers remain nominal', () => {
  const h = harness({ native: false, getter: ms => ms * .99 / 1000 });
  for (let ms = 10000; ms <= 35000; ms += 100) h.sample(ms);
  const rate = h.mapping.deviceClock();
  assert.equal(rate.rate, 1); assert.equal(rate.targetRatePpm, 0);
  assert.equal(rate.fitStatus, 'tracking');
});

test('growing 100–500ms ACK asymmetry cannot steer a nominal clock from its feasible rate interval', () => {
  for (const requestDelay of [false, true]) {
    const h = harness({ native: false });
    for (let index = 0; index < 120; index++) {
      const sent = 10000 + index * 700, delay = 100 + index / 119 * 400;
      const token = h.request(sent);
      assert.notEqual(token, null);
      h.acknowledge(token, sent + delay, requestDelay ? sent + delay : sent);
      h.mapping.capture(h.context);
      assert.equal(h.mapping.deviceClock().rate, 1);
      assert.equal(h.mapping.deviceClock().targetRatePpm, 0);
    }
  }
});

test('missing native timestamps use a verified frame interval and preserve fallback phase through wide then narrow ACKs', () => {
  const h = harness({ native: false, getter: () => { throw new Error('Getter cannot supply the anchor'); } });
  const first = h.request(10000);
  assert.equal(h.mapping.capture(h.context), null, 'no raw-getter mapping before a real process acknowledgement');
  h.acknowledge(first, 10400, 10000);
  const wide = h.mapping.capture(h.context);
  assert.equal(wide.outputMethod, 'latency-estimate'); assert.ok(wide.uncertaintyMs >= 200);
  const next = h.request(10500); h.acknowledge(next, 10502, 10501);
  const narrow = h.mapping.capture(h.context);
  const projected = wide.performanceTimeMs + (narrow.contextTimeMs - wide.contextTimeMs) / wide.deviceRate;
  assert.ok(Math.abs(narrow.performanceTimeMs - projected) < 1e-8, 'an ACK midpoint shift cannot jump the chosen audio phase');
  assert.ok(narrow.uncertaintyMs >= 200, 'old phase uncertainty cannot disappear merely because a later RTT is short');
});

test('native future context values are bounded by actual Worklet progress and expired ACKs cannot revive mappings', () => {
  const h = harness({ getter: () => 5000 });
  h.sample(10000);
  h.context.getOutputTimestamp = () => ({ contextTime: 100000, performanceTime: h.now() });
  h.at(10040); assert.equal(h.mapping.capture(h.context), null);
  const token = h.request(10100);
  h.acknowledge(token, 10900, 10100);
  assert.equal(h.mapping.renderObservation(h.context), null);
  assert.equal(h.mapping.capture(h.context), null);
});

test('actual frame-rate drift still produces a bounded correction without pretending the interval midpoint is exact', () => {
  for (const rate of [.99, 1.01]) {
    const h = harness({ native: false, rate, getter: () => NaN });
    for (let ms = 10000; ms <= 45000; ms += 100) h.sample(ms);
    const actual = h.mapping.deviceClock();
    assert.ok(Math.abs(actual.rate - rate) < .00025, `${rate}: ${actual.rate}`);
    assert.ok(rate < 1 ? actual.rate >= rate : actual.rate <= rate, 'correction stops at the nearest causally proved boundary');
  }
});

test('a delayed ACK cannot refresh the request boundary or keep an old frontier alive', () => {
  const h = harness({ native: false });
  const token = h.request(10000);
  h.acknowledge(token, 10700, 10000);
  assert.equal(h.mapping.renderObservation(h.context).ageMs, 700);
  h.at(11200);
  assert.equal(h.mapping.renderObservation(h.context), null, 'the event may be1200ms old despite a500ms receipt age');
  assert.equal(h.mapping.capture(h.context), null);
});

test('an obsolete staged token cannot be sent late or retain evidence across a capture gap', () => {
  const h = harness({ native: false });
  h.sample(10000);
  h.at(10100); h.mapping.capture(h.context);
  h.at(10900);
  assert.equal(h.mapping.takeRenderProbe(), null, 'an unsent token expires without becoming a new request');
  h.at(11200);
  assert.equal(h.mapping.capture(h.context), null, 'a capture gap cannot reuse a locally retained pre-retirement frontier');
});
