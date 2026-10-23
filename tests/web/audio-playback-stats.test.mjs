// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readAudioPlaybackStats } from '../../site/play/audio-playback-stats.js';

test('optional render statistics retain real zeroes and convert cumulative seconds to milliseconds without mutating the graph', () => {
  let resets = 0;
  const stats = { underrunEvents: 0, underrunDuration: 0, totalDuration: 0,
    resetLatency() { resets++; } };
  const context = { playbackStats: stats };
  assert.deepEqual(readAudioPlaybackStats(context), { renderStatsState: 'available',
    renderUnderrunEvents: 0, renderUnderrunDurationMs: 0, renderTotalDurationMs: 0 });
  Object.assign(stats, { underrunEvents: 7, underrunDuration: .000123456, totalDuration: 123.75 });
  const result = readAudioPlaybackStats(context);
  assert.equal(result.renderStatsState, 'available'); assert.equal(result.renderUnderrunEvents, 7);
  assert.ok(Math.abs(result.renderUnderrunDurationMs - .123456) < 1e-12);
  assert.equal(result.renderTotalDurationMs, 123750);
  assert.equal(resets, 0); assert.equal(stats.underrunDuration, .000123456);
});

test('missing, invalid and failing optional render APIs expose a state without fabricating zero counters', () => {
  for (const context of [undefined, null, {}, { playbackStats: undefined }, { playbackStats: null }])
    assert.deepEqual(readAudioPlaybackStats(context), { renderStatsState: 'unavailable' });
  const valid = { underrunEvents: 1, underrunDuration: .1, totalDuration: 10 };
  for (const key of Object.keys(valid)) for (const invalid of [undefined, null, NaN, Infinity, -Infinity, -1, '1', true, 1n, Symbol('x')])
    assert.deepEqual(readAudioPlaybackStats({ playbackStats: { ...valid, [key]: invalid } }),
      { renderStatsState: 'invalid' }, `${key} rejects ${String(invalid)}`);
  for (const events of [.5, Number.MAX_SAFE_INTEGER + 1])
    assert.deepEqual(readAudioPlaybackStats({ playbackStats: { ...valid, underrunEvents: events } }), { renderStatsState: 'invalid' });
  for (const key of ['underrunDuration', 'totalDuration']) for (const invalid of [Number.MAX_VALUE, 1e100, (Number.MAX_SAFE_INTEGER + 1) / 1000])
    assert.deepEqual(readAudioPlaybackStats({ playbackStats: { ...valid, [key]: invalid } }), { renderStatsState: 'invalid' });
  for (const key of ['playbackStats', 'underrunDuration', 'underrunEvents', 'totalDuration']) {
    const context = key === 'playbackStats' ? {} : { playbackStats: { ...valid } };
    Object.defineProperty(key === 'playbackStats' ? context : context.playbackStats, key,
      { get() { throw new Error('private error'); } });
    assert.deepEqual(readAudioPlaybackStats(context), { renderStatsState: 'failed' });
  }
});
