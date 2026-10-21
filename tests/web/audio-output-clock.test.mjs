// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { audibleTime, createAudioOutputMapping, createAudioReferenceTimeline, OUTPUT_REFERENCE_MAX_AGE_MS } from '../../site/play/audio-output-clock.js';

const feedback = (extra = {}) => ({ mode: 'carplay', type: 0, epoch: 1, generation: 1, sequence: 1,
  state: 'playing', sourceTimeMs: 400000, contextTimeMs: 10000, mediaRate: 1, filterDelayMs: 17, ...extra });

function nativeOutput({ rate = 1 } = {}) {
  const origin = 1000000;
  let elapsed = 10000, timestamp;
  const mapping = createAudioOutputMapping({ now: () => origin + elapsed, timeOrigin: () => origin });
  const context = { state: 'running', currentTime: 10 * rate, sampleRate: 48000,
    baseLatency: .012, outputLatency: .188, getOutputTimestamp: () => timestamp };
  const sample = (at, { latencyMs = 200, contextOffsetMs = 0, pair } = {}) => {
    elapsed = at; context.currentTime = at * rate / 1000;
    timestamp = pair ?? { contextTime: ((at - latencyMs) * rate + contextOffsetMs) / 1000, performanceTime: at };
    return mapping.capture(context);
  };
  return { mapping, context, sample, pair: () => timestamp };
}

test('an isolated ordered native pair cannot jump the mapping or train the device fit', () => {
  for (const contextOffsetMs of [-38, 38]) {
    const h = nativeOutput();
    h.sample(10000);
    const fit = h.mapping.deviceClock();
    assert.equal(h.sample(10040, { contextOffsetMs }), null, 'both coordinates advance, but their relation contradicts the output line');
    assert.equal(h.mapping.diagnostics().outputUnavailableReason, 'timestamp-discontinuity');
    assert.equal(h.mapping.deviceClock().points, fit.points, 'a suspect pair cannot enter the oscillator history');
    assert.equal(h.mapping.deviceClock().generation, fit.generation);
    const pending = h.mapping.diagnostics();
    for (let i = 0; i < 20; i++) { h.mapping.diagnostics(); h.mapping.deviceClock(); }
    assert.deepEqual(h.mapping.diagnostics(), pending, 'metadata reads cannot confirm or refresh pending measurements');
    assert.equal(h.sample(10080), null, 'one normal point cannot confirm an incompatible pending point');
    assert.equal(h.mapping.deviceClock().points, fit.points);
    const restored = h.sample(10120);
    assert.equal(restored.outputMethod, 'timestamp');
    assert.ok(Math.abs(restored.outputLatencyMs - 200) < 1e-8);
    assert.equal(restored.uncertaintyMs, 0, 'recovery does not enlarge uncertainty to hide an offset');
    assert.equal(h.mapping.deviceClock().generation, fit.generation, 'return to the trusted line does not reset its fit');
  }
});

test('two coherent new native pairs establish real pipeline changes in either direction', () => {
  for (const latencyMs of [162, 238, 460]) {
    const h = nativeOutput();
    h.sample(10000);
    const generation = h.mapping.deviceClock().generation;
    assert.equal(h.sample(10040, { latencyMs }), null);
    const changed = h.sample(10080, { latencyMs });
    assert.equal(changed.outputMethod, 'timestamp');
    assert.ok(Math.abs(changed.outputLatencyMs - latencyMs) < 1e-8);
    assert.equal(changed.uncertaintyMs, 0);
    assert.equal(h.mapping.deviceClock().generation, generation + 1);
    assert.equal(h.mapping.deviceClock().reason, 'output-step');
    assert.equal(h.mapping.deviceClock().points, 1, 'the changed phase cannot mix with old oscillator observations');
  }
});

test('old or repeated pending pairs cannot confirm a changed pipeline or replace its first new point', () => {
  const h = nativeOutput();
  h.sample(10000); const old = h.pair();
  assert.equal(h.sample(10040, { latencyMs: 460 }), null); const firstNew = h.pair();
  assert.equal(h.sample(10050, { pair: old }), null);
  assert.equal(h.sample(10060, { pair: firstNew }), null);
  const changed = h.sample(10080, { latencyMs: 460 });
  assert.equal(changed.outputMethod, 'timestamp', 'the second advancing point confirms a route still below the old output counter');
  assert.ok(Math.abs(changed.outputLatencyMs - 460) < 1e-8);
});

