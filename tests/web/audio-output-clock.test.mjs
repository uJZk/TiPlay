// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { audibleTime, createAudioOutputMapping, createAudioReferenceTimeline, OUTPUT_REFERENCE_MAX_AGE_MS } from '../../site/play/audio-output-clock.js';

const feedback = (extra = {}) => ({ mode: 'carplay', type: 0, epoch: 1, generation: 1, sequence: 1,
  state: 'playing', sourceTimeMs: 400000, contextTimeMs: 10000, mediaRate: 1, filterDelayMs: 17, ...extra });

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
