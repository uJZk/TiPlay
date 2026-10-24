// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioOutputMapping } from '../../site/play/audio-output-clock.js';

function confirmRender(mapping, context, domain, frame, blockFrames = 128) {
  domain.startFrame ??= Math.max(0, frame - blockFrames);
  const token = mapping.takeRenderProbe();
  if (token !== null) mapping.acknowledgeRenderProbe({ token, generation: domain.generation,
    startFrame: domain.startFrame, endFrame: frame, renderQuantumFrames: blockFrames }, context);
}

function fallback(frames = 128) {
  const origin = 1000000;
  const mapping = createAudioOutputMapping({ now: () => origin + 10000, timeOrigin: () => origin });
  const context = { state: 'running', sampleRate: 48000, currentTime: 10, baseLatency: .012, outputLatency: .188 };
  mapping.capture(context);
  confirmRender(mapping, context, { generation: 0, startFrame: 0 }, 480000, frames);
  return { mapping, context };
}
const feedback = frames => ({ state: 'playing', contextTimeMs: 10000,
  sourceTimeMs: 8000000, mediaRate: 1, filterUncertaintyMs: .125, renderQuantumFrames: frames });

function nativeQuantumFixture() {
  let at = 10000, pair = null;
  const mapping = createAudioOutputMapping({ now: () => at, timeOrigin: () => 0 });
  const context = { state: 'running', sampleRate: 48000, currentTime: NaN, getOutputTimestamp: () => pair };
  return { mapping, context,
    seed(owner = context) {
      // Switching owners retires phase, while each owner's quantum observations
      // remain its own. The sample counter follows physical wall time directly.
      mapping.capture({ ...owner }); pair = null; mapping.capture(owner);
      confirmRender(mapping, owner, { generation: 0, startFrame: 0 }, at * 48);
      pair = { contextTime: (at - 200) / 1000, performanceTime: at };
      assert.equal(mapping.capture(owner)?.outputMethod, 'timestamp');
    },
    phaseNoise(owner = context) {
      at += 100;
      // Six milliseconds exceeds a 128-frame allowance plus the permitted 2%
      // rate variation, but fits a 256-frame allowance plus that same variation.
      pair = { contextTime: (at - 200 + 6) / 1000, performanceTime: at };
      return mapping.capture(owner);
    },
  };
}

test('latency fallback encloses the complete causal interval of each verified render quantum', () => {
  for (const frames of [64, 128, 256]) {
    const { mapping, context } = fallback(frames);
    const reference = mapping.reference(feedback(frames), context);
    assert.equal(reference.outputMethod, 'latency-estimate');
    // Request and ACK occur at 10,000ms. The returned logical block end may
    // still be up to one whole quantum ahead, at the slowest permitted rate.
    const earliest = 1010200, latest = earliest + frames / 48 / .98;
    assert.ok(reference.audibleTimeMs - reference.uncertaintyMs <= earliest);
    assert.ok(reference.audibleTimeMs + reference.uncertaintyMs >= latest);
    assert.ok(reference.uncertaintyMs <= (latest - earliest) / 2 + .125 + 1e-8,
      'an ideal zero-RTT proof does not invent uncertainty from the public getter');
    const again = mapping.capture(context);
    assert.ok(again.performanceTimeMs - again.uncertaintyMs <= earliest);
    assert.ok(again.performanceTimeMs + again.uncertaintyMs >= latest);
  }
});

test('native quantum observations are context-local, conservative across block changes and cleared on reset', () => {
  const h = nativeQuantumFixture();
  h.mapping.observeRenderQuantum(h.context, 256); h.mapping.observeRenderQuantum(h.context, 64);
  for (const value of [null, undefined, NaN, Infinity, -1, 0, 1.5, '512', Number.MAX_SAFE_INTEGER + 1])
    h.mapping.observeRenderQuantum(h.context, value);
  h.seed(); assert.equal(h.phaseNoise()?.outputMethod, 'timestamp', 'a smaller or invalid observation cannot shrink the larger bound');
  const other = { ...h.context };
  h.seed(other); assert.equal(h.phaseNoise(other), null, 'a replacement context does not inherit the previous block size');
  h.seed(); assert.equal(h.phaseNoise()?.outputMethod, 'timestamp', 'returning to the old owner preserves its larger observation');
  h.mapping.reset(); h.seed();
  assert.equal(h.phaseNoise(), null, 'reset retires historical quantum observations');
});