test('reordered historical pairs cannot erase a newer pipeline contradiction', () => {
  const h = nativeOutput();
  h.sample(10000);
  const generation = h.mapping.deviceClock().generation;
  assert.equal(h.sample(10080, { latencyMs: 460 }), null);
  for (const performanceTime of [10040, 10060]) {
    const pair = { contextTime: (performanceTime - 200) / 1000, performanceTime };
    assert.equal(h.sample(10090, { pair }), null, 'two different old snapshots cannot revive the contradicted old line');
    assert.equal(h.mapping.deviceClock().generation, generation);
    assert.equal(h.mapping.deviceClock().points, 1);
  }
  const changed = h.sample(10120, { latencyMs: 460 });
  assert.equal(changed.outputMethod, 'timestamp', 'the genuine second new point still confirms the retained first new point');
  assert.ok(Math.abs(changed.outputLatencyMs - 460) < 1e-8);
  assert.equal(h.mapping.deviceClock().generation, generation + 1);
});

test('two coherent historical pairs before the trusted point cannot establish a new route', () => {
  const h = nativeOutput();
  h.sample(10000);
  const generation = h.mapping.deviceClock().generation;
  assert.equal(h.sample(10040, { pair: { contextTime: 9.700, performanceTime: 9980 } }), null);
  assert.equal(h.sample(10080, { pair: { contextTime: 9.710, performanceTime: 9990 } }), null);
  assert.equal(h.mapping.deviceClock().generation, generation);
  assert.equal(h.mapping.deviceClock().points, 1);
  assert.equal(h.sample(10120).outputMethod, 'timestamp', 'historical contradictions cannot retire a still coherent trusted line');
});

test('two fresh physical pairs reacquire an oscillator switch between opposite permitted rates', () => {
  for (const interval of [200, 500]) for (const [firstRate, nextRate] of [[.98, 1.02], [1.02, .98]]) {
    const origin = 1000000;
    let at = 0, timestamp;
    const mapping = createAudioOutputMapping({ now: () => origin + at, timeOrigin: () => origin });
    const context = { state: 'running', currentTime: 0, sampleRate: 48000,
      getOutputTimestamp: () => timestamp };
    const counter = time => time <= 60000 ? time * firstRate : 60000 * firstRate + (time - 60000) * nextRate;
    const sample = time => {
      at = time;
      context.currentTime = counter(at) / 1000;
      timestamp = { contextTime: counter(at - 200) / 1000, performanceTime: at };
      return mapping.capture(context);
    };
    for (let time = 1000; time <= 60000; time += 200) sample(time);
    const fitted = mapping.deviceClock();
    assert.ok(Math.abs(fitted.rate - firstRate) < 1e-8);
    assert.equal(sample(60000 + interval)?.outputMethod, 'timestamp', 'the native output counter follows the continuous device clock through the existing 200ms pipeline');
    assert.equal(sample(60000 + 2 * interval), null);
    const next = sample(60000 + 3 * interval);
    assert.equal(next?.outputMethod, 'timestamp', 'two physical advancing pairs must not stay pending because the old rate is obsolete');
    assert.equal(next.uncertaintyMs, 0);
    assert.equal(mapping.deviceClock().generation, fitted.generation + 1);
    assert.equal(mapping.deviceClock().reason, 'output-step');
    for (let time = 60000 + 4 * interval; time <= 60000 + 14 * interval; time += interval)
      assert.equal(sample(time)?.outputMethod, 'timestamp');
  }
});

test('incoherent forward candidates stay unknown and cannot revive an expired trusted output line', () => {
  const h = nativeOutput();
  h.sample(10000);
  for (let at = 10040, offset = -38; at <= 10880; at += 40, offset = -offset)
    assert.equal(h.sample(at, { contextOffsetMs: offset }), null);
  assert.equal(h.sample(10920), null);
  const restored = h.sample(10960);
  assert.equal(restored.outputMethod, 'timestamp');
  assert.ok(Math.abs(restored.outputLatencyMs - 200) < 1e-8);
});

