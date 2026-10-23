// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { ContinuousAudio } from '../../site/play/continuous-audio.js';
import { SoxrRuntime } from '../../site/play/streaming-resampler.js';

const runtime = new SoxrRuntime(), base = 800000, quantumMs = 128000 / 48000;
const keys = ['lastSourceDeadlineDeltaUpperMs', 'lastSourceDeadlineUncertaintyMs',
  'lastSourceDeadlineLimitMs', 'lastSourceDeadlineAgeMs'];
function harness(debug = true) {
  const player = new ContinuousAudio(runtime, 48000, 1, 48000, () => {}, 1000,
    { buffered: true, mode: 'airplay-mirror' });
  player.debug(debug); player.epoch = 2; player.generation = 3; player.synchronized = true;
  for (let frame = 0, sequence = 0; frame < 24000; frame += 960, sequence++) player.push({
    pcm: Int16Array.from({ length: 960 }, (_, i) => Math.round(10000 * Math.sin((frame + i) * .13))).buffer,
    presentationMs: base + frame / 48, sequence, generation: 3,
  });
  const clock = { generation: 1, rate: 1, state: 'locked', serverOriginMs: base, localOriginMs: 0 };
  const block = new Float32Array(128);
  function render(contextMs, ageMs = 100, uncertaintyMs = 2, limitMs = 300) {
    const target = player.rawCursorMs ?? base;
    player.render(target, contextMs, clock, 128, block, 1,
      { outputAt: target - base + ageMs, uncertaintyMs, limitMs });
  }
  return { player, block, render };
}
function absent(stats, fields = keys) {
  for (const key of fields) assert.equal(Object.hasOwn(stats, key), false, `${key} stays unknown`);
}

test('source-deadline evidence keeps the rejected quantum after actual PCM recovers', () => {
  const h = harness();
  try {
    absent(h.player.stats()); h.render(0); h.render(quantumMs);
    assert.ok(h.block.some(x => x !== 0)); absent(h.player.stats());
    h.render(10, 310, 7.25);
    const rejectedUpper = h.player.sourceDeltaUpperMs;
    assert.ok(rejectedUpper > 317 && rejectedUpper < 318);
    assert.equal(h.player.sourceDeadlineState, 'violated');
    assert.ok(h.block.every(x => x === 0));
    assert.equal(h.player.stats().lastSourceDeadlineLimitMs, 300);
    assert.equal(h.player.stats().lastSourceDeadlineUncertaintyMs, 7.25);
    assert.equal(h.player.stats().lastSourceDeadlineDeltaUpperMs, rejectedUpper);
    assert.ok(Math.abs(h.player.stats().lastSourceDeadlineAgeMs - quantumMs) < 1e-10);
    absent(h.player.reference(100), keys);
    h.render(100, 100, .5);
    assert.equal(h.player.sourceDeadlineState, 'within-bound');
    assert.ok(h.block.some(x => x !== 0), 'a new healthy quantum really emits audio');
    const healthy = h.player.stats();
    assert.equal(healthy.lastSourceDeadlineDeltaUpperMs, rejectedUpper);
    assert.equal(healthy.lastSourceDeadlineUncertaintyMs, 7.25);
    assert.ok(Math.abs(healthy.lastSourceDeadlineAgeMs - (90 + quantumMs)) < 1e-10);
    assert.equal(h.player.recoveryCounts['source-deadline'], 1);
    assert.equal(healthy.epoch, 2); assert.equal(healthy.generation, 3);
  } finally { h.player.clear(); }
});

test('source-deadline evidence replaces the latest event and omits invalid timing', () => {
  const h = harness();
  try {
    h.render(0); h.render(10, 310, 2);
    h.render(20); h.render(-1, 410, 0, 400);
    const latest = h.player.stats();
    assert.equal(latest.lastSourceDeadlineLimitMs, 400);
    assert.equal(latest.lastSourceDeadlineUncertaintyMs, 0, 'measured zero remains known');
    assert.ok(latest.lastSourceDeadlineDeltaUpperMs > 409 && latest.lastSourceDeadlineDeltaUpperMs < 411);
    absent(latest, ['lastSourceDeadlineAgeMs']);
    h.render(5); absent(h.player.stats(), ['lastSourceDeadlineAgeMs']);
  } finally { h.player.clear(); }
});

test('Debug starts a fresh deadline interval and new timelines do not inherit old events', () => {
  const h = harness(), replacement = harness();
  try {
    h.render(0); h.render(10, 310);
    assert.ok(h.player.stats().lastSourceDeadlineDeltaUpperMs > 300);
    absent(replacement.player.stats());
    h.player.debug(false); absent(h.player.stats());
    h.render(20); h.render(30, 310); absent(h.player.stats());
    h.player.debug(true); absent(h.player.stats());
    h.render(40); h.render(50, 310);
    assert.ok(h.player.stats().lastSourceDeadlineDeltaUpperMs > 300);
  } finally { h.player.clear(); replacement.player.clear(); }
});

test('deadline diagnostics preserve every resampled sample and recovery decision with Debug off or on', () => {
  const observed = harness(), standard = harness(false);
  try {
    for (let i = 0; i < 60; i++) {
      const age = i === 10 || i === 40 ? 310 : 100;
      observed.render(i * quantumMs, age); standard.render(i * quantumMs, age);
      observed.player.stats();
      assert.deepEqual(observed.block, standard.block);
      assert.equal(observed.player.rawCursorMs, standard.player.rawCursorMs);
      assert.deepEqual(observed.player.recoveryCounts, standard.player.recoveryCounts);
    }
    assert.equal(observed.player.recoveryCounts['source-deadline'], 2);
    absent(standard.player.stats());
  } finally { observed.player.clear(); standard.player.clear(); }
});
