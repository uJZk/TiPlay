// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaTiming, createTimedFrames, createVideoEpochGuard } from '../../site/play/media-timing.js';
import { constantDelay, delayAt, planDelay, mediaDeadline } from '../../site/play/delay-plan.js';
import { audioDelayAt, videoExpired } from '../../site/play/playback-window.js';
import { PcmTimeline } from '../../site/play/pcm-timeline.js';

test('audio readiness never delays video and audio remains within its relative window', () => {
  let now = 1000;
  const changes = [], timing = createMediaTiming(value => changes.push(value), () => now);
  timing.observe('video', 950); assert.equal(timing.delay(), 70);
  const video = timing.plan();
  timing.observe('audio', 0); assert.equal(timing.plan(), video); assert.equal(timing.delay(), 70);
  assert.equal(timing.delay('audio'), 195);
  now = 1200; timing.observe('audio', 0); assert.equal(timing.plan(), video);
  assert.equal(timing.delay('audio'), 195);
  timing.reset(); assert.equal(timing.delay(), 60); assert.equal(timing.delay('audio'), 60);
  assert.ok(changes.length > 0);
});
test('a common ramp presents each video timestamp while continuous audio reaches the same source time', () => {
  let now = 1000, pending = null;
  const observed = [], frames = createTimedFrames((frame, _, __, source) => observed.push({ source, at: now }), {
    now: () => now, schedule: (callback, wait) => { pending = { callback, at: now + wait }; return callback; }, cancel: () => { pending = null; },
  });
  let plan = planDelay(constantDelay(60), 80, now);
  const audio = new PcmTimeline(8000, 1, () => {}, 2500);
  for (let i = 0; i < 8; i++) audio.push({ sourceTime: 900 + i * 250, sequence: i, pcm: new Int16Array(2000).fill(16384).buffer });
  const sources = [1050, 1200, 1350, 1500];
  frames.delay(plan);
  for (const source of sources) frames.present({ close() {} }, {}, 1, source);
  let previous = now - delayAt(plan, now), switched = false;
  while (now < 1700) {
    now += 0.125;
    if (!switched && now >= 1300) {
      const before = delayAt(plan, now); plan = planDelay(plan, 60, now); frames.delay(plan);
      assert.equal(delayAt(plan, now), before); switched = true;
    }
    const source = now - delayAt(plan, now), advance = source - previous;
    assert.ok(advance >= 0.125 * 0.98 - 0.000001 && advance <= 0.125 * 1.005 + 0.000001, 'audio has no backwards step or skipped chunk during either ramp');
    assert.equal(audio.sample(source, 0), 0.5, 'ramping never creates a silent hole in continuous PCM');
    previous = source;
    while (pending && pending.at <= now) pending.callback();
  }
  assert.deepEqual(observed.map(value => value.source), sources);
  for (const item of observed) {
    const expectedPlan = item.at < 1300 ? planDelay(constantDelay(60), 80, 1000) : plan;
    const audioSource = item.at - delayAt(expectedPlan, item.at);
    assert.ok(audioSource >= item.source && audioSource - item.source < 0.13, 'video uses the same advancing source clock as PCM');
  }
  const increasing = planDelay(constantDelay(60), 80, 1000);
  const due = mediaDeadline(1050, increasing, 1000);
  assert.ok(Math.abs(due - delayAt(increasing, due) - 1050) < 0.000001, 'timer solves the ramp deadline instead of using the old delay');
  frames.reset();
});

test('the first timestamp after fallback playback cannot jump the effective delay', () => {
  let now = 1000;
  const timing = createMediaTiming(() => {}, () => now);
  timing.started();
  timing.observe('audio', 800);
  assert.equal(timing.plan('audio').to, 185); assert.equal(timing.delay('audio'), 60); assert.equal(timing.delay(), 60);
  now = 1086; assert.ok(Math.abs(timing.delay('audio') - 60.02) < 0.000001);
});

test('CarPlay and AirPlay mirror use their own shared delay caps', () => {
  for (const [mode, limit] of [['carplay', 300], ['airplay-mirror', 200]]) {
    const changes = [], timing = createMediaTiming(plan => changes.push(plan), () => 1000);
    timing.mode(mode); timing.observe('audio', 0); timing.observe('video', 0);
    const target = mode === 'carplay' ? 0 : limit - 20;
    assert.equal(timing.limit(), limit); assert.equal(timing.delay(), target); assert.equal(timing.plan().to, target);
    assert.ok(changes.every(plans => plans.video.from >= 0 && plans.video.to >= 0 && plans.video.from <= limit && plans.video.to <= limit));
    const same = timing.plan(); timing.mode(mode); assert.equal(timing.plan(), same, 'same-mode codec/resize config preserves the common ramp');
  }
});