test('reference expiry and oscillator-fit expiry remain different boundaries', () => {
  const h = nativeOutput({ rate: .988 });
  for (let at = 1000; at <= 30000; at += 100) h.sample(at);
  const fitted = h.mapping.deviceClock();
  assert.ok(Math.abs(fitted.rate - .988) < 1e-8);
  assert.equal(h.sample(30800), null, 'an expired reference cannot be restored by one new sample');
  assert.equal(h.sample(30840).outputMethod, 'timestamp');
  assert.equal(h.mapping.deviceClock().generation, fitted.generation, '750ms reference expiry cannot force the oscillator to nominal');
  assert.ok(Math.abs(h.mapping.deviceClock().rate - .988) < 1e-8);
  assert.equal(h.sample(32000), null);
  assert.equal(h.sample(32040).outputMethod, 'timestamp');
  assert.equal(h.mapping.deviceClock().reason, 'gap', 'a real >1000ms observation gap follows the existing fit reset');
  assert.equal(h.mapping.deviceClock().generation, fitted.generation + 1);
});

test('suspend and replacement contexts retire pending native measurements', () => {
  const h = nativeOutput();
  h.sample(10000); assert.equal(h.sample(10040, { contextOffsetMs: -38 }), null);
  h.context.state = 'suspended'; assert.equal(h.mapping.capture(h.context), null);
  h.context.state = 'running'; assert.equal(h.sample(10080).outputMethod, 'timestamp');
  assert.equal(h.sample(10120, { contextOffsetMs: -38 }), null);
  const replacement = { ...h.context };
  assert.equal(h.mapping.capture(replacement).outputMethod, 'timestamp', 'a different context does not inherit the old pending measurement');
  assert.equal(h.mapping.deviceClock().reason, 'context');
});

test('mapping acquires bounded oscillator drift through native quantum rounding and timestamp jitter', () => {
  for (const rate of [.988, .996, 1, 1.004, 1.019]) {
    const h = nativeOutput({ rate }), quantum = 128 / 48;
    let accepted = 0, unavailable = 0;
    for (let at = 1000; at <= 45000; at += 40) {
      const performanceTime = Math.round(at + .7 * Math.sin(at * .37));
      const contextTime = Math.floor((at - 200) * rate / quantum) * quantum / 1000;
      if (h.sample(at, { pair: { contextTime, performanceTime } })) accepted++; else unavailable++;
    }
    const fit = h.mapping.deviceClock();
    assert.ok(accepted > 1000, `${rate}: output mapping must not remain pending (${accepted}/${unavailable})`);
    assert.ok(Math.abs(fit.rate - rate) < .00006, `${rate}: ${fit.rate}`);
    assert.ok(fit.confidence > .3);
  }
});

test('device fit age uses the absolute observation clock and grows without recapturing output', () => {
  const origin = 1700000000000;
  let at = origin;
  const mapping = createAudioOutputMapping({ now: () => at, timeOrigin: () => origin });
  const context = { state: 'running', currentTime: .2, sampleRate: 48000,
    getOutputTimestamp: () => ({ contextTime: (at - origin) * .988 / 1000, performanceTime: at - origin }) };
  assert.equal(mapping.deviceClock().acceptedFitAgeMs, undefined);
  for (let ms = 100; ms <= 9000; ms += 100) {
    at = origin + ms; context.currentTime = ms * .988 / 1000 + .2; mapping.capture(context);
  }
  const fitted = mapping.deviceClock(); assert.equal(fitted.acceptedFitAgeMs, 400, 'new observations between fit intervals do not renew an accepted fit');
  at += 2300;
  const later = mapping.deviceClock();
  assert.equal(later.acceptedFitAgeMs, fitted.acceptedFitAgeMs + 2300);
  assert.deepEqual({ ...later, acceptedFitAgeMs: fitted.acceptedFitAgeMs }, fitted, 'the getter cannot advance the rate or fit');
});

