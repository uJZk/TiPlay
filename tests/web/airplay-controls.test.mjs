import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackState, playbackBuffering, applyDirectiveRate } from '../../site/play/airplay-controls.js';

test('receiver controls reject invalid IDs and normalize untrusted media times', () => {
  assert.equal(playbackState(null), null);
  assert.equal(playbackState({ id: 0 }), null);
  assert.equal(playbackState({ id: 1.2 }), null);
  assert.deepEqual(playbackState({ id: 1, duration: Infinity, position: NaN, seekable: true }),
    { id: 1, duration: 0, position: 0, seekable: false });
  assert.equal(playbackState({ id: 1, duration: 100, position: 120, seekable: true }).position, 100);
  assert.equal(playbackState({ id: 1, duration: 100, position: -1 }).position, 0);
});
test('ended and paused items do not report loading, but a paused pending seek does', () => {
  const media = { ended: true, paused: true, seeking: false, readyState: 2 };
  assert.equal(playbackBuffering(media, true), false);
  media.ended = false;
  assert.equal(playbackBuffering(media, true), false);
  media.seeking = true;
  assert.equal(playbackBuffering(media), true);
  media.seeking = false; media.paused = false;
  assert.equal(playbackBuffering(media), true);
  media.readyState = 3;
  assert.equal(playbackBuffering(media), false);
});

test('legacy APK pause/play preserves the selected 2x speed while explicit rate commands replace it', () => {
  let selectedRate = 2;
  const writes = [], media = {
    get playbackRate() { return selectedRate; },
    set playbackRate(value) { selectedRate = value; writes.push(value); },
  };
  const snapshots = [
    { id: 1, revision: 4, seekRevision: 2, duration: 100, position: 20, playing: false },
    { id: 1, revision: 5, seekRevision: 2, duration: 100, position: 20, playing: true },
  ];
  for (const snapshot of snapshots) {
    applyDirectiveRate(media, playbackState(snapshot));
    assert.equal(media.playbackRate, 2, 'play/pause from a rate-unaware APK cannot reset the browser speed');
  }
  assert.deepEqual(writes, [], 'legacy commands do not initiate an unnecessary rate renegotiation');
  applyDirectiveRate(media, { playing: false, rate: 0.75 }); assert.equal(media.playbackRate, 0.75);
  applyDirectiveRate(media, { playing: true, rate: 2 }); assert.equal(media.playbackRate, 2);
  assert.deepEqual(writes, [0.75, 2]);
});

test('unsupported sender speeds preserve VOD playback and live playback stays at normal speed', () => {
  const media = { playbackRate: 1.5, isLive: false };
  for (const rate of [.25, 4, NaN]) applyDirectiveRate(media, { rate });
  assert.equal(media.playbackRate, 1.5);
  media.isLive = true;
  applyDirectiveRate(media, { rate: 2 });
  assert.equal(media.playbackRate, 1);
});
