import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoCanvas } from '../../site/play/airplay-canvas.js';

function harness(t, { frameCallbacks = true } = {}) {
  const callbacks = new Map(), draws = [], classes = new Set();
  let next = 0, observed = null, disconnected = false, failDraw = false;
  const video = Object.assign(new EventTarget(), { readyState: 2, seeking: false, paused: false, ended: false,
    videoWidth: 320, videoHeight: 180, currentTime: 0, frames: 1,
    getVideoPlaybackQuality() { return { totalVideoFrames: this.frames }; },
    after(value) { this.canvas = value; },
  });
  const request = callback => { callbacks.set(++next, callback); return next; };
  const cancel = id => callbacks.delete(id);
  if (frameCallbacks) Object.assign(video, { requestVideoFrameCallback: request, cancelVideoFrameCallback: cancel });
  const canvas = Object.assign(new EventTarget(), { width: 300, height: 150, removed: false,
    setAttribute() {}, remove() { this.removed = true; },
    getContext(type) {
      if (type !== '2d') return null;
      return { fillRect() {}, drawImage(source, ...box) {
        if (failDraw) throw new Error('drawing failed');
        draws.push({ source, box, width: canvas.width, height: canvas.height });
      } };
    },
  });
  const container = { clientWidth: 800, clientHeight: 480,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value) } };
  const globals = { document: { createElement: () => canvas }, window: { devicePixelRatio: 2 },
    requestAnimationFrame: request, cancelAnimationFrame: cancel,
    ResizeObserver: class {
      constructor(callback) { observed = callback; }
      observe() {} disconnect() { disconnected = true; }
    } };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  return { video, canvas, container, callbacks, draws, classes,
    event: type => video.dispatchEvent(new Event(type)), resize: () => observed(),
    disconnected: () => disconnected, fail: () => { failDraw = true; },
    tick() { const [id, callback] = callbacks.entries().next().value; callbacks.delete(id); callback(); } };
}

test('URL canvas retains paused pictures, redraws seeks/resizes and cancels callbacks on disposal', t => {
  const h = harness(t);
  const picture = createVideoCanvas(h.video, h.container, assert.fail);
  assert.equal(h.callbacks.size, 1);
  assert.equal(h.draws[0].width, 320);
  assert.equal(h.draws[0].height, 192);
  assert.deepEqual(h.draws[0].box, [0, 6, 320, 180]);
  h.tick();
  assert.equal(h.callbacks.size, 1);
  h.video.paused = true; h.event('pause');
  assert.equal(h.callbacks.size, 0);
  h.video.seeking = true; h.event('seeking');
  const before = h.draws.length;
  h.resize(); assert.equal(h.draws.length, before);
  h.video.seeking = false; h.video.currentTime = 1; h.event('seeked');
  assert.equal(h.draws.length, before + 1);
  assert.equal(h.callbacks.size, 0);
  h.container.clientWidth = 160; h.container.clientHeight = 90; h.resize();
  assert.deepEqual(h.draws.at(-1).box, [0, 0, 320, 180]);
  h.video.paused = false; h.event('playing');
  const pending = [...h.callbacks.values()][0];
  picture.dispose(); picture.dispose();
  const final = h.draws.length;
  pending(); h.event('playing'); h.resize();
  assert.equal(h.draws.length, final);
  assert.equal(h.callbacks.size, 0);
  assert.equal(h.canvas.removed, true);
  assert.equal(h.disconnected(), true);
  assert.equal(h.classes.size, 0);
});

test('animation fallback skips duplicate frames, stops buffering and resumes with new video', t => {
  const h = harness(t, { frameCallbacks: false });
  const picture = createVideoCanvas(h.video, h.container, assert.fail);
  h.tick(); const before = h.draws.length;
  h.tick(); assert.equal(h.draws.length, before);
  h.video.frames++; h.tick(); assert.equal(h.draws.length, before + 1);
  h.event('waiting'); assert.equal(h.callbacks.size, 0);
  h.event('playing'); assert.equal(h.callbacks.size, 1);
  picture.dispose();
});

test('draw failures report once and tear down callbacks and observers', t => {
  const h = harness(t), failures = [];
  const picture = createVideoCanvas(h.video, h.container, error => failures.push(error.message));
  h.fail(); h.tick();
  h.event('seeked'); h.resize(); picture.dispose();
  assert.deepEqual(failures, ['drawing failed']);
  assert.equal(h.callbacks.size, 0);
  assert.equal(h.disconnected(), true);
});