test('output timestamps account for device delay and content filter delay exactly once', () => {
  const mapping = createAudioOutputMapping({ now: () => 1010000, timeOrigin: () => 1000000 });
  const context = { state: 'running', currentTime: 10, baseLatency: 0.025, outputLatency: 0.18,
    getOutputTimestamp: () => ({ contextTime: 9.8, performanceTime: 10000 }) };
  const snapshot = mapping.capture(context), reference = mapping.reference(feedback(), context);
  assert.equal(snapshot.outputMethod, 'timestamp');
  assert.equal(snapshot.outputLatencyMs, 200);
  assert.equal(reference.audibleTimeMs, 1010200, 'timestamp pair includes output delay; adding base/output/filter would double count it');
  assert.equal(audibleTime(400125, reference, 1010000), 1010325);
  assert.equal(reference.filterDelayMs, 17, 'filter delay is diagnostic because feedback already identifies emitted content');
  const delayed = mapping.reference(feedback({ contextTimeMs: 9500 }), context);
  assert.equal(delayed.at, 1009500, 'delayed message delivery does not make an old render report fresh again');
  assert.equal(audibleTime(400000, delayed, 1010300), null);
});

test('bounded fallback sums the two distinct latency stages once and marks its uncertainty', () => {
  let at = 1010000;
  const mapping = createAudioOutputMapping({ now: () => at, timeOrigin: () => 1000000 });
  const context = { state: 'running', currentTime: 10, sampleRate: 48000, baseLatency: 0.012, outputLatency: 0.08 };
  const reference = mapping.reference(feedback(), context);
  assert.equal(reference.outputMethod, 'latency-estimate');
  assert.equal(reference.audibleTimeMs, at + 92);
  assert.equal(reference.uncertaintyMs, 128 / 48);
  assert.equal(audibleTime(400000, reference, at + OUTPUT_REFERENCE_MAX_AGE_MS), at + 92);
  assert.equal(audibleTime(400000, reference, at + OUTPUT_REFERENCE_MAX_AGE_MS + 0.001), null);
  assert.equal(audibleTime(401001, reference, at), null, 'no unbounded extrapolation through missing reports');
  assert.equal(audibleTime(400000, reference, at - 1), null);
  at += 50;
  context.outputLatency = undefined;
  assert.equal(mapping.reference(feedback(), context).state, 'output-unavailable', 'unknown device delay must not become a fabricated zero');
  context.outputLatency = 2;
  assert.equal(mapping.capture(context), null, 'unbounded fallback latency is unavailable');
});

test('suspend, stale output timestamps, backwards timestamps and unavailable startup pairs invalidate references', () => {
  let at = 1010000, output = { contextTime: 9.8, performanceTime: 10000 };
  const mapping = createAudioOutputMapping({ now: () => at, timeOrigin: () => 1000000 });
  const context = { state: 'running', currentTime: 10, baseLatency: 0.01, outputLatency: 0.05, getOutputTimestamp: () => output };
  assert.equal(mapping.reference(feedback(), context).state, 'playing');
  at += 751;
  assert.equal(mapping.reference(feedback(), context).state, 'output-unavailable', 'a held output timestamp cannot silently become a latency estimate');
  output = { contextTime: 9.7, performanceTime: 10751 };
  assert.equal(mapping.capture(context), null, 'backwards output context needs a fresh anchor');
  context.state = 'suspended';
  assert.equal(mapping.reference(feedback(), context).state, 'output-unavailable');
  context.state = 'running'; context.currentTime = 10.8;
  output = { contextTime: 10.6, performanceTime: 10751 };
  assert.equal(mapping.reference(feedback({ contextTimeMs: 10800 }), context).audibleTimeMs, at + 200);
  mapping.reset();
  context.getOutputTimestamp = () => ({ contextTime: 0, performanceTime: 0 });
  assert.equal(mapping.capture(context).outputMethod, 'latency-estimate');
  context.getOutputTimestamp = () => { throw new Error('unsupported'); };
  assert.equal(mapping.capture(context).outputMethod, 'latency-estimate');
});

