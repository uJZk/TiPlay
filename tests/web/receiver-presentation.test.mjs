// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { carPlayRunning, airPlayContext, createReceiverNoticeTracker, videoProblemFor, videoReadyFor, videoSourceFor } from '../../site/play/receiver-presentation.js';

const status = (state, { carplay = 'connected', source = 'carplay', playback, revision } = {}) => ({
  videoSource: source, receivers: { carplay: { state: carplay }, airplay: { state, ...(revision === undefined ? {} : { revision }) } }, ...(playback ? { airplay: playback } : {}),
});

test('music UI yields to a connected CarPlay session, including a missing or loaned picture', () => {
  for (const state of ['connected', 'suspended']) {
    assert.equal(carPlayRunning({ videoSource: null, receivers: { carplay: { state } } }, null), true);
  }
  assert.equal(carPlayRunning({ videoSource: 'carplay' }, null), true);
  assert.equal(carPlayRunning({}, { mode: 'carplay' }), true, 'older receiver snapshots use the current producer');
  for (const state of ['disabled', 'idle', 'waiting', 'connecting', 'failed']) {
    assert.equal(carPlayRunning({ videoSource: null, receivers: { carplay: { state } } }, { mode: 'carplay' }), false,
      'an old configuration cannot restore a retired CarPlay session');
  }
});

test('explicit producer and no-producer snapshots supersede old configs, with missing-field compatibility only', () => {
  const old = { mode: 'airplay-mirror' };
  assert.equal(videoSourceFor({ videoSource: 'carplay' }, old), 'carplay');
  assert.equal(videoSourceFor({ videoSource: null }, old), null);
  assert.equal(videoSourceFor({ videoSource: 'unrecognized' }, old), null);
  assert.equal(videoSourceFor({}, old), 'airplay');
  assert.equal(videoSourceFor(null, { mode: 'carplay' }), 'carplay');
});

test('background receiver errors do not create a casting context or inherit old codec failures', () => {
  for (const state of ['permission', 'failed', 'discovery-failed', 'audio-failed', 'playback-failed']) {
    assert.equal(airPlayContext(status(state), { mode: 'airplay-mirror' }), false);
    const tracker = createReceiverNoticeTracker();
    assert.equal(tracker.observe(status(state), { mode: 'airplay-mirror' }).noticeId, null);
  }
  const old = { mode: 'carplay' };
  assert.equal(videoProblemFor(status('listening'), old, 'hvc1'), 'hvc1');
  assert.equal(videoProblemFor(status('video', { carplay: 'suspended' }), old, 'hvc1'), 'hvc1',
    'pending borrowing does not retire a codec problem on the authoritative CarPlay producer');
  for (const kind of ['video', 'photo']) {
    assert.equal(videoProblemFor(status('playing', { playback: { id: 2, kind, resource: 'opaque', outputAllowed: true } }), old, 'hvc1'), null);
  }
  assert.equal(videoProblemFor(status('listening', { source: null }), old, 'hvc1'), null);
});

test('background AirPlay audio cannot hide a decoder failure after the picture returns to CarPlay', () => {
  const current = { mode: 'carplay' };
  assert.equal(videoProblemFor(status('playing', { playback: { id: 2, kind: 'video', resource: 'opaque',
    outputAllowed: true, videoShown: false } }), current, 'hvc1'), 'hvc1');
  assert.equal(videoProblemFor(status('audio', { playback: { id: 3, kind: 'audio' } }), current, 'hvc1'), 'hvc1');
  assert.equal(videoProblemFor(status('audio', { carplay: 'idle', source: null,
    playback: { id: 3, kind: 'audio' } }), current, 'hvc1'), null);
});

test('old first-frame evidence cannot hide waiting surfaces for a new producer or ownership handoff', () => {
  assert.equal(videoReadyFor(status('listening'), { mode: 'carplay' }, true), true);
  assert.equal(videoReadyFor(status('loading', { carplay: 'suspended', source: null }), { mode: 'carplay' }, true), false);
  assert.equal(videoReadyFor(status('loading', { carplay: 'suspended' }), { mode: 'carplay' }, true), true,
    'a pending borrow is not an ownership grant; the actual CarPlay producer keeps its picture');
  assert.equal(videoReadyFor(status('listening'), { mode: 'airplay-mirror' }, true), false);
  assert.equal(videoReadyFor(status('mirror', { carplay: 'suspended', source: 'airplay' }), { mode: 'airplay-mirror' }, true), true);
  assert.equal(videoReadyFor(status('mirror', { carplay: 'suspended', source: 'airplay' }), { mode: 'airplay-mirror' }, false), false);
});

