// SPDX-License-Identifier: GPL-3.0-only
import { createRenderer } from './video.js';
import { letterbox } from './link.js';

/** Video.js keeps the media clock and audio; only the picture moves to this canvas. */
export function createVideoCanvas(video, container, onError) {
  const canvas = document.createElement('canvas');
  canvas.className = 'airplay-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  let renderer = createRenderer(canvas), callback = null, disposed = false, contextLost = false, lastFrame = null;
  const frameCallbacks = typeof video.requestVideoFrameCallback === 'function';

  function cancel() {
    if (callback === null) return;
    if (frameCallbacks) video.cancelVideoFrameCallback(callback);
    else cancelAnimationFrame(callback);
    callback = null;
  }
  function draw() {
    if (disposed || contextLost || video.readyState < 2 || video.seeking || !video.videoWidth || !video.videoHeight) return;
    const width = container.clientWidth, height = container.clientHeight;
    if (!width || !height) return;
    const box = letterbox(width, height, video.videoWidth, video.videoHeight);
    // Pass the native video source directly to the renderer; cap the buffer at the source resolution.
    const scale = Math.min(window.devicePixelRatio || 1, video.videoWidth / box.width);
    const targetWidth = Math.max(1, Math.round(width * scale)), targetHeight = Math.max(1, Math.round(height * scale));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth; canvas.height = targetHeight;
    }
    try {
      renderer.draw(video, letterbox(canvas.width, canvas.height, video.videoWidth, video.videoHeight));
    } catch (error) {
      dispose(); onError(error);
    }
  }
  function tick() {
    callback = null;
    if (disposed) return;
    if (frameCallbacks) draw();
    else {
      const frame = video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.currentTime;
      if (frame !== lastFrame) { lastFrame = frame; draw(); }
    }
    schedule();
  }
  function schedule() {
    if (disposed || contextLost || callback !== null || video.paused || video.ended || video.seeking) return;
    callback = frameCallbacks ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
  }
  function refresh() { lastFrame = null; draw(); schedule(); }
  function stop() { cancel(); draw(); }
  function reset() {
    cancel(); lastFrame = null;
    // Clear the previous source without changing the selected rendering context.
    canvas.width = canvas.width;
  }
  function lost(event) { event.preventDefault(); contextLost = true; cancel(); }
  function restored() {
    if (disposed) return;
    renderer.dispose?.(); renderer = createRenderer(canvas); contextLost = false; refresh();
  }
  const listeners = { loadeddata: refresh, seeked: refresh, resize: refresh, playing: refresh,
    pause: stop, ended: stop, seeking: cancel, waiting: cancel, emptied: reset, error: cancel };
  for (const [type, listener] of Object.entries(listeners)) video.addEventListener(type, listener);
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  const observer = new ResizeObserver(refresh);
  observer.observe(container);
  video.after(canvas);
  container.classList.add('airplay-canvas-mode');
  refresh();

  function dispose() {
    if (disposed) return;
    disposed = true; cancel(); observer.disconnect();
    for (const [type, listener] of Object.entries(listeners)) video.removeEventListener(type, listener);
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', restored);
    renderer.dispose?.(); canvas.remove();
    container.classList.remove('airplay-canvas-mode');
  }
  return { dispose };
}