test('a short suspend cannot reuse a pre-suspend timestamp that remains inside the age limit', () => {
  let at = 1010000;
  const mapping = createAudioOutputMapping({ now: () => at, timeOrigin: () => 1000000 });
  let output = { contextTime: 9.8, performanceTime: 10000 };
  const context = { state: 'running', currentTime: 10, getOutputTimestamp: () => output };
  assert.equal(mapping.capture(context).outputMethod, 'timestamp');
  at += 50; context.state = 'suspended';
  assert.equal(mapping.capture(context), null);
  at += 50; context.state = 'running';
  assert.equal(mapping.capture(context), null, 'even a 100ms-old pair predates the resume boundary');
  output = { contextTime: 9.9, performanceTime: 10100 };
  assert.equal(mapping.capture(context).outputMethod, 'timestamp');
});

test('references retain producer/mode identity, reject reordered reports, and stop active-audio fallback', () => {
  const timeline = createAudioReferenceTimeline();
  const reference = feedback({ at: 1000, audibleTimeMs: 1100, sourceTimeMs: 5000, clockGeneration: 2 });
  timeline.update(reference);
  assert.equal(timeline.update({ ...reference, state: 'suspended', audibleTimeMs: null, at: 1001 }), true,
    'a local context-state invalidation can retire the last worklet sequence immediately');
  assert.equal(timeline.update({ ...reference, at: 1002 }), false, 'an old playing report cannot undo local invalidation');
  timeline.update({ ...reference, sequence: 2 });
  timeline.update(feedback({ mode: 'airplay-mirror', type: 6, epoch: 9, at: 1000, state: 'paused' }));
  assert.equal(timeline.resolve('carplay', 5000, 2, 1000).audioAt, 1100, 'borrowing/pausing AirPlay does not retire CarPlay audio');
  assert.equal(timeline.resolve('carplay', 5000, 3, 1000).state, 'clock-generation');
  assert.equal(timeline.resolve('carplay', 5000, 2, 1751).state, 'audio-reference-stale');
  timeline.update({ ...reference, sequence: 3, state: 'paused', at: 1100 });
  assert.equal(timeline.update({ ...reference, sequence: 1, at: 1150 }), false);
  assert.equal(timeline.resolve('carplay', 5000, 2, 1150).required, true, 'previously active audio cannot turn into silent video-only fallback');
  timeline.update({ ...reference, sequence: 4, state: 'disabled', at: 1200 });
  assert.equal(timeline.resolve('carplay', 5000, 2, 1200).required, false);
  timeline.update({ ...reference, sequence: 5, state: 'output-unavailable', playoutState: 'playing' });
  assert.equal(timeline.resolve('carplay', 5000, 2, 1200).required, true, 'a first active report with unknown output delay also requires sync');
  timeline.update(null);
  assert.equal(timeline.resolve('carplay', 5000, 2, 1200).state, 'video-only');
});

test('a fresh guidance report cannot hide stale or recovering main media', () => {
  const timeline = createAudioReferenceTimeline();
  timeline.update(feedback({ at: 1000, audibleTimeMs: 1100, sourceTimeMs: 5000 }));
  timeline.update(feedback({ type: 2, at: 1800, audibleTimeMs: 1900, sourceTimeMs: 5800 }));
  assert.equal(timeline.resolve('carplay', 5800, undefined, 1800).state, 'audio-reference-stale');
});

test('control clock captures preserve the last feedback evidence until reset', () => {
  let at = 1010000;
  const mapping = createAudioOutputMapping({ now: () => at, timeOrigin: () => 1000000 });
  const context = { state: 'running', currentTime: 10,
    getOutputTimestamp: () => ({ contextTime: (at - 1000000 - 200) / 1000, performanceTime: at - 1000000 }) };
  mapping.reference(feedback(), context);
  assert.equal(mapping.diagnostics().outputFeedbackDeltaMs, 200);
  at += 25; context.currentTime += .025;
  mapping.capture(context);
  assert.equal(mapping.diagnostics().outputFeedbackDeltaMs, 200, 'the following control sample must not erase feedback distance');
  assert.equal(mapping.diagnostics().outputFeedbackContextMs, 10000);
  assert.equal(mapping.diagnostics().outputFeedbackAgeMs, 25);
  mapping.reference(feedback({ contextTimeMs: 0 }), context);
  const rejectedDelta = mapping.diagnostics().outputFeedbackDeltaMs;
  at += 10; context.currentTime += .01; mapping.capture(context);
  assert.equal(mapping.diagnostics().outputFeedbackDeltaMs, rejectedDelta);
  assert.equal(mapping.diagnostics().outputUnavailableReason, 'feedback-distance');
  assert.equal(mapping.diagnostics().outputFeedbackAgeMs, 10);
  mapping.reset();
  assert.equal(mapping.diagnostics().outputFeedbackAgeMs, null);
  assert.equal(mapping.diagnostics().outputFeedbackDeltaMs, undefined);
});

