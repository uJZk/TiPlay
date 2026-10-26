// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFramePresenter } from '../../site/play/video.js';

const frame = (id = 0) => ({ id, displayWidth: 800, displayHeight: 480, closed: 0, close() { this.closed++; } });
function canvas2d() {
  const draws = [], canvas = { width: 800, height: 480, removeEventListener() {},
    getContext: name => name === '2d' ? context : null };
  const context = { fillRect() {}, drawImage(...args) { draws.push(args); if (context.fail) throw Error('draw failed'); } };
  return { canvas, context, draws };
}

test('Canvas presenter owns replaced, retained and rejected frames without decoding or scheduling them', () => {
  const { canvas, context } = canvas2d(), presenter = createFramePresenter(canvas);
  const first = frame(1), second = frame(2), failed = frame(3);
  presenter.present(first); presenter.present(second);
  assert.equal(first.closed, 1); assert.equal(second.closed, 0);
  context.fail = true;
  assert.throws(() => presenter.present(failed), /draw failed/);
  assert.equal(failed.closed, 1); assert.equal(presenter.stats().drawnFrames, 2);
  assert.equal(presenter.stats().renderDroppedFrames, 1);
  presenter.close(); assert.equal(second.closed, 1);
  presenter.dispose(); assert.equal(second.closed, 1);
});

test('letterboxing follows negotiated source dimensions and resize redraws the retained frame without another source submission', () => {
  const { canvas, draws } = canvas2d(), presenter = createFramePresenter(canvas), picture = frame();
  presenter.present(picture, { streamId: 1, epoch: 1, width: 1600, height: 900 });
  assert.deepEqual(draws[0], [picture, 0, 15, 800, 450]);
  presenter.resize(1600, 900);
  assert.deepEqual(draws[1], [picture, 0, 0, 1600, 900]);
  assert.equal(presenter.stats().drawnFrames, 1);
  presenter.resize(1600, 900); assert.equal(draws.length, 2);
  presenter.dispose(); assert.equal(picture.closed, 1);
});

test('first-frame proof requires successful Canvas submission and resets with the presentation owner', () => {
  const { canvas, context } = canvas2d(), proofs = [], presented = [];
  const presenter = createFramePresenter(canvas, { onFirstPresent: value => proofs.push(value), onPresent: value => presented.push(value) });
  const config = { streamId: 42, epoch: 7 };
  context.fail = true;
  assert.throws(() => presenter.present(frame(), config), /draw failed/); assert.equal(proofs.length, 0);
  context.fail = false;
  presenter.present(frame(1), config); presenter.present(frame(2), config);
  assert.equal(proofs.length, 1); assert.equal(presented.length, 2);
  assert.equal(presented[0].timing, null, 'native presentation has no application source-clock deadline');
  presenter.close(); presenter.present(frame(3), config);
  assert.equal(proofs.length, 2);
  presenter.present(frame(4), { ...config, epoch: 8 });
  assert.equal(proofs.length, 3); assert.equal(presenter.stats().drawnFrames, 1);
  presenter.dispose();
});

test('WebGL context loss cannot prove a frame drawn and restoration preserves frame ownership', () => {
  let lost = false;
  const calls = [], events = new Map(), proofs = [];
  const canvas = { width: 800, height: 480, addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: name => events.delete(name), getContext: name => name.startsWith('webgl') ? gl : null };
  const gl = new Proxy({ canvas, isContextLost: () => lost }, { get(target, name) {
    if (name in target) return target[name];
    if (/^[A-Z_]+$/.test(name)) return name;
    return () => { calls.push(name); return name.startsWith('create') ? {} : 0; };
  } });
  const presenter = createFramePresenter(canvas, { onFirstPresent: config => proofs.push(config) });
  const retained = frame(), rejected = frame(1);
  presenter.present(retained, { streamId: 1, epoch: 1 });
  assert.equal(calls.filter(name => name === 'drawArrays').length, 1);
  lost = true; presenter.present(rejected, { streamId: 1, epoch: 2 });
  assert.equal(rejected.closed, 1); assert.equal(proofs.length, 1);
  let prevented = false; events.get('webglcontextlost')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  lost = false; events.get('webglcontextrestored')();
  assert.equal(retained.closed, 0); assert.equal(calls.filter(name => name === 'drawArrays').length, 2);
  presenter.dispose(); assert.equal(retained.closed, 1); assert.equal(events.size, 0);
  assert.equal(calls.filter(name => name === 'deleteTexture').length, 2);
});
