// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { videoLimit } from '../../site/play/playback-window.js';
import { createVideoFramePacer } from '../../site/play/video-pacing.js';

function harness() {
  let at = 1000, serial = 0;
  const callbacks = new Map(), timers = new Map(), drawn = [], frames = [];
  const pacer = createVideoFramePacer((frame, config, timing) => drawn.push({ frame, config, timing, at }), {
    now: () => at, budget: () => 4,
    requestFrame: callback => { const id = ++serial; callbacks.set(id, callback); return id; },
    cancelFrame: id => callbacks.delete(id),
    schedule: (callback, delay) => { const id = ++serial; timers.set(id, { callback, at: at + delay }); return id; },
    cancel: id => timers.delete(id),
  });
  return { pacer, drawn, frames, callbacks, timers,
    frame(name, timing = 1020, epoch = 1, outputWindow) {
      const frame = { name, closes: 0, close() { this.closes++; } }; frames.push(frame);
      pacer.present(frame, { epoch, mode: 'carplay' }, timing, outputWindow); return frame;
    },
    refresh(time) { at = time; for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(); } },
    advance(time) { at = time; for (const [id, timer] of [...timers]) if (timer.at <= at) { timers.delete(id); timer.callback(); } },
  };
}

test('decoded bursts latch the newest picture once per refresh and count superseded pictures', () => {
  const h = harness(), first = h.frame('first');
  h.frame('newest', 1021);
  assert.equal(h.drawn.length, 0);
  assert.equal(first.closes, 1);
  h.refresh(1015);
  assert.deepEqual(h.drawn.map(value => value.frame.name), ['newest']);
  assert.equal(h.pacer.stats().pacingDroppedFrames, 1);
  assert.equal(h.pacer.stats().pacingRefreshDraws, 1);
  assert.equal(h.timers.size, 0);
});

test('a late or throttled refresh cannot widen the raw cap or the audio window', () => {
  for (const latest of [undefined, 1010]) {
    const h = harness(); h.frame('bounded', 1020, 1, latest ? { latest } : undefined);
    h.advance((latest ?? (1020 + videoLimit('carplay'))) - 4);
    assert.equal(h.drawn.length, 1);
    assert.equal(h.drawn[0].at, (latest ?? (1020 + videoLimit('carplay'))) - 4);
    h.refresh(1030);
    assert.equal(h.drawn.length, 1, 'the cancelled callback cannot redraw a stale picture');
    assert.equal(h.pacer.stats().pacingDeadlineDraws, 1);
  }
});

test('epoch changes and shutdown release pending frames and cancel both callbacks', () => {
  const h = harness(), old = h.frame('old');
  const current = h.frame('current', 1020, 2);
  assert.equal(old.closes, 1);
  h.pacer.reset();
  assert.equal(current.closes, 1); assert.equal(h.callbacks.size, 0); assert.equal(h.timers.size, 0);
  h.refresh(1010); h.advance(1030); assert.equal(h.drawn.length, 0);
});

test('workers without an associated animation source submit immediately', () => {
  const frame = { close() { assert.fail('the presenter owns the frame'); } }, drawn = [];
  const pacer = createVideoFramePacer(value => drawn.push(value), {
    requestFrame() { throw new Error('NotSupportedError'); }, now: () => 1000,
  });
  pacer.present(frame, { epoch: 1, mode: 'carplay' }, 1020);
  assert.deepEqual(drawn, [frame]); assert.equal(pacer.stats().pacingMode, 'immediate');
});
