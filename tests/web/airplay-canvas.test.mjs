import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameCanvas } from '../../site/play/airplay-canvas.js';

function harness(t, { gpu = false } = {}) {
  const draws = [], classes = new Set(), contexts = [], glCalls = [], orientationDraws = [], samples = [];
  let observed = null, disconnected = false, failDraw = false, uploaded = null, viewport = null;
  const canvas = Object.assign(new EventTarget(), { width: 300, height: 150, removed: false,
    setAttribute() {}, remove() { this.removed = true; },
    getContext(type) {
      contexts.push(type);
      if (type === 'webgl2') return gpu ? gl : null;
      if (type !== '2d') return null;
      return { fillRect() {}, drawImage(source, ...box) {
        if (failDraw) throw new Error('drawing failed');
        draws.push({ source, box, width: canvas.width, height: canvas.height });
      } };
    },
  });
  const gl = { canvas, isContextLost: () => false };
  for (const name of ['createProgram', 'createShader', 'shaderSource', 'compileShader', 'attachShader', 'deleteShader',
    'linkProgram', 'useProgram', 'createBuffer', 'bindBuffer', 'bufferData', 'getAttribLocation', 'enableVertexAttribArray',
    'vertexAttribPointer', 'createTexture', 'bindTexture', 'texParameteri', 'clearColor', 'clear', 'deleteTexture',
    'deleteBuffer', 'deleteProgram']) gl[name] = () => { glCalls.push(name); return {}; };
  gl.texImage2D = (...args) => { uploaded = args.at(-1); };
  gl.viewport = (...box) => { viewport = box; };
  gl.drawArrays = () => { if (failDraw) throw new Error('drawing failed');
    draws.push({ source: uploaded, box: viewport, width: canvas.width, height: canvas.height }); };
  const container = { clientWidth: 800, clientHeight: 480, prepend(value) { this.canvas = value; },
    classList: { add: value => classes.add(value), remove: value => classes.delete(value) } };
  const globals = { document: { createElement: () => canvas }, devicePixelRatio: 2,
    OffscreenCanvas: class { constructor(width, height) { Object.assign(this, { width, height }); }
      getContext() { return {}; } },
    ResizeObserver: class { constructor(callback) { observed = callback; }
      observe() {} disconnect() { disconnected = true; } },
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  function sample(overrides = {}) {
    const result = { displayWidth: 320, displayHeight: 180, rotation: 0, flip: false, closed: 0, borrowed: [],
      close() { this.closed++; },
      toVideoFrame() { const frame = { closed: 0, close() { this.closed++; } }; this.borrowed.push(frame); return frame; },
      draw(...args) { orientationDraws.push(args); }, ...overrides };
    samples.push(result); return result;
  }
  return { canvas, container, draws, classes, contexts, glCalls, orientationDraws, samples, sample,
    resize: () => observed(), disconnected: () => disconnected, fail: () => { failDraw = true; } };
}

for (const gpu of [true, false]) test(`${gpu ? 'GPU' : '2D fallback'} retains decoded samples, letterboxes resize and releases owned resources`, t => {
  const h = harness(t, { gpu }), picture = createFrameCanvas(h.container, assert.fail);
  const first = h.sample(); picture.present(first);
  assert.equal(h.draws[0].width, 320); assert.equal(h.draws[0].height, 192);
  assert.deepEqual(h.draws[0].box, [0, 6, 320, 180]);
  assert.equal(h.contexts.includes('2d'), !gpu);
  h.resize(); assert.equal(h.draws.length, 2); assert.equal(first.closed, 0);
  h.container.clientWidth = 160; h.container.clientHeight = 90; h.resize();
  assert.deepEqual(h.draws.at(-1).box, [0, 0, 320, 180]);
  const second = h.sample(); picture.present(second); assert.equal(first.closed, 1);
  picture.clear(); assert.equal(second.closed, 1);
  const cleared = h.draws.length; h.resize(); assert.equal(h.draws.length, cleared);
  const last = h.sample(); picture.present(last); picture.dispose(); picture.dispose();
  assert.equal(last.closed, 1); assert.equal(h.disconnected(), true); assert.equal(h.canvas.removed, true);
  assert.equal(h.classes.size, 0);
  const final = h.draws.length; h.resize(); picture.redraw(); assert.equal(h.draws.length, final);
  const late = h.sample(); picture.present(late); assert.equal(late.closed, 1);
  assert.ok(h.samples.flatMap(sample => sample.borrowed).every(frame => frame.closed === 1));
  if (gpu) for (const name of ['deleteTexture', 'deleteBuffer', 'deleteProgram']) assert.equal(h.glCalls.filter(call => call === name).length, 1);
});

test('context restoration redraws the retained sample without taking a second media clock', t => {
  const h = harness(t, { gpu: true }), picture = createFrameCanvas(h.container, assert.fail), sample = h.sample();
  picture.present(sample);
  const lost = new Event('webglcontextlost', { cancelable: true }); h.canvas.dispatchEvent(lost);
  assert.equal(lost.defaultPrevented, true);
  const before = h.draws.length; h.resize(); picture.redraw(); assert.equal(h.draws.length, before);
  assert.equal(sample.closed, 0);
  h.canvas.dispatchEvent(new Event('webglcontextrestored')); assert.equal(h.draws.length, before + 1);
  assert.equal(sample.closed, 0); assert.ok(sample.borrowed.every(frame => frame.closed === 1));
  picture.dispose(); assert.equal(sample.closed, 1);
  const final = h.draws.length; h.canvas.dispatchEvent(new Event('webglcontextrestored')); assert.equal(h.draws.length, final);
});

test('rotated samples preserve orientation while retaining the GPU presenter', t => {
  const h = harness(t, { gpu: true }), picture = createFrameCanvas(h.container, assert.fail);
  const sample = h.sample({ displayWidth: 180, displayHeight: 320, rotation: 90 });
  picture.present(sample);
  assert.equal(h.orientationDraws.length, 1); assert.deepEqual(h.orientationDraws[0].slice(1), [0, 0, 180, 320]);
  assert.ok(h.draws[0].source instanceof OffscreenCanvas); assert.equal(sample.borrowed.length, 0);
  picture.dispose(); assert.equal(sample.closed, 1);
});

test('draw failures close the borrowed frame and retained sample and report once', t => {
  const h = harness(t), failures = [], picture = createFrameCanvas(h.container, error => failures.push(error.message));
  const sample = h.sample(); h.fail(); picture.present(sample);
  assert.deepEqual(failures, ['drawing failed']); assert.equal(sample.closed, 1);
  assert.equal(sample.borrowed[0].closed, 1); assert.equal(h.disconnected(), true);
  const late = h.sample(); picture.present(late); h.resize(); picture.dispose();
  assert.equal(late.closed, 1); assert.equal(failures.length, 1);
});