test('native renderQuantumSize combines conservatively with verified Worklet and feedback observations', () => {
  for (const frames of [64, 128, 256]) {
    const h = nativeQuantumFixture(); h.context.renderQuantumSize = frames; h.seed();
    assert.equal(h.phaseNoise()?.outputMethod === 'timestamp', frames >= 256);
    const expanded = nativeQuantumFixture(); expanded.context.renderQuantumSize = frames;
    expanded.mapping.observeRenderQuantum(expanded.context, frames * 2); expanded.seed();
    assert.equal(expanded.phaseNoise()?.outputMethod === 'timestamp', frames * 2 >= 256);
    expanded.mapping.reset(); expanded.seed();
    assert.equal(expanded.phaseNoise()?.outputMethod === 'timestamp', frames >= 256,
      'a current native hint is restored after reset without reviving old feedback observations');
  }
});

test('larger blocks between ordinary feedback messages still bound native phase comparisons', () => {
  const h = nativeQuantumFixture(); h.seed();
  h.mapping.reference({ ...feedback(64), renderQuantumMaxFrames: 256 }, h.context);
  assert.equal(h.phaseNoise()?.outputMethod, 'timestamp',
    'a later small block must not hide a larger block rendered between feedback messages');
});

test('actual quantum bounds prevent false native timestamp discontinuities and preserve device fit acquisition', () => {
  for (const frames of [64, 128, 256]) {
    const origin = 1000000, rate = .988, quantumMs = frames / 48;
    let at = 10000, pair;
    const mapping = createAudioOutputMapping({ now: () => origin + at, timeOrigin: () => origin });
    const context = { state: 'running', sampleRate: 48000, currentTime: 10,
      getOutputTimestamp: () => pair };
    const domain = { generation: 0, startFrame: null };
    mapping.observeRenderQuantum(context, frames);
    let accepted = 0, unavailable = 0;
    for (; at < 55000; at += 8) {
      context.currentTime = at * rate / 1000;
      pair = { contextTime: Math.floor((at - 200) * rate / quantumMs) * quantumMs / 1000,
        performanceTime: at + .7 * Math.sin(at * .37) };
      if (mapping.capture(context)) accepted++; else unavailable++;
      const actualFrame = Math.floor(at * rate * 48 / frames) * frames;
      confirmRender(mapping, context, domain, actualFrame, frames);
    }
    const fit = mapping.deviceClock();
    assert.ok(accepted > .95 * (accepted + unavailable), `${frames} frames: spurious unavailable pairs ${unavailable}`);
    assert.ok(Math.abs(fit.rate - rate) < .0001, `${frames} frames: fit ${fit.rate}`);
    assert.ok(fit.confidence > .3, `${frames} frames: fit must acquire through bounded quantization`);
  }
});

test('larger observed quanta still reject a real contradictory native timestamp', () => {
  const origin = 1000000;
  let at = 9900, offset = 0;
  const mapping = createAudioOutputMapping({ now: () => origin + at, timeOrigin: () => origin });
  const context = { state: 'running', sampleRate: 48000, currentTime: 9.9, getOutputTimestamp: () => null };
  const domain = { generation: 0, startFrame: null };
  mapping.observeRenderQuantum(context, 256);
  mapping.capture(context); confirmRender(mapping, context, domain, 475136, 256);
  at = 10000; context.currentTime = 10;
  context.getOutputTimestamp = () => ({ contextTime: (at - 200 + offset) / 1000, performanceTime: at });
  assert.equal(mapping.capture(context).outputMethod, 'timestamp');
  confirmRender(mapping, context, domain, 480000, 256);
  const before = mapping.deviceClock().points;
  at += 40; context.currentTime = at / 1000; offset = -38;
  assert.equal(mapping.capture(context), null);
  confirmRender(mapping, context, domain, 481792, 256);
  assert.equal(mapping.diagnostics().outputUnavailableReason, 'timestamp-discontinuity');
  assert.equal(mapping.deviceClock().points, before, 'a real phase contradiction still cannot train the fit');
});
