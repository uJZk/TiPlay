import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackState } from '../../site/play/airplay-controls.js';

test('receiver controls reject invalid IDs and normalize untrusted media times', () => {
  assert.equal(playbackState(null), null);
  assert.equal(playbackState({ id: 0 }), null);
  assert.equal(playbackState({ id: 1.2 }), null);
  assert.deepEqual(playbackState({ id: 1, duration: Infinity, position: NaN, seekable: true }),
    { id: 1, duration: 0, position: 0, seekable: false });
  assert.equal(playbackState({ id: 1, duration: 100, position: 120, seekable: true }).position, 100);
  assert.equal(playbackState({ id: 1, duration: 100, position: -1 }).position, 0);
});