test('fault attribution includes immediate return cleanup and excludes subsequent background failures', () => {
  const tracker = createReceiverNoticeTracker();
  tracker.observe(status('loading', { carplay: 'suspended', source: null }), null);
  const failure = tracker.observe(status('playback-failed'), null);
  assert.equal(failure.noticeId, 'airplay:1');
  assert.equal(tracker.observe(status('playback-failed'), null).noticeId, null);
  tracker.observe(status('listening'), null);
  assert.equal(tracker.observe(status('discovery-failed'), null).noticeId, null);
});

test('same-attempt faults keep one identity and a new resource resets only its old notice', () => {
  const tracker = createReceiverNoticeTracker();
  const item = { id: 1, kind: 'video', resource: 'one' };
  tracker.observe(status('loading', { carplay: 'suspended', playback: item }), null);
  const first = tracker.observe(status('playback-failed', { carplay: 'suspended', playback: item }), null);
  for (let i = 0; i < 30; i++) assert.equal(tracker.observe(status('playback-failed', { carplay: 'suspended', playback: item }), null).noticeId, first.noticeId);
  assert.equal(tracker.observe(status('failed', { carplay: 'suspended', playback: item }), null).noticeId, first.noticeId,
    'a different receiver failure label in the same attempt cannot reopen the same generic explanation');
  tracker.observe(status('playback-failed', { carplay: 'suspended', playback: item }), null);
  const next = { ...item, id: 2, resource: 'two' };
  const stale = tracker.observe(status('playback-failed', { carplay: 'suspended', playback: next }), null);
  assert.equal(stale.resetId, first.noticeId);
  assert.equal(stale.noticeId, null, 'the old receiver fault does not belong to the replacement resource');
  assert.equal(tracker.observe(status('playback-failed', { carplay: 'suspended', playback: next }), null).noticeId, null,
    'repeating an old failure label without a publication revision cannot prove a new item failed');
  tracker.observe(status('loading', { carplay: 'suspended', playback: next }), null);
  const second = tracker.observe(status('playback-failed', { carplay: 'suspended', playback: next }), null);
  assert.ok(second.noticeId && second.noticeId !== first.noticeId);
  assert.doesNotMatch(second.noticeId, /one|two/);
});

test('an atomic publication revision distinguishes repeated old labels from a new same-label failure', () => {
  const tracker = createReceiverNoticeTracker();
  const item = { id: 1, kind: 'video', resource: 'one' };
  tracker.observe(status('loading', { carplay: 'suspended', playback: item, revision: 9 }), null);
  const first = tracker.observe(status('playback-failed', { carplay: 'suspended', playback: item, revision: 10 }), null);
  const replacement = { ...item, id: 2, resource: 'two' };
  const stale = status('playback-failed', { carplay: 'suspended', playback: replacement, revision: 10 });
  assert.equal(tracker.observe(stale, null).resetId, first.noticeId);
  for (let i = 0; i < 20; i++) {
    const repeated = tracker.observe(stale, null);
    assert.equal(repeated.noticeId, null); assert.equal(repeated.failure, false);
  }
  const second = tracker.observe(status('playback-failed', { carplay: 'suspended', playback: replacement, revision: 11 }), null);
  assert.ok(second.noticeId && second.noticeId !== first.noticeId);
  assert.equal(second.failure, true);
  tracker.reset();
  const restarted = tracker.observe(status('playback-failed', { carplay: 'suspended', playback: replacement, revision: 0 }), null);
  assert.ok(restarted.noticeId && restarted.noticeId !== second.noticeId, 'new authenticated connections accept restarted process revisions with a fresh notice identity');
});

test('a mirror epoch identifies a new casting attempt even when return and reborrow happen between polls', () => {
  const tracker = createReceiverNoticeTracker();
  const current = status('mirror', { carplay: 'suspended', source: 'airplay' });
  tracker.observe(current, { mode: 'airplay-mirror', epoch: 1 });
  const failed = status('failed', { carplay: 'suspended', source: 'airplay' });
  const first = tracker.observe(failed, { mode: 'airplay-mirror', epoch: 1 });
  const next = tracker.observe(current, { mode: 'airplay-mirror', epoch: 2 });
  assert.equal(next.resetId, first.noticeId);
  assert.notEqual(tracker.observe(failed, { mode: 'airplay-mirror', epoch: 2 }).noticeId, first.noticeId);
});
