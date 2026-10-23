// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioOutputMapping, OUTPUT_REFERENCE_MAX_AGE_MS } from '../../site/play/audio-output-clock.js';

const origin = 1780000000000, sampleRate = 48000, quantumMs = 128 / 48;

function harness() {
  let elapsed = 0;
  const context = { state: 'running', currentTime: 0, sampleRate, baseLatency: .01, outputLatency: .19 };
  const mapping = createAudioOutputMapping({ now: () => origin + elapsed, timeOrigin: () => origin });
  mapping.debug(true);
  const capture = (at, contextMs = at) => {
    elapsed = at; context.currentTime = contextMs / 1000; mapping.capture(context);
    return mapping.takeRenderProbe();
  };
  const acknowledge = (token, { at = elapsed, generation = 0, startFrame = 0,
    endFrame = Math.ceil(context.currentTime * sampleRate) + 128 } = {}) => {
    if (token === null) return;
    elapsed = at;
    mapping.acknowledgeRenderProbe({ token, generation, startFrame, endFrame }, context);
  };
  const sample = (at, contextMs = at, proof = {}) => {
    const token = capture(at, contextMs); acknowledge(token, proof); return token;
  };
  return { context, mapping, capture, acknowledge, sample };
}

test('main-thread cursor observations alone cannot train the render rate', () => {
  const h = harness();
  for (let at = 0; at <= 16000; at += 100) h.capture(at, at * .986);
  const fit = h.mapping.deviceClock(), diagnostics = h.mapping.diagnostics();
  assert.equal(fit.source, 'holdover'); assert.equal(fit.points, 0);
  assert.equal(fit.rate, 1); assert.equal(fit.acceptedFitAgeMs, undefined);
  assert.equal(diagnostics.renderClockProbeAccepted, 0);
  assert.ok(diagnostics.renderClockProbeRejected > 0, 'unacknowledged candidates expire without becoming measurements');
});

test('continuous worklet domains admit regular and irregular four-quantum getter batching', () => {
  for (const irregular of [false, true]) {
    const h = harness(), rate = .986;
    for (let i = 0; i <= 6000; i++) {
      const at = i * 4 + (irregular && i % 11 === 0 ? 2 : 0);
      const rendered = Math.floor((at * rate + .5) / (4 * quantumMs)) * 4 * quantumMs;
      // The actual worklet counter advances continuously in 128-frame blocks;
      // the main getter publishes groups of four. Receipt time is not fitted.
      const processedFrontier = Math.floor((at * rate + .5) * 48 / 128) * 128 + 128;
      h.sample(at, rendered, { endFrame: processedFrontier });
    }
    const fit = h.mapping.deviceClock(), diagnostics = h.mapping.diagnostics();
    assert.equal(fit.source, 'render'); assert.equal(fit.fitStatus, 'tracking');
    assert.ok(Math.abs(fit.rate - rate) < .0002, `${irregular}: ${fit.rate}`);
    assert.equal(fit.reason, 'context'); assert.equal(diagnostics.renderClockDomainChanges, 0);
    assert.ok(diagnostics.renderClockProbeAccepted >= 100);
  }
});

test('a real twenty-millisecond sample-domain jump cannot train an offset as oscillator drift', () => {
  const h = harness(), rate = .986;
  for (let at = 0; at <= 16000; at += 100) h.sample(at, at * rate);
  const before = h.mapping.deviceClock();
  assert.equal(before.source, 'render');
  const startFrame = Math.round((16100 * rate + 20) * 48);
  const token = h.capture(16100, 16100 * rate + 20);
  const beforeAcknowledgement = h.mapping.deviceClock();
  h.acknowledge(token, { generation: 1, startFrame });
  const changed = h.mapping.deviceClock(), diagnostics = h.mapping.diagnostics();
  assert.equal(changed.reason, 'sample-domain'); assert.equal(changed.generation, before.generation + 1);
  assert.equal(changed.points, 0, 'the acknowledgement of a new domain retires its captured cross-boundary candidate');
  assert.equal(changed.source, 'holdover'); assert.equal(changed.acceptedFitAgeMs, undefined);
  assert.equal(changed.rate, beforeAcknowledgement.rate, 'the acknowledgement cannot step the already applied correction');
  assert.equal(changed.targetRatePpm, changed.ratePpm, 'domain retirement freezes the applied rate immediately, before another capture');
  assert.equal(diagnostics.renderClockDomainChanges, 1);
  for (let at = 16200; at <= 36000; at += 100)
    h.sample(at, at * rate + 20, { generation: 1, startFrame });
  const recovered = h.mapping.deviceClock();
  assert.equal(recovered.source, 'render'); assert.ok(Math.abs(recovered.rate - rate) < .00001);
  assert.equal(recovered.generation, changed.generation);
});

test('reset retires pending proof and tokens are never reused', () => {
  const h = harness();
  const oldToken = h.capture(0);
  h.mapping.reset();
  const currentToken = h.capture(100);
  assert.ok(currentToken > oldToken);
  h.acknowledge(oldToken);
  assert.equal(h.mapping.diagnostics().renderClockProbeState, 'waiting-ack');
  assert.equal(h.mapping.diagnostics().renderClockDomainGeneration, null);
  h.acknowledge(currentToken);
  assert.equal(h.mapping.diagnostics().renderClockDomainGeneration, 0);
  assert.equal(h.mapping.diagnostics().renderClockProbeAccepted, 0, 'initial domain acquisition does not admit the old candidate');
});

test('a delayed valid proof retains the original capture age rather than refreshing it at receipt', () => {
  const h = harness();
  for (let at = 0; at <= 8000; at += 100) h.sample(at);
  const before = h.mapping.diagnostics().renderClockProbeAccepted;
  const token = h.capture(8100);
  h.acknowledge(token, { at: 8100 + OUTPUT_REFERENCE_MAX_AGE_MS });
  const fit = h.mapping.deviceClock();
  assert.equal(h.mapping.diagnostics().renderClockProbeAccepted, before + 1);
  assert.equal(fit.source, 'render'); assert.equal(fit.acceptedFitAgeMs, OUTPUT_REFERENCE_MAX_AGE_MS);
});

test('a proof older than the reference limit cannot admit a rate measurement', () => {
  const h = harness();
  h.sample(0); h.sample(100);
  const before = h.mapping.diagnostics().renderClockProbeAccepted;
  const token = h.capture(200);
  h.acknowledge(token, { at: 200 + OUTPUT_REFERENCE_MAX_AGE_MS + 1 });
  const diagnostics = h.mapping.diagnostics();
  assert.equal(diagnostics.renderClockProbeAccepted, before);
  assert.equal(diagnostics.renderClockProbeReason, 'invalid-proof');
  assert.equal(diagnostics.renderClockProbeState, 'idle');
});

test('proof must cover the captured coordinate within its continuous frame run', () => {
  for (const outside of ['before', 'after']) {
    const h = harness(); h.sample(0);
    const token = h.capture(100), frame = Math.round(h.context.currentTime * sampleRate);
    const proof = outside === 'before' ? { startFrame: frame + 1, endFrame: frame + 129 }
      : { startFrame: 0, endFrame: frame - 1 };
    h.acknowledge(token, proof);
    const diagnostics = h.mapping.diagnostics();
    assert.equal(diagnostics.renderClockProbeAccepted, 0);
    assert.equal(diagnostics.renderClockProbeReason, 'outside-run');
    assert.equal(h.mapping.deviceClock().points, 0);
  }
});
