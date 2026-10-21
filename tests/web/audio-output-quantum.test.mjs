// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioOutputMapping } from '../../site/play/audio-output-clock.js';

function fallback() {
  const origin = 1000000;
  const mapping = createAudioOutputMapping({ now: () => origin + 10000, timeOrigin: () => origin });
  const context = { state: 'running', sampleRate: 48000, currentTime: 10, baseLatency: .012, outputLatency: .188 };
  return { mapping, context };
}
const feedback = frames => ({ state: 'playing', contextTimeMs: 10000,
  sourceTimeMs: 8000000, mediaRate: 1, filterUncertaintyMs: .125, renderQuantumFrames: frames });

test('normal playout feedback expands larger quantum bounds while preserving the 128-frame compatibility floor', () => {
  for (const frames of [64, 128, 256]) {
    const { mapping, context } = fallback();
    const reference = mapping.reference(feedback(frames), context);
    assert.equal(reference.outputMethod, 'latency-estimate');
    assert.equal(reference.uncertaintyMs, Math.max(128, frames) / 48 + .125);
    assert.equal(reference.audibleTimeMs, 1010200, 'learning a quantum changes only the measurement bound');
    assert.equal(mapping.capture(context).uncertaintyMs, Math.max(128, frames) / 48,
      'later control captures reuse the observed quantum without Debug diagnostics');
  }
});

test('quantum observations are context-local, conservative across block changes and cleared on reset', () => {
  const { mapping, context } = fallback();
  assert.equal(mapping.capture(context).uncertaintyMs, 128 / 48, 'legacy default applies before any observation');
  mapping.observeRenderQuantum(context, 64);
  assert.equal(mapping.capture(context).uncertaintyMs, 128 / 48,
    'a smaller observed quantum preserves the established conservative allowance');
  mapping.observeRenderQuantum(context, 256);
  mapping.observeRenderQuantum(context, 64);
  for (const value of [null, undefined, NaN, Infinity, -1, 0, 1.5, '512', Number.MAX_SAFE_INTEGER + 1]) {
    mapping.observeRenderQuantum(context, value);
  }
  assert.equal(mapping.capture(context).uncertaintyMs, 256 / 48, 'smaller or invalid observations cannot shrink the bound');
  const other = { ...context };
  assert.equal(mapping.capture(other).uncertaintyMs, 128 / 48, 'replacement contexts do not inherit old render blocks');
  assert.equal(mapping.capture(context).uncertaintyMs, 256 / 48, 'returning to a live context preserves its own bound');
  mapping.reset();
  assert.equal(mapping.capture(context).uncertaintyMs, 128 / 48, 'reset retires observations from the old owner');
});

test('native renderQuantumSize bounds contexts without worklet feedback and combines conservatively with observations', () => {
  for (const frames of [64, 128, 256]) {
    const { mapping, context } = fallback();
    context.renderQuantumSize = frames;
    assert.equal(mapping.capture(context).uncertaintyMs, Math.max(128, frames) / 48);
    mapping.observeRenderQuantum(context, frames * 2);
    assert.equal(mapping.capture(context).uncertaintyMs, frames * 2 / 48);
    mapping.reset();
    assert.equal(mapping.capture(context).uncertaintyMs, Math.max(128, frames) / 48, 'a current native hint is available after reset');
  }
});

test('a larger block between ordinary feedback messages remains in the reported context bound', () => {
  const { mapping, context } = fallback();
  const reference = mapping.reference({ ...feedback(64), renderQuantumMaxFrames: 256 }, context);
  assert.equal(reference.uncertaintyMs, 256 / 48 + .125,
    'a later small block must not hide a larger block rendered between feedback messages');
});

test('actual quantum bounds prevent false native timestamp discontinuities and preserve device fit acquisition', () => {
  for (const frames of [64, 128, 256]) {
    const origin = 1000000, rate = .988, quantumMs = frames / 48;
    let at = 10000, pair;
    const mapping = createAudioOutputMapping({ now: () => origin + at, timeOrigin: () => origin });
    const context = { state: 'running', sampleRate: 48000, currentTime: 10,
      getOutputTimestamp: () => pair };
    mapping.observeRenderQuantum(context, frames);
    let accepted = 0, unavailable = 0;
    for (; at < 55000; at += 8) {
      context.currentTime = at * rate / 1000;
      pair = { contextTime: Math.floor((at - 200) * rate / quantumMs) * quantumMs / 1000,
        performanceTime: at + .7 * Math.sin(at * .37) };
      if (mapping.capture(context)) accepted++; else unavailable++;
    }
    const fit = mapping.deviceClock();
    assert.ok(accepted > .95 * (accepted + unavailable), `${frames} frames: spurious unavailable pairs ${unavailable}`);
    assert.ok(Math.abs(fit.rate - rate) < .0001, `${frames} frames: fit ${fit.rate}`);
    assert.ok(fit.confidence > .3, `${frames} frames: fit must acquire through bounded quantization`);
  }
});

test('larger observed quanta still reject a real contradictory native timestamp', () => {
  const origin = 1000000;
  let at = 10000, offset = 0;
  const mapping = createAudioOutputMapping({ now: () => origin + at, timeOrigin: () => origin });
  const context = { state: 'running', sampleRate: 48000, currentTime: 10,
    getOutputTimestamp: () => ({ contextTime: (at - 200 + offset) / 1000, performanceTime: at }) };
  mapping.observeRenderQuantum(context, 256);
  assert.equal(mapping.capture(context).outputMethod, 'timestamp');
  at += 40; context.currentTime = at / 1000; offset = -38;
  assert.equal(mapping.capture(context), null);
  assert.equal(mapping.diagnostics().outputUnavailableReason, 'timestamp-discontinuity');
  assert.equal(mapping.deviceClock().points, 1, 'a real phase contradiction still cannot train the fit');
});
