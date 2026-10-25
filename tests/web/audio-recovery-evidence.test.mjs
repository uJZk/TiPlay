// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ContinuousAudio } from '../../site/play/continuous-audio.js';
import { SoxrRuntime } from '../../site/play/streaming-resampler.js';

const runtime = new SoxrRuntime(), quantumMs = 128000 / 48000, sourceBase = 800000;
const evidenceKeys = ['lastClockStepPhaseErrorMs', 'lastClockStepDeviceRatePpm',
  'lastClockStepUncertaintyMs', 'lastClockStepAgeMs'];
function harness() {
  const player = new ContinuousAudio(runtime, 48000, 1, 48000, () => {}, 6500, { buffered: true, mode: 'airplay-mirror' });
  player.epoch = 56; player.generation = 3; player.synchronized = true;
  for (let frame = 0, sequence = 0; frame < 24000; frame += 960, sequence++) {
    const pcm = Int16Array.from({ length: 960 }, (_, index) => Math.round(10000 * Math.sin((frame + index) * 0.13)));
    player.push({ pcm: pcm.buffer, presentationMs: sourceBase + frame / 48, sequence, generation: 3 });
  }
  const clock = { generation: 1, rate: 1, state: 'locked' }, block = new Float32Array(128);
  const render = (errorMs, contextMs, deviceRate = 1, uncertaintyMs = 1) => {
    player.render((player.rawCursorMs ?? sourceBase) + errorMs, contextMs, clock, 128, block, deviceRate, { uncertaintyMs });
  };
  return { player, render, block };
}

function assertAbsent(reference, keys = evidenceKeys) {
  for (const key of keys) assert.equal(Object.hasOwn(reference, key), false, `${key} must remain unknown`);
}

test('clock-step evidence is absent before a real trigger and on a replacement timeline', () => {
  const first = harness(), replacement = harness();
  try {
    assertAbsent(first.player.reference(0));
    first.render(0, 0); first.render(0, quantumMs);
    assertAbsent(first.player.reference(quantumMs));
    first.render(40, 37.5);
    assert.equal(first.player.reference(37.5).lastClockStepPhaseErrorMs, 40);
    assertAbsent(replacement.player.reference(37.5));
  } finally { first.player.clear(); replacement.player.clear(); }
});

for (const signedErrorMs of [-40, 40]) test(`clock-step keeps its signed ${signedErrorMs}ms trigger after the live phase recovers`, () => {
  const h = harness();
  try {
    h.render(0, 0);
    h.render(signedErrorMs, 37.5, 0.988, 7.25);
    h.render(0, 37.5 + quantumMs, 1.001, 0.5);
    h.render(0, 37.5 + 2 * quantumMs, 1.001, 0.5);
    const reference = h.player.reference(137.5);
    assert.equal(reference.phaseErrorMs, 0, 'the current healthy phase must remain independent of the triggering phase');
    assert.equal(reference.lastClockStepPhaseErrorMs, signedErrorMs);
    assert.ok(Math.abs(reference.lastClockStepDeviceRatePpm + 12000) < 1e-6, 'capture the triggering render argument, not a previous/later device rate');
    assert.equal(reference.lastClockStepUncertaintyMs, 7.25);
    assert.equal(reference.lastClockStepAgeMs, 100);
    assert.equal(reference.recoveryCounts['clock-step'], 1);
    assert.equal(reference.epoch, 56); assert.equal(reference.generation, 3);
  } finally { h.player.clear(); }
});

test('clock-step evidence retains only the latest trigger without merging older known fields', () => {
  const h = harness();
  try {
    h.render(0, 0); h.render(40, 37.5, 0.988, 7.25); h.render(0, 40);
    h.render(60, 100, 1, NaN);
    const reference = h.player.reference(105);
    assert.equal(reference.lastClockStepPhaseErrorMs, 60);
    assert.equal(reference.lastClockStepDeviceRatePpm, 0, 'a measured nominal device rate is a known zero');
    assert.equal(reference.lastClockStepAgeMs, 5);
    assertAbsent(reference, ['lastClockStepUncertaintyMs']);
    assert.equal(reference.recoveryCounts['clock-step'], 2);
  } finally { h.player.clear(); }
});

test('clock-step age uses the real context domain and never invents an age for invalid or backward reads', () => {
  const h = harness();
  try {
    h.render(0, 0); h.render(40, 100, 1, 0);
    assert.equal(h.player.reference(100).lastClockStepAgeMs, 0);
    assert.equal(h.player.reference(100).lastClockStepUncertaintyMs, 0);
    for (const contextMs of [undefined, null, NaN, Infinity, -1, 99])
      assertAbsent(h.player.reference(contextMs), ['lastClockStepAgeMs']);
  } finally { h.player.clear(); }
});

test('clock-step captures before DSP recovery and omits invalid rate, uncertainty and trigger time', () => {
  const h = harness(), stop = new Error('stop after the recovery boundary');
  try {
    h.render(0, 0);
    const recover = h.player.recover.bind(h.player);
    h.player.recover = reason => {
      assert.equal(reason, 'clock-step');
      assert.ok(h.player.backend, 'the triggering evidence must exist before the DSP is retired');
      assert.equal(h.player.reference(10).lastClockStepPhaseErrorMs, 40);
      recover(reason); throw stop;
    };
    assert.throws(() => h.render(40, NaN, NaN, Infinity), error => error === stop);
    const reference = h.player.reference(10);
    assert.equal(reference.lastClockStepPhaseErrorMs, 40);
    assertAbsent(reference, ['lastClockStepDeviceRatePpm', 'lastClockStepUncertaintyMs', 'lastClockStepAgeMs']);
  } finally { h.player.clear(); }
});

test('reading clock-step evidence leaves the real resampler output and recovery decisions unchanged', () => {
  const observed = harness(), untouched = harness();
  try {
    for (let quantum = 0; quantum < 12; quantum++) {
      const errorMs = quantum === 3 ? 40 : 0, contextMs = quantum * quantumMs;
      observed.render(errorMs, contextMs, 0.9999, 4);
      untouched.render(errorMs, contextMs, 0.9999, 4);
      observed.player.reference(contextMs); observed.player.stats(); observed.player.reference(contextMs + 1);
      assert.deepEqual(observed.block, untouched.block);
      assert.equal(observed.player.state, untouched.player.state);
      assert.equal(observed.player.rawCursorMs, untouched.player.rawCursorMs);
      assert.deepEqual(observed.player.recoveryCounts, untouched.player.recoveryCounts);
    }
    assert.equal(observed.player.recoveryCounts['clock-step'], 1);
  } finally { observed.player.clear(); untouched.player.clear(); }
});
