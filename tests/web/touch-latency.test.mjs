// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createControlOutbox, createTouchSlots, mapPoint } from '../../site/play/link.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const down = x => ({ k: 't', p: [[0, x, 0.5, 1]] });
const up = x => ({ k: 't', p: [[0, x, 0.5, 0]] });
function fixture(maxInFlight = 8) {
  const sends = [], statuses = [], errors = [];
  const outbox = createControlOutbox({ maxInFlight,
    send: (q, events) => new Promise((resolve, reject) => sends.push({ q, events, resolve, reject })),
    onStatus: status => statuses.push(status), onError: error => errors.push(error),
  });
  return { outbox, sends, statuses, errors };
}
function pageTouches(outbox) {
  const source = readFileSync(new URL('../../site/play/app.js', import.meta.url), 'utf8');
  const names = ['cancelMove', 'releaseTouches', 'setInteraction', 'pointerDown', 'pointerMove', 'pointerUp'];
  const functions = names.map(name => new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`).exec(source)[0]).join('\n');
  return new Function('outbox', 'createTouchSlots', 'mapPoint', 'queueMicrotask', `
    const slots = createTouchSlots(), live = true, config = { width: 100, height: 100 };
    const touch = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
    let movePending = false, moveGeneration = 0;
    const requestAnimationFrame = () => { throw new Error('touch must not wait for display refresh'); };
    ${functions}
    return { pointerDown, pointerMove, pointerUp, releaseTouches };
  `)(outbox, createTouchSlots, mapPoint, queueMicrotask);
}

test('pending heartbeat RTT does not block down, microtask move or up in RTC sequence order', async () => {
  const f = fixture(), page = pageTouches(f.outbox);
  f.outbox.heartbeat(); await settle();
  assert.equal(f.sends.length, 1);
  assert.equal(page.pointerDown(1, 10, 50), true);
  page.pointerMove(1, 20, 50);
  await settle();
  page.pointerUp(1); await settle();
  assert.deepEqual(f.sends.map(({ q, events }) => ({ q, events })), [
    { q: 1, events: [] }, { q: 2, events: [down(0.1)] },
    { q: 3, events: [down(0.2)] }, { q: 4, events: [up(0.2)] },
  ]);
  assert.equal(f.outbox.stats().inFlightCount, 4);
  f.sends[3].resolve({ revision: 4 }); await settle();
  f.sends[1].resolve({ revision: 2 }); f.sends[0].resolve({ revision: 1 }); f.sends[2].resolve({ revision: 3 }); await settle();
  assert.deepEqual(f.statuses, [{ revision: 4 }], 'late older responses cannot regress displayed status');
  assert.equal(f.outbox.stats().inFlightCount, 0); assert.equal(f.outbox.stats().inFlight, false);
  f.outbox.close();
});

test('up and new down cancel stale microtask moves without losing touch edge pairs', async () => {
  const f = fixture(), page = pageTouches(f.outbox);
  page.pointerDown(1, 10, 50);
  page.pointerMove(1, 20, 50);
  page.pointerUp(1);
  page.pointerDown(2, 30, 50);
  page.pointerMove(2, 40, 50);
  await settle();
  assert.deepEqual(f.sends.map(({ events }) => events), [[down(0.1)], [up(0.2)], [down(0.3)], [down(0.4)]]);
  page.releaseTouches(); await settle();
  assert.deepEqual(f.sends.at(-1).events, [up(0.4)]);
  f.outbox.close();
});

test('RTC concurrency stays bounded, coalesces unsent moves and preserves queued up/down order', async () => {
  const f = fixture(2);
  f.outbox.heartbeat(); f.outbox.push(down(0.1)); await settle();
  for (let i = 2; i <= 9; i++) f.outbox.push(down(i / 10), 'move');
  f.outbox.push(up(0.9)); f.outbox.push(down(0.2));
  await settle();
  assert.equal(f.sends.length, 2); assert.equal(f.outbox.stats().inFlightCount, 2);
  assert.equal(f.outbox.stats().pending, 3);
  f.sends[0].resolve({ revision: 1 }); await settle();
  assert.equal(f.sends.length, 3); assert.equal(f.outbox.stats().inFlightCount, 2);
  assert.deepEqual(f.sends[2].events, [down(0.9), up(0.9), down(0.2)]);
  assert.deepEqual(f.sends.map(({ q }) => q), [1, 2, 3]);
  f.outbox.close();
});

test('an older failed latest batch cannot replay over a newer already sent value', async () => {
  const f = fixture(2);
  f.outbox.push({ k: 'vp', w: 100 }, 'latest');
  f.outbox.push({ k: 'vp', w: 200 }, 'latest'); await settle();
  f.sends[1].resolve({ revision: 2 }); await settle();
  f.sends[0].reject(new Error('old response lost')); await settle();
  f.outbox.heartbeat(); await settle();
  assert.deepEqual(f.sends.at(-1).events, []);
  f.outbox.close();
});