test('mode switches discard an old high delay plan without clearing independent audio queues', () => {
  let now = 1000;
  const timing = createMediaTiming(() => {}, () => now), audio = new PcmTimeline(8000, 1, () => {}, 2500);
  timing.mode('airplay-mirror'); timing.observe('video', 0); timing.observe('audio', 0);
  audio.push({ sourceTime: 1000, sequence: 0, pcm: new Int16Array(160).fill(16384).buffer });
  timing.mode('airplay-mirror'); assert.equal(timing.delay(), 180); assert.equal(timing.plan().previous, undefined);
  timing.mode('carplay'); assert.equal(timing.delay(), 0); assert.equal(timing.plan().previous, undefined);
  assert.equal(audio.sample(1000, 0), 0.5, 'policy owns no PCM queue and cannot clear newly arrived audio');
  now = 2000; timing.observe('video', 0); assert.equal(timing.plan().to, 0);
});

test('fallback video deadlines and decoded buffering fit the 500ms submission limit', () => {
  let now = 1000;
  const frames = createTimedFrames(frame => { frame.shown = true; }, { now: () => now, schedule: () => 1, cancel() {} });
  const plan = constantDelay(480), first = { close() { this.closed = true; } };
  assert.ok(Math.abs(mediaDeadline(1000, plan, now) - 1480) < 0.000001);
  frames.delay(plan); frames.present(first, {}, 1, 1000);
  for (let i = 1; i <= 30; i++) frames.present({ close() {} }, {}, 1, 1000 + i * 1000 / 60);
  assert.equal(first.closed, undefined, 'early frames cannot evict the first one before its deadline');
  now = 1480; frames.delay(plan); assert.equal(first.shown, true); frames.reset();
});

test('decoded video reorders by source time and shares the audio start deadline', () => {
  let now = 1040, pending = null;
  const shown = [], consumed = [];
  const frames = createTimedFrames(frame => shown.push(frame.timestamp), {
    now: () => now, schedule: callback => { pending = callback; return callback; }, cancel: () => { pending = null; },
  });
  const frame = timestamp => ({ timestamp, closed: false, close() { this.closed = true; } });
  const later = frame(1020), earlier = frame(1000);
  frames.present(later, {}, 1, 1020); frames.present(earlier, {}, 1, 1000);
  const audio = new PcmTimeline(8000, 1, bytes => consumed.push(bytes));
  audio.push({ sourceTime: 1000, sequence: 0, pcm: new Int16Array(160).fill(16384).buffer });
  assert.deepEqual(shown, []); assert.equal(audio.sample(now - 60, 0), 0);
  now = 1060; pending();
  assert.deepEqual(shown, [1000]); assert.equal(audio.sample(now - 60, 0), 0.5);
  now = 1080; pending(); assert.deepEqual(shown, [1000, 1020]);
  const stale = frame(1010); frames.present(stale, {}, 1, 1010); assert.equal(stale.closed, true);
  const queued = frame(1100); frames.present(queued, {}, 1, 1100); frames.reset(); assert.equal(queued.closed, true);
});

