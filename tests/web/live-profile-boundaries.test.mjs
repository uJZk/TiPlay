// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaTiming } from '../../site/play/media-timing.js';
import { delayAt } from '../../site/play/delay-plan.js';

const EPSILON_MS = 2 ** -20;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('mirror readiness crosses its initial floor at 10ms while ordinary CarPlay adds its own 20ms margin', () => {
  for (const readiness of [10 - EPSILON_MS, 10, 10 + EPSILON_MS]) {
    const mirror = createMediaTiming(() => {}, () => 1000); mirror.mode('airplay-mirror');
    mirror.observe('video', 1000 - readiness);
    close(mirror.plan().to, readiness <= 10 ? 40 : 40 + EPSILON_MS);
    assert.equal(mirror.stats().policyTargetReason, readiness < 10 ? 'initial-floor' : 'readiness');
    const carplay = createMediaTiming(() => {}, () => 1000); carplay.mode('carplay');
    carplay.observe('video', 1000 - readiness);
    close(carplay.plan().to, readiness + 20);
  }
});

test('new readiness evidence decays a 100ms peak by 10ms/s for CarPlay and 5ms/s for mirror', () => {
  for (const [mode, margin, remaining] of [['carplay', 20, 90], ['airplay-mirror', 30, 95]]) {
    let at = 1000;
    const timing = createMediaTiming(() => {}, () => at); timing.mode(mode);
    timing.observe('video', 900); timing.observe('audio', 900); timing.started();
    const audio = timing.plan('audio');
    at = 2000; timing.observe('video', at);
    close(timing.stats().policyVideoReadinessMs, remaining);
    close(timing.plan().to, remaining + margin);
    assert.equal(timing.plan('audio'), audio, 'video readiness history cannot decay the independent audio timeline');
  }
});

test('the applied growth curve waits 85ms then adds exactly 80ms over four seconds in both live modes', () => {
  for (const [mode, initialReadiness, nextReadiness, firstTarget] of [
    ['carplay', 0, 80, 20], ['airplay-mirror', 10, 90, 40],
  ]) {
    let at = 1000;
    const timing = createMediaTiming(() => {}, () => at); timing.mode(mode);
    timing.observe('video', at - initialReadiness); timing.started();
    at = 1100; timing.observe('video', at - nextReadiness);
    const plan = timing.plan();
    close(plan.at, 1185); close(plan.duration, 4000); close(plan.to, firstTarget + 80);
    for (const [time, delay] of [[1185 - EPSILON_MS, firstTarget], [1185, firstTarget],
      [2185, firstTarget + 20], [3185, firstTarget + 40], [5185, firstTarget + 80]]) close(delayAt(plan, time), delay);
    // The source cursor progresses at 0.98x throughout the ramp, never backwards.
    close((3185 - delayAt(plan, 3185)) - (2185 - delayAt(plan, 2185)), 980);
  }
});

test('ordinary CarPlay and mirror decrease their applied delay at 20ms/s and 10ms/s respectively', () => {
  for (const [mode, firstTarget, nextTarget, midpoint] of [
    ['carplay', 120, 20, 70], ['airplay-mirror', 130, 80, 105],
  ]) {
    let at = 1000;
    const timing = createMediaTiming(() => {}, () => at); timing.mode(mode);
    timing.observe('video', 900); timing.started();
    at = 11000; timing.observe('video', at);
    const plan = timing.plan();
    close(plan.from, firstTarget); close(plan.to, nextTarget); close(plan.at, 11085); close(plan.duration, 5000);
    close(delayAt(plan, 13585), midpoint); close(delayAt(plan, 16085), nextTarget);
  }
});
