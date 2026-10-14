// SPDX-License-Identifier: GPL-3.0-only
import { createRenderer } from './video.js';
import { letterbox } from './link.js';

/** Takes ownership of decoded Mediabunny samples, including the retained paused picture. */
export function createFrameCanvas(container, onError) {
  const canvas = document.createElement('canvas');
  canvas.className = 'airplay-canvas'; canvas.setAttribute('aria-hidden', 'true');
  let renderer = createRenderer(canvas), last = null, disposed = false, contextLost = false, oriented = null;
  function draw() {
    if (disposed || contextLost || !last || !container.clientWidth || !container.clientHeight) return;
    const width = last.displayWidth, height = last.displayHeight;
    const box = letterbox(container.clientWidth, container.clientHeight, width, height);
    const scale = Math.min(globalThis.devicePixelRatio || 1, width / box.width);
    const targetWidth = Math.max(1, Math.round(container.clientWidth * scale));
    const targetHeight = Math.max(1, Math.round(container.clientHeight * scale));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth; canvas.height = targetHeight;
    }
    const target = letterbox(canvas.width, canvas.height, width, height);
    try {
      if (last.rotation || last.flip) {
        // Keep the GPU presenter; materialize orientation only for samples that require a transform.
        oriented ||= typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
        if (oriented.width !== width) oriented.width = width;
        if (oriented.height !== height) oriented.height = height;
        last.draw(oriented.getContext('2d', { alpha: false }), 0, 0, width, height);
        renderer.draw(oriented, target);
      } else {
        const frame = last.toVideoFrame();
        try { renderer.draw(frame, target); } finally { frame.close(); }
      }
    } catch (error) { dispose(); onError(error); }
  }
  function lost(event) { event.preventDefault(); contextLost = true; }
  function restored() {
    if (disposed) return;
    renderer.dispose?.(); renderer = createRenderer(canvas); contextLost = false; draw();
  }
  canvas.addEventListener('webglcontextlost', lost); canvas.addEventListener('webglcontextrestored', restored);
  const observer = new ResizeObserver(draw); observer.observe(container);
  container.prepend(canvas); container.classList.add('airplay-canvas-mode');
  function clear() { last?.close(); last = null; canvas.width = canvas.width; }
  function dispose() {
    if (disposed) return;
    disposed = true; observer.disconnect(); clear(); renderer.dispose?.(); oriented = null;
    canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored);
    canvas.remove();
    container.classList.remove('airplay-canvas-mode');
  }
  return {
    canvas,
    present(sample) { if (disposed) { sample.close(); return; } const previous = last; last = sample; previous?.close(); draw(); },
    redraw: draw, clear, dispose,
  };
}
