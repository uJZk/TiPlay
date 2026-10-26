// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaTiming, createTimedFrames, createVideoEpochGuard } from '../../site/play/media-timing.js';
import { constantDelay, delayAt, planDelay, mediaDeadline, playbackProfile } from '../../site/play/delay-plan.js';
import { audioDelayAt, videoExpired } from '../../site/play/playback-window.js';

test('audio readiness and video readiness retain independent bounded plans', () => {
  let now = 1000;
  const timing = createMediaTiming(() => {}, () => now); timing.mode('carplay');
  timing.observe('video', 950); const video = timing.plan();
  timing.observe('audio', 0);
  assert.equal(timing.plan(), video); assert.equal(timing.delay(), 70);
  assert.equal(timing.delay('audio'), 280);
  const audio = timing.plan('audio'); now = 1200; timing.observe('video', 1190);
  assert.equal(timing.plan('audio'), audio);
  timing.reset(); assert.equal(timing.delay(), 60); assert.equal(timing.delay('audio'), 60);
});

test('the first timestamp after fallback playback cannot jump the effective delay', () => {
  let now = 1000;
  const timing = createMediaTiming(() => {}, () => now);
  timing.started();
  timing.observe('audio', 800);
  assert.equal(timing.plan('audio').to, 220); assert.equal(timing.delay('audio'), 60); assert.equal(timing.delay(), 60);
  now = 1086; assert.ok(Math.abs(timing.delay('audio') - 60.02) < 0.000001);
});

test('CarPlay and AirPlay mirror use their own shared delay caps', () => {
  for (const [mode, limit] of [['carplay', 300], ['airplay-mirror', 300], ['airplay-cast', 3000]]) {
    const changes = [], timing = createMediaTiming(plan => changes.push(plan), () => 1000);
    timing.mode(mode); timing.observe('audio', -10000); timing.observe('video', -10000);
    assert.equal(timing.limit(), limit); assert.equal(timing.delay(), Math.max(0, limit - 20)); assert.equal(timing.plan().to, Math.max(0, limit - 20));
    assert.ok(changes.every(plans => plans.video.from >= 0 && plans.video.to >= 0 && plans.video.from <= limit && plans.video.to <= limit));
    const same = timing.plan(); timing.mode(mode); assert.equal(timing.plan(), same, 'same-mode codec/resize config preserves the common ramp');
  }
});

test('fallback video deadlines and decoded buffering fit the 500ms submission limit', () => {
  let now = 1000;
  const frames = createTimedFrames(frame => { frame.shown = true; }, { now: () => now, schedule: () => 1, cancel() {} });
  const plan = constantDelay(480), first = { close() { this.closed = true; } };
  assert.ok(Math.abs(mediaDeadline(1000, plan, now) - 1480) < 0.000001);
  frames.delay(plan); frames.present(first, {}, 1, 1000);
  for (let i = 1; i <= 20; i++) frames.present({ close() {} }, {}, 1, 1000 + i * 1000 / 60);
  assert.equal(first.closed, undefined, 'early frames cannot evict the first one before its deadline');
  now = 1480; frames.delay(plan); assert.equal(first.shown, true); frames.reset();
});

test('late decoded video collapses to the newest due frame without presenting future frames', () => {
  let now = 1000;
  const shown = [], items = [];
  const frames = createTimedFrames(frame => shown.push(frame), { now: () => now, schedule: () => 1, cancel() {} });
  for (const timestamp of [1100, 1120, 1140]) {
    const frame = { close() { this.closed = true; } }; items.push(frame); frames.present(frame, {}, 1, timestamp);
  }
  now = 1190; frames.delay(constantDelay(60));
  assert.deepEqual(shown, [items[1]]); assert.equal(items[0].closed, true); assert.equal(items[2].closed, undefined);
  frames.reset(); assert.equal(items[2].closed, true);
});

test('local readiness observations update the plan before drawing and reset releases pending pictures', () => {
  const shown = [];
  const frames = createTimedFrames(frame => shown.push(frame), {
    now: () => 1100, schedule: () => 1, cancel() {},
    observe() { frames.delay(constantDelay(120)); assert.deepEqual(shown, []); },
  });
  const first = { close() { this.closed = true; } };
  frames.present(first, {}, 1, 1000);
  assert.deepEqual(shown, [], 'the synchronous observation establishes the pending frame target');
  frames.delay(constantDelay(60));
  assert.deepEqual(shown, [first]);
  frames.reset(); shown.length = 0;
  const second = { closes: 0, close() { this.closes++; } };
  frames.present(second, {}, 1, 1040);
  frames.reset(); frames.delay(constantDelay(60));
  assert.equal(second.closes, 1); assert.deepEqual(shown, []);
});

