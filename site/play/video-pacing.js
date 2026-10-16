/*! SPDX-License-Identifier: GPL-3.0-only */
import { videoLimit } from './playback-window.js';

/** Latch the newest eligible picture for the next display refresh, bounded by its raw deadline. */
export function createVideoFramePacer(present, {
  now = () => performance.timeOrigin + performance.now(),
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  schedule = setTimeout, cancel = clearTimeout, budget = () => 4,
} = {}) {
  let pending = null, animation = null, timer = null, epoch = null, mode = null;
  let dropped = 0, refreshes = 0, deadlines = 0;
  const cancelPending = () => {
    if (animation !== null) cancelFrame?.(animation);
    if (timer !== null) cancel(timer);
    animation = timer = null;
  };
  function flush(reason) {
    cancelPending();
    const next = pending; pending = null;
    if (!next) return;
    if (reason === 'refresh') refreshes++;
    else if (reason === 'deadline') deadlines++;
    present(next.frame, next.config, next.timing, next.outputWindow, reason);
  }
  return {
    present(frame, config, timing, outputWindow) {
      if (epoch !== config?.epoch || mode !== config?.mode) {
        cancelPending(); pending?.frame.close(); pending = null;
        epoch = config?.epoch; mode = config?.mode; dropped = refreshes = deadlines = 0;
      }
      if (pending) { pending.frame.close(); dropped++; }
      pending = { frame, config, timing, outputWindow };
      if (!requestFrame) { flush('immediate'); return; }
      // Keep upload/draw time inside the existing cap and the matching audio window.
      const deadline = Math.min(Number.isFinite(timing) ? timing + videoLimit(config?.mode) : Infinity,
        Number.isFinite(outputWindow?.latest) ? outputWindow.latest : Infinity);
      const wait = deadline - now() - Math.max(2, budget());
      if (wait <= 0) { flush('deadline'); return; }
      if (animation === null) {
        try { animation = requestFrame(() => { animation = null; flush('refresh'); }); }
        catch (_) { requestFrame = null; flush('immediate'); return; }
      }
      if (timer !== null) cancel(timer);
      timer = null;
      if (Number.isFinite(wait)) timer = schedule(() => { timer = null; flush('deadline'); }, wait);
    },
    reset() {
      cancelPending(); pending?.frame.close(); pending = null;
      epoch = mode = null; dropped = refreshes = deadlines = 0;
    },
    stats: () => ({ pacingMode: requestFrame ? 'display-refresh' : 'immediate', pacingDroppedFrames: dropped,
      pacingRefreshDraws: refreshes, pacingDeadlineDraws: deadlines }),
  };
}