test('output timestamp validation samples current clocks after a slow native timestamp call', () => {
  let at = 1010000, callDelayMs = 0;
  const mapping = createAudioOutputMapping({ now: () => at, timeOrigin: () => 1000000 });
  const context = { state: 'running', currentTime: 10, getOutputTimestamp() {
    at += callDelayMs; this.currentTime += callDelayMs / 1000;
    return { contextTime: this.currentTime - 0.2, performanceTime: at - 1000000 };
  } };
  assert.equal(mapping.capture(context).outputMethod, 'timestamp');
  at += 40; context.currentTime += 0.04; callDelayMs = 40;
  const output = mapping.capture(context);
  assert.equal(output?.outputMethod, 'timestamp', 'time spent obtaining a pair cannot make that pair appear to come from the future');
  assert.ok(Math.abs(output.outputLatencyMs - 200) < 1e-8);
  assert.equal(mapping.diagnostics().outputTimestampCaptureMs, 40);
  const receivedAt = at;
  const reference = mapping.reference(feedback({ contextTimeMs: context.currentTime * 1000 }), context);
  assert.ok(Math.abs(reference.at - receivedAt) < 1e-8, 'native sampling time cannot be subtracted twice from the feedback render boundary');
});

test('a noisy timestamp uses a bounded, explicitly uncertain holdover without accepting the bad pair', () => {
  let at = 1010000, output = { contextTime: 9.8, performanceTime: 10000 };
  const mapping = createAudioOutputMapping({ now: () => at, timeOrigin: () => 1000000 });
  const context = { state: 'running', currentTime: 10, sampleRate: 48000,
    baseLatency: 0.012, outputLatency: 0.188, getOutputTimestamp: () => output };
  mapping.capture(context);
  at += 40; context.currentTime += 0.04;
  output = { contextTime: 9.79, performanceTime: 9990 };
  const held = mapping.capture(context);
  assert.equal(held?.outputMethod, 'timestamp-holdover');
  assert.equal(held.contextTimeMs, 9800, 'the backward native sample never replaces the good output anchor');
  assert.equal(held.performanceTimeMs, 1010000);
  assert.ok(held.uncertaintyMs > 0);
  assert.equal(mapping.diagnostics().outputTimestampHoldoverAgeMs, 40);
  assert.equal(mapping.diagnostics().outputUnavailableCounts['timestamp-backwards'], 1);
  at += 40; context.currentTime += 0.04;
  assert.ok(mapping.capture(context).uncertaintyMs > held.uncertaintyMs);
  at += 671; context.currentTime += 0.671;
  assert.equal(mapping.capture(context), null, 'a rejected stream cannot refresh the good anchor beyond 750ms');
  mapping.reset(); at += 1; output = { contextTime: context.currentTime - 0.2, performanceTime: at - 1000000 };
  mapping.capture(context); at += 40; context.currentTime += 0.04; context.outputLatency = 0.288;
  output = { contextTime: context.currentTime - 0.2, performanceTime: at - 1000000 + 40 };
  assert.equal(mapping.capture(context), null, 'a changed reported output path cannot reuse an old route anchor');
});

test('a real context-counter reversal abandons the old native output anchor', () => {
  let at = 1010000, output = { contextTime: 9.8, performanceTime: 10000 };
  const mapping = createAudioOutputMapping({ now: () => at, timeOrigin: () => 1000000 });
  const context = { state: 'running', currentTime: 10, getOutputTimestamp: () => output };
  mapping.capture(context);
  at += 40; context.currentTime = 9; output = { contextTime: 8.8, performanceTime: 10040 };
  const fresh = mapping.capture(context);
  assert.equal(fresh?.contextTimeMs, 8800, 'a real render reversal cannot remain tied to the old higher sample counter');
  assert.equal(fresh.outputMethod, 'timestamp');
  assert.equal(mapping.deviceClock().reason, 'context-backwards');
});