test('repeated video configuration preserves queued frames until the actual epoch changes', () => {
  const shown = [], item = () => ({ close() { this.closed = true; } });
  let now = 1000;
  const frames = createTimedFrames(frame => shown.push(frame), { now: () => now, schedule: () => 1, cancel() {} });
  const epochs = createVideoEpochGuard(frames.reset);
  epochs.message({ type: 'config', config: { epoch: 1 } });
  const retained = item(); frames.present(retained, {}, 1, 1100);
  epochs.message({ type: 'config', config: { epoch: 1 } });
  assert.equal(retained.closed, undefined);
  now = 1160; frames.delay(constantDelay(60)); assert.deepEqual(shown, [retained]);
  const obsolete = item(); frames.present(obsolete, {}, 1, 1200);
  epochs.message({ type: 'config', config: { epoch: 2 } }); assert.equal(obsolete.closed, true);
  const idle = item(); frames.present(idle, {}, 1, 1300);
  epochs.message({ type: 'idle' }); assert.equal(idle.closed, true);
});

test('frequent video ramp changes never alter audio source position', () => {
  const audio = planDelay(constantDelay(60), 90, 900);
  let video = constantDelay(80);
  for (const [at, target] of [[1000, 120], [1050, 200], [1100, 0], [1150, 180], [1200, 70]]) {
    video = planDelay(video, target, at);
    for (let wall = at; wall < at + 125; wall += 0.125) {
      assert.equal(audioDelayAt({ video, audio }, wall), delayAt(audio, wall));
    }
  }
});

test('video presents without slow audio and independently enforces the source cap', () => {
  let now = 1000;
  const shown = [], timing = createMediaTiming(() => {}, () => now);
  timing.mode('airplay-mirror'); timing.observe('video', 950); timing.observe('audio', 0);
  const frames = createTimedFrames(frame => shown.push(frame), { now: () => now, schedule: () => 1, cancel() {} });
  frames.delay(timing.plan());
  const ready = { close() { this.closed = true; } }, late = { close() { this.closed = true; } };
  frames.present(ready, { mode: 'airplay-mirror' }, 1, 950);
  now = 1030; frames.delay(timing.plan()); assert.deepEqual(shown, [ready]);
  now = 1400; frames.present(late, { mode: 'carplay' }, 1, 960); assert.equal(late.closed, true);
  assert.equal(frames.stats().scheduledExpiredFrames, 1);
  assert.equal(videoExpired(1000, 'carplay', 1300), false);
  assert.equal(videoExpired(1000, 'carplay', 1300.01), true);
  frames.reset();
});

test('CarPlay preserves WebCodecs output order and reserves draw time inside its independent ceiling', () => {
  let now = 1000, pending = null;
  const shown = [], frames = createTimedFrames((frame, _, __, source) => shown.push({ frame, source, at: now }), {
    now: () => now, schedule: (callback, wait) => { pending = { callback, at: now + wait }; return callback; }, cancel: () => { pending = null; },
  });
  const item = () => ({ close() { this.closed = true; } });
  frames.delay(constantDelay(0));
  const later = item(), earlier = item(), duplicate = item();
  frames.present(later, { mode: 'carplay' }, 1, 1060);
  frames.present(earlier, { mode: 'carplay' }, 1, 1040);
  frames.present(duplicate, { mode: 'carplay' }, 1, 1040);
  assert.equal(earlier.closed, true); assert.equal(duplicate.closed, true); assert.deepEqual(shown, []);
  assert.equal(frames.stats().scheduledDroppedFrames, 2);
  assert.equal(frames.stats().scheduledStaleFrames, 2);
  assert.ok(Math.abs(pending.at - 1040) < 0.000001);
  now = pending.at; pending.callback(); assert.equal(shown[0].frame, later); assert.equal(shown[0].at, 1040);
  now = 1100; const boundary = item(); frames.present(boundary, { mode: 'carplay' }, 1, 1100);
  assert.equal(shown.at(-1).frame, boundary, 'readiness at the upper bound still permits immediate submission');
  const late = item(); frames.present(late, { mode: 'carplay' }, 1, 1100.001);
  now = 1100.01; frames.delay(constantDelay(0));
  assert.equal(late.closed, undefined, 'a future frame inside the draw reservation may already be submitted');
  now = 1500; const expired = item(); frames.present(expired, { mode: 'carplay' }, 1, 1100.005);
  assert.equal(expired.closed, true); assert.equal(frames.stats().scheduledExpiredFrames, 1);
  assert.equal(frames.stats().scheduledDroppedFrames, 3);
  assert.equal(frames.stats().videoCeilingViolations, 1);
  frames.reset();
  assert.equal(frames.stats().scheduledDroppedFrames, 0, 'epoch reset excludes normal teardown');
});

test('late readiness inside a raw cap is drawn despite missing the adaptive target', () => {
  const shown = [], frames = createTimedFrames(frame => shown.push(frame), { now: () => 1180, schedule: () => 1, cancel() {} });
  frames.delay(constantDelay(60));
  const frame = { close() { this.closed = true; } };
  frames.present(frame, { mode: 'airplay-mirror' }, 1, 1000);
  assert.deepEqual(shown, [frame]); assert.equal(frames.stats().scheduledExpiredFrames, 0);
  frames.reset();
});

