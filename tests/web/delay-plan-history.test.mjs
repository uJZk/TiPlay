// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { constantDelay, delayAt, mediaDeadline, planDelay, DELAY_PLAN_LEAD_MS } from '../../site/play/delay-plan.js';
import { audioDelayAt } from '../../site/play/playback-window.js';

const depth = plan => { let count = 0; for (; plan; plan = plan.previous) count++; return count; };
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7,
  `${message}: ${actual} != ${expected}`);

// Keep an unpruned activation log as the oracle. Binary search selects the
// applicable absolute-clock segment independently of production linked-history pruning.
function activationLog(initial) {
  const entries = [{ ...constantDelay(initial), at: -Infinity }];
  const valueAt = time => {
    let low = 0, high = entries.length;
    while (low + 1 < high) {
      const middle = (low + high) >> 1;
      if (entries[middle].at <= time) low = middle; else high = middle;
    }
    const segment = entries[low];
    if (!segment.duration) return segment.to;
    const x = Math.max(0, Math.min(1, (time - segment.at) / segment.duration));
    const amount = segment.smooth ? x ** 3 * (10 - 15 * x + 6 * x ** 2) : x;
    return segment.from + (segment.to - segment.from) * amount;
  };
  return { valueAt, add(target, now, { leadMs = DELAY_PLAN_LEAD_MS, increaseRate = .02,
    decreaseRate = .005, smooth = false } = {}) {
    const at = now + leadMs, from = valueAt(at);
    // An earlier plan supersedes older activations that were still
    // waiting for their lead time. Keep the oracle as a chronological log.
    while (entries.at(-1).at >= at) entries.pop();
    entries.push({ at, from, to: target, smooth,
      duration: Math.abs(target - from) / (target > from ? increaseRate : decreaseRate) * (smooth ? 1.875 : 1) });
  } };
}

test('the 125 ms history boundary retains only activations newer than the cutoff', () => {
  const first = planDelay(constantDelay(60), 180, 1000);
  for (const offset of [-.001, 0, .001]) {
    const now = first.at + 125 + offset;
    const next = planDelay(first, 0, now);
    assert.equal(depth(next), offset < 0 ? 3 : 2,
      'an activation exactly at the cutoff no longer needs its predecessor');
    for (const time of [now - 125, now - 124.999, now, next.at - .001, next.at]) {
      close(delayAt(next, time), delayAt(first, time), 'retained mapping is continuous through activation');
    }
    assert.equal(first.previous.to, 60, 'pruning copies history rather than mutating a previously delivered plan');
  }
});

test('frequent target changes keep the recent source clock and deadline inverse exact with bounded history', () => {
  for (const interval of [1, 5, 1000 / 60]) {
    let plan = constantDelay(60), maximumDepth = 0;
    const oracle = activationLog(60);
    const updates = Math.ceil(60000 / interval);
    for (let index = 0; index < updates; index++) {
      const now = 1000 + index * interval;
      const target = [0, 280, 20, 170, 40, 250, 60][index % 7];
      const options = { smooth: index % 3 === 0, leadMs: index % 3 === 0 ? 0 : DELAY_PLAN_LEAD_MS,
        decreaseRate: index % 3 === 0 ? .25 : .005 };
      const before = delayAt(plan, now);
      plan = planDelay(plan, target, now, options);
      oracle.add(target, now, options);
      close(delayAt(plan, now), before, 'receiving a future plan does not step the current cursor');
      for (const time of [now - 125, now - 124.999, now, now + 40, now + DELAY_PLAN_LEAD_MS]) {
        close(delayAt(plan, time), oracle.valueAt(time), 'pruned timeline matches its full activation log');
      }
      maximumDepth = Math.max(maximumDepth, depth(plan));
      assert.ok(depth(plan) <= Math.ceil((125 + DELAY_PLAN_LEAD_MS) / interval) + 2,
        'retained depth depends on the recent time window, not elapsed session length');
      if (index % 53 === 0) {
        const source = now + 100 - oracle.valueAt(now + 100);
        const due = mediaDeadline(source, plan, now);
        close(due - oracle.valueAt(due), source, 'inverse deadline remains on the same recent source clock');
      }
    }
    assert.ok(maximumDepth > 2, 'exercise a genuine linked history before checking pruning');
  }
});

test('long video histories cannot alter independently delivered audio plans or their source cursor', () => {
  const audio = planDelay(constantDelay(70), 170, 900);
  let video = constantDelay(80);
  for (let index = 0; index < 10000; index++) {
    const now = 1000 + index;
    video = planDelay(video, index % 2 ? 0 : 280, now,
      { smooth: index % 2 === 1, decreaseRate: .25 });
    for (const time of [now - 125, now, now + 85]) {
      assert.equal(audioDelayAt({ audio, video }, time), delayAt(audio, time));
    }
  }
  assert.equal(audio.previous.to, 70);
  assert.equal(depth(audio), 2);
});

test('ten thousand same-clock updates discard superseded activations without changing prior delivered plans', () => {
  for (const lead of [0, DELAY_PLAN_LEAD_MS, 'alternating']) {
    let plan = constantDelay(60);
    const oracle = activationLog(60), delivered = [];
    for (let index = 0; index < 10000; index++) {
      const now = 1000;
      const options = { leadMs: lead === 'alternating' ? (index % 2 ? 0 : DELAY_PLAN_LEAD_MS) : lead,
        smooth: index % 2 === 1, decreaseRate: .25 };
      const target = [0, 60, 170, 280][index % 4];
      plan = planDelay(plan, target, now, options);
      oracle.add(target, now, options);
      assert.ok(depth(plan) <= 3, 'one clock tick needs only its active segment and pending activation');
      for (const time of [now - 125, now, plan.at - .001, plan.at, plan.at + .001, now + 200]) {
        close(delayAt(plan, time), oracle.valueAt(time), 'compaction preserves the absolute-clock mapping');
      }
      if (index % 1000 === 0) {
        delivered.push({ plan, snapshot: structuredClone(plan) });
        const source = now + 100 - oracle.valueAt(now + 100);
        const due = mediaDeadline(source, plan, now);
        close(due - oracle.valueAt(due), source, 'burst compaction preserves deadline inversion');
      }
    }
    assert.doesNotThrow(() => structuredClone(plan), 'the final plan remains transferable to the worklet');
    for (const old of delivered) assert.deepEqual(old.plan, old.snapshot,
      'a new plan cannot mutate any object already delivered to an execution context');
  }
});

test('coarsened clock ticks retain recent history while touch replaces unstarted future plans', () => {
  let plan = constantDelay(60);
  const oracle = activationLog(60);
  for (let tick = 0; tick < 300; tick++) {
    const now = 1000 + tick * 2;
    for (let burst = 0; burst < 100; burst++) {
      const options = { leadMs: burst % 7 === 0 ? 0 : DELAY_PLAN_LEAD_MS,
        smooth: burst % 7 === 0, decreaseRate: .25 };
      const target = [0, 280, 60, 170][(tick + burst) % 4];
      plan = planDelay(plan, target, now, options);
      oracle.add(target, now, options);
      assert.ok(depth(plan) <= Math.ceil((125 + DELAY_PLAN_LEAD_MS) / 2) + 3,
        'burst count does not multiply the retained history for a coarsened clock');
      for (const time of [now - 125, now - .001, now, now + 40, now + 85]) {
        close(delayAt(plan, time), oracle.valueAt(time), 'active and superseded future segments agree with the activation log');
      }
    }
  }
});