test('audio reorders, discards duplicates and late packets, and preserves gaps', () => {
  const consumed = [], audio = new PcmTimeline(8000, 1, bytes => consumed.push(bytes));
  const packet = (sourceTime, sequence, value = 16384) => ({ sourceTime, sequence, pcm: new Int16Array(80).fill(value).buffer });
  audio.push(packet(1030, 3)); audio.push(packet(1000, 1)); audio.push(packet(1000, 1));
  assert.equal(audio.queue.length, 2); assert.equal(consumed.length, 1);
  assert.equal(audio.sample(1000, 0), 0.5);
  assert.equal(audio.sample(1020, 0), 0, 'missing packet remains a ten millisecond gap');
  audio.push(packet(1010, 2)); assert.equal(audio.queue.length, 1, 'expired audio never shifts the next packet');
  assert.equal(audio.sample(1030, 0), 0.5);
  assert.equal(audio.sample(1025, 0), 0, 'a delay increase holds rather than replays audio');
  audio.clear(); assert.equal(audio.queue.length, 0);
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

test('buffered audio retains a two second burst while live audio remains bounded', () => {
  const buffered = new PcmTimeline(8000, 1, () => {}, 2500), live = new PcmTimeline(8000, 1, () => {});
  for (let i = 0; i < 100; i++) {
    const packet = { sourceTime: i * 20, sequence: i, pcm: new Int16Array(160).buffer };
    buffered.push(packet); live.push(packet);
  }
  assert.equal(buffered.queue.length, 100);
  assert.equal(live.queue.length, 50);
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

test('audio early and late limits follow matching video deadlines through frequent ramp changes', () => {
  let video = constantDelay(80);
  const history = [{ at: 0, video }];
  for (const [at, target] of [[1000, 120], [1050, 200], [1100, 80], [1150, 180], [1200, 70]]) {
    video = planDelay(video, target, at); history.push({ at, video });
  }
  const actualVideoDelay = wall => delayAt(history.filter(item => item.at <= wall).at(-1).video, wall);
  for (let wall = 1200; wall <= 1325; wall += 0.125) {
    for (const raw of [0, 1000]) {
      const plans = { video, audio: constantDelay(raw) }, source = wall - audioDelayAt(plans, wall);
      const deadline = mediaDeadline(source, video, wall - 126);
      const offset = wall - deadline;
      assert.ok(offset >= -25.000001 && offset <= 125.000001);
      if (raw === 1000) assert.ok(Math.abs(audioDelayAt(plans, wall) - (actualVideoDelay(wall - 125) + 125)) < 0.000001, 'late window uses actual historical video ramp');
    }
  }
});

test('video presents ready frames without slow audio and drops only raw cap violations', () => {
  let now = 1000;
  const shown = [], timing = createMediaTiming(() => {}, () => now);
  timing.mode('airplay-mirror'); timing.observe('video', 950); timing.observe('audio', 0);
  const frames = createTimedFrames(frame => shown.push(frame), { now: () => now, schedule: () => 1, cancel() {} });
  frames.delay(timing.plan());
  const ready = { close() { this.closed = true; } }, late = { close() { this.closed = true; } };
  frames.present(ready, { mode: 'airplay-mirror' }, 1, 950);
  now = 1020; frames.delay(timing.plan()); assert.deepEqual(shown, [ready], 'video uses its seventy millisecond deadline despite very late audio');
  now = 1400; frames.present(late, { mode: 'carplay' }, 1, 960); assert.equal(late.closed, true);
  assert.equal(frames.stats().scheduledExpiredFrames, 1);
  assert.equal(videoExpired(1000, 'carplay', 1000), false); assert.equal(videoExpired(1000, 'carplay', 1300.01), true);
  assert.equal(videoExpired(1000, 'airplay-mirror', 1200.01), true);
  frames.reset();
});

test('CarPlay buffers future frames in decoder output order and accepts its 300ms raw boundary', () => {
  let now = 1000, pending;
  const shown = [], frames = createTimedFrames(frame => shown.push(frame), {
    now: () => now, schedule: (callback, wait) => { pending = { callback, at: now + wait }; return callback; }, cancel() {},
  });
  frames.delay(constantDelay(0));
  const item = () => ({ close() { this.closed = true; } });
  const first = item(), second = item(), backwards = item();
  frames.present(first, { mode: 'carplay' }, 1, 1040);
  frames.present(second, { mode: 'carplay' }, 1, 1060);
  frames.present(backwards, { mode: 'carplay' }, 1, 1050);
  assert.equal(backwards.closed, true, 'WebCodecs output order is authoritative');
  assert.deepEqual(shown, []); now = pending.at; pending.callback(); assert.deepEqual(shown, [first]);
  now = pending.at; pending.callback(); assert.deepEqual(shown, [first, second]);
  frames.reset(); now = 1300;
  const boundary = item(); frames.present(boundary, { mode: 'carplay' }, 1, 1000);
  assert.equal(shown.at(-1), boundary);
  const expired = item(); frames.present(expired, { mode: 'carplay' }, 1, 999.99, { sourceTimeMs: 1001 });
  assert.equal(expired.closed, true);
  assert.equal(frames.stats().scheduledExpiredFrames, 1); frames.reset();
});

test('late readiness inside a raw cap is drawn despite missing the adaptive target', () => {
  const shown = [], frames = createTimedFrames(frame => shown.push(frame), { now: () => 1180, schedule: () => 1, cancel() {} });
  frames.delay(constantDelay(60));
  const frame = { close() { this.closed = true; } };
  frames.present(frame, { mode: 'airplay-mirror' }, 1, 1000);
  assert.deepEqual(shown, [frame]); assert.equal(frames.stats().scheduledExpiredFrames, 0);
  frames.reset();
});

test('zero-cap audio retains the 125ms late tolerance relative to early video submission', () => {
  const video = constantDelay(0), wall = 1000;
  for (const delay of [0, 1000]) {
    const source = wall - audioDelayAt({ video, audio: constantDelay(delay) }, wall);
    const submission = source - 20;
    const offset = wall - submission;
    assert.ok(offset >= -45 && offset <= 125);
    if (delay === 1000) assert.equal(offset, 125);
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
  assert.equal(items.filter(frame => frame.closes === 0).length, 20);
  const duplicate = { closes: 0, close() { this.closes++; } };
  frames.present(duplicate, { mode: 'carplay', epoch: 1 }, 1, 1599,
    { sourceTimeMs: 5099, clockGeneration: 1 });
  assert.equal(duplicate.closes, 1);
  now = 1600; frames.delay(constantDelay(0));
  assert.deepEqual(shown.map(frame => frame.n), [99], 'catch up to the newest due frame without moving its deadline');
  assert.ok(items.every(frame => frame.closes === 1));
  frames.reset(); assert.ok(items.every(frame => frame.closes === 1));
});