test('a repeated native pair cannot refresh its route history or hide an output latency change', () => {
  let at = 1010000, output = { contextTime: 9.8, performanceTime: 10000 };
  const mapping = createAudioOutputMapping({ now: () => at, timeOrigin: () => 1000000 });
  const context = { state: 'running', currentTime: 10, baseLatency: .012, outputLatency: .188,
    getOutputTimestamp: () => output };
  mapping.capture(context);
  at += 40; context.currentTime += .04; context.outputLatency = .288;
  assert.equal(mapping.capture(context), null, 'a changed output path needs an advancing native timestamp');
  at += 40; context.currentTime += .04; output = { contextTime: 9.79, performanceTime: 10080 };
  assert.equal(mapping.capture(context), null, 'an old pair cannot acquire the new route latency merely by being returned again');
});

test('a native pipeline step invalidates holdover even if reported latency attributes stay unchanged', () => {
  for (const nextLatencyMs of [180, 260]) {
    let at = 1010000, latencyMs = 30, cachedPair = null;
    const mapping = createAudioOutputMapping({ now: () => at, timeOrigin: () => 1000000 });
    const context = { state: 'running', currentTime: 10, sampleRate: 48000, baseLatency: .01, outputLatency: .02,
      getOutputTimestamp: () => cachedPair || ({ contextTime: (at - 1000000 - latencyMs) / 1000, performanceTime: at - 1000000 }) };
    const originalPair = context.getOutputTimestamp();
    mapping.capture(context);
    at += 100; context.currentTime += .1; latencyMs = nextLatencyMs;
    assert.equal(mapping.capture(context), null, 'a backward pair contradicting the old mapping is not harmless measurement noise');
    cachedPair = originalPair;
    assert.equal(mapping.capture(context), null, 'a repeated old snapshot cannot revive an anchor contradicted by the changed pipeline');
    cachedPair = null;
    at += 100; context.currentTime += .1;
    assert.equal(mapping.capture(context)?.outputMethod, 'timestamp', 'two coherent native pairs establish the changed output path, even below the old counter');
  }
});

test('output mapping and content extrapolation share physical time with a slow device clock', () => {
  let at = 1700000000000, timestamp;
  const mapping = createAudioOutputMapping({ now: () => at, timeOrigin: () => 1700000000000 });
  const deviceRate = 0.996;
  const context = { state: 'running', currentTime: 0, getOutputTimestamp: () => timestamp };
  for (let ms = 40; ms <= 30000; ms += 40) {
    at = 1700000000000 + ms; timestamp = { contextTime: ms * deviceRate / 1000, performanceTime: ms };
    context.currentTime = (ms * deviceRate + 188 * deviceRate) / 1000;
    mapping.capture(context);
  }
  assert.ok(Math.abs(mapping.deviceClock().rate - deviceRate) < 1e-8);
  const reference = mapping.reference(feedback({ contextTimeMs: timestamp.contextTime * 1000 + 100 * deviceRate,
    mediaRate: 1 / deviceRate }), context);
  assert.ok(Math.abs(reference.audibleTimeMs - at - 100) < 1e-6);
  assert.ok(Math.abs(reference.mediaRate - 1) < 1e-8, 'source/context feedback is converted to source/performance');
  assert.ok(Math.abs(reference.outputLatencyMs - 188) < 1e-6);
  assert.ok(Math.abs(reference.at - (at - 88)) < 1e-6);
  assert.ok(Math.abs(audibleTime(400500, reference, at) - at - 600) < 1e-6);
  mapping.reference(feedback({ contextTimeMs: 0 }), context);
  assert.equal(mapping.diagnostics().outputUnavailableReason, 'feedback-distance');
  context.state = 'suspended'; mapping.capture(context);
  assert.equal(mapping.deviceClock().rate, 1);
  assert.equal(mapping.diagnostics().outputUnavailableCounts['context-suspended'], 1);
});