test('touch convergence is continuous, bounded and leaves every audio sample on its original timeline', () => {
  let now = 1000;
  const timing = createMediaTiming(() => {}, () => now); timing.mode('carplay');
  timing.observe('video', 900); timing.observe('audio', 880); timing.started();
  const audio = timing.plan('audio'), before = timing.delay();
  timing.interaction(true); const convergence = timing.plan();
  assert.equal(timing.delay(), before); assert.equal(convergence.to, 0);
  assert.equal(timing.profile().name, 'carplay-touch');
  for (let step = 0; step < 12; step++) {
    now += 20; timing.interaction(true);
    assert.equal(timing.plan(), convergence, 'moves extend activity without restarting the curve');
    assert.equal(timing.plan('audio'), audio);
    assert.equal(timing.delay('audio'), delayAt(audio, now));
  }
  timing.interaction(false); const released = timing.plan();
  now += 751; assert.equal(timing.profile().name, 'carplay'); assert.equal(timing.plan(), released);
  now += convergence.duration; assert.equal(timing.delay(), 0, 'release does not restore accumulated delay');
  timing.observe('video', now + 10); assert.equal(timing.plan().to, 20, 'fresh readiness cannot revive the pre-touch backlog estimate');
  assert.equal(timing.plan('audio'), audio);
  let previous = delayAt(convergence, convergence.at);
  for (let at = convergence.at + 1; at <= convergence.at + convergence.duration; at++) {
    const next = delayAt(convergence, at); assert.ok(previous - next <= 0.25001); previous = next;
  }
});

test('a decoded burst bounds retained pictures and closes duplicate, evicted and expired frames once', () => {
  let now = 1000;
  const items = [], shown = [];
  const frames = createTimedFrames(frame => { shown.push(frame); frame.close(); }, {
    now: () => now, schedule: () => 1, cancel() {},
  });
  frames.delay(constantDelay(0));
  for (let n = 0; n < 100; n++) {
    const frame = { n, closes: 0, close() { this.closes++; } }; items.push(frame);
    frames.present(frame, { mode: 'carplay', epoch: 1 }, 1, 1500 + n,
      { sourceTimeMs: 5000 + n, clockGeneration: 1 });
  }
  assert.equal(items.filter(frame => frame.closes === 0).length, playbackProfile('carplay').maxVideoFrames);
  const duplicate = { closes: 0, close() { this.closes++; } };
  frames.present(duplicate, { mode: 'carplay', epoch: 1 }, 1, 1599,
    { sourceTimeMs: 5099, clockGeneration: 1 });
  assert.equal(duplicate.closes, 1);
  now = 1580; frames.delay(constantDelay(0));
  assert.deepEqual(shown.map(frame => frame.n), [99], 'catch up to the newest due frame without moving its deadline');
  assert.ok(items.every(frame => frame.closes === 1));
  frames.reset(); assert.ok(items.every(frame => frame.closes === 1));
});

test('decoded surfaces are bounded by bytes as well as frame count', () => {
  const frames = createTimedFrames(frame => frame.close(), { now: () => 0, schedule: () => 1, cancel() {} });
  const pictures = [];
  for (let n = 0; n < 20; n++) {
    const frame = { codedWidth: 3840, codedHeight: 2160, closes: 0, close() { this.closes++; } }; pictures.push(frame);
    frames.present(frame, { mode: 'carplay' }, 1, 5000 + n);
    assert.ok(frames.stats().decodedQueueBytes <= playbackProfile('carplay').maxVideoBytes);
  }
  assert.equal(frames.stats().decodedQueueFrames, 2);
  assert.equal(frames.stats().decodedResourceDroppedFrames, 18);
  frames.reset(); assert.ok(pictures.every(frame => frame.closes === 1));
});


test('scheduler diagnostics separate source cadence, coalescing and resource limits without adding subsets to drops', () => {
  let now = 1000, pending;
  const shown = [], frames = createTimedFrames(frame => shown.push(frame), { now: () => now,
    schedule: callback => { pending = callback; return callback; }, cancel() {} });
  frames.delay({ ...constantDelay(100), playbackProfile: 'carplay-touch' });
  const picture = () => ({ displayWidth: 100, displayHeight: 100, close() { this.closed = true; } });
  const first = picture(), second = picture();
  frames.present(first, { mode: 'carplay', stageTiming: { decodedAtMs: 990 } }, 1, 1000);
  frames.present(second, { mode: 'carplay', stageTiming: { decodedAtMs: 995 } }, 1, 1010);
  now = 1110; pending();
  assert.deepEqual(shown, [second]); assert.equal(first.closed, true);
  const stats = frames.stats();
  assert.equal(stats.scheduledCoalescedFrames, 1); assert.equal(stats.touchSkippedFrames, 1);
  assert.equal(stats.scheduledDroppedFrames, 1); assert.equal(stats.scheduledCapacityFrames, 0);
  assert.equal(stats.decodedToSchedulerMsP95, 115); assert.equal(stats.decodedFrontierDeltaMs, 100);
  frames.reset(); assert.equal(frames.stats().touchSkippedFrames, 0); assert.equal(frames.stats().decodedQueueBytes, 0);
});
