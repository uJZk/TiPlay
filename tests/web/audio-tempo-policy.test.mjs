// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackTempo, updateVideoTempoCorrection, VIDEO_SYNC_TARGET_MS } from '../../site/play/audio-tempo-policy.js';

test('manual tempo retains synchronization headroom at both ends of the button range', () => {
  assert.equal(playbackTempo(.25, -.2), .2);
  assert.equal(playbackTempo(4, .2), 4.8);
  assert.equal(playbackTempo(2, -.02), 1.96);
  for (const value of [NaN, Infinity, 0, .249, 4.001]) assert.throws(() => playbackTempo(value), RangeError);
});

test('the exact video window is inclusive, and its centre is derived from the requested limits', () => {
  assert.equal(VIDEO_SYNC_TARGET_MS, 40);
  for (const error of [-45, 0, 40, 125]) {
    const state = {};
    assert.equal(updateVideoTempoCorrection(state, error, 0, 1000 / 60), 0);
  }
  for (const [error, sign] of [[-45.001, 1], [125.001, -1]]) {
    const state = {};
    assert.ok(sign * updateVideoTempoCorrection(state, error, 0, 1000 / 60) > 0);
    updateVideoTempoCorrection(state, 40, 20, 1000 / 60);
    assert.equal(state.active, true, 'a breach enables feedback around the centre rather than toggling at the boundary');
  }
});

