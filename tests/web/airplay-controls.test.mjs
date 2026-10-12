import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackState, timeLabel } from '../../site/play/airplay-controls.js';

test('receiver controls reject invalid IDs and normalize untrusted media times', () => {
  assert.equal(playbackState(null), null);
  assert.equal(playbackState({ id: 0 }), null);
  assert.equal(playbackState({ id: 1.2 }), null);
  assert.deepEqual(playbackState({ id: 1, duration: Infinity, position: NaN, seekable: true }),
    { id: 1, duration: 0, position: 0, seekable: false });
  assert.equal(playbackState({ id: 1, duration: 100, position: 120, seekable: true }).position, 100);
  assert.equal(playbackState({ id: 1, duration: 100, position: -1 }).position, 0);
});

test('time labels handle hours and unknown duration without clock wraparound', () => {
  assert.equal(timeLabel(3661.9), '61:01');
  assert.equal(timeLabel(NaN), '0:00');
  assert.equal(timeLabel(-3), '0:00');
});
