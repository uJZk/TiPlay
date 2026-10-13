// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPresentation } from '../../site/play/presentation-debug.js';
import { createFramePresenter } from '../../site/play/video.js';

test('the recorder reports the actual drawn frame and never invents an unavailable source', () => {
  const samples = [], context = { fillRect() {}, drawImage() {} };
  const canvas = { width: 800, height: 480, removeEventListener() {}, getContext: type => type === '2d' ? context : null };
  const presenter = createFramePresenter(canvas, { onPresentation: sample => samples.push(sample) });
  const frame = () => ({ displayWidth: 800, displayHeight: 480, close() {} });
  const source = performance.timeOrigin + performance.now() + 500;
  presenter.present(frame(), { mode: 'carplay' }, source);
  assert.equal(samples[0].sourceTime, source);
  assert.ok(samples[0].offsetMs < 0, 'future expected times do not hold decoded video');
  assert.equal(samples[0].offsetMs, samples[0].submittedTime - source);
  presenter.present(frame(), { mode: 'carplay' }, null);
  assert.equal(samples[1].sourceTime, null);
  assert.equal(samples[1].offsetMs, null);
  presenter.dispose();
});

test('visible timing contains millisecond precision and an explicit unavailable label', () => {
  const at = new Date(2026, 9, 13, 12, 34, 56, 789).getTime();
  assert.equal(formatPresentation({ sourceTime: at, submittedTime: at + 35, offsetMs: 35 }, 'zh'),
    '源预期 12:34:56.789 · 提交 12:34:56.824 · Δ +35 ms');
  assert.match(formatPresentation({ submittedTime: at, offsetMs: null }, 'en'), /Source expected Unavailable.*Δ —/);
});
