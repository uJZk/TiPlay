/*! SPDX-License-Identifier: GPL-3.0-only
 * Bounded worker transports. Encoded bytes use pull credits; decoded pictures keep the latest pending frame. */
import { abortable } from './link.js';

export const MAX_CHUNK_BYTES = 64 * 1024;

/** The worker requests one chunk only when its record reader needs bytes. */
export function createChunkStream(port) {
  let pending = null;
  const settle = () => { pending?.(); pending = null; };
  return new ReadableStream({
    start(controller) {
      port.onmessage = ({ data }) => {
        if (data.chunk) controller.enqueue(data.chunk);
        else {
          if (data.error) controller.error(new Error(data.error));
          else controller.close();
          port.close();
        }
        settle();
      };
      port.start();
    },
    pull() {
      return new Promise(resolve => {
        pending = resolve;
        port.postMessage({ pull: true });
      });
    },
    cancel() {
      port.postMessage({ cancel: true });
      port.close();
      settle();
    },
  }, { highWaterMark: 0 });
}

/** A single credit permits one bounded transfer; no encoded frame/config bytes are dropped. */
export async function pumpChunkStream(body, port, signal) {
  const reader = body.getReader(), cancelled = new AbortController();
  let credit = null, available = false;
  const stop = () => {
    cancelled.abort();
    reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  port.onmessage = ({ data }) => {
    if (data.cancel) stop();
    else if (data.pull) {
      available = true;
      credit?.();
      credit = null;
    }
  };
  port.start();
  let value = null, offset = 0;
  try {
    for (;;) {
      if (!available) await abortable(new Promise(resolve => { credit = resolve; }), cancelled.signal);
      if (cancelled.signal.aborted) throw new Error('stopped');
      available = false;
      if (!value || offset === value.byteLength) {
        const next = await abortable(reader.read(), cancelled.signal);
        if (next.done) {
          port.postMessage({ end: true });
          return;
        }
        value = next.value;
        offset = 0;
      }
      const end = Math.min(value.byteLength, offset + MAX_CHUNK_BYTES);
      // Transfer complete bounded views too: an RTC record may start after its
      // native framing header. Structured clone preserves the view's offset/length.
      const chunk = offset === 0 && end === value.byteLength && value.buffer.byteLength <= MAX_CHUNK_BYTES
        ? value : value.slice(offset, end);
      offset = end;
      // A whole-buffer transfer detaches value, so release it before checking its length again.
      if (chunk === value) value = null;
      port.postMessage({ chunk }, [chunk.buffer]);
    }
  } catch (_) {
    port.postMessage({ error: cancelled.signal.aborted ? 'stopped' : 'network' });
  } finally {
    signal.removeEventListener('abort', stop);
    reader.cancel().catch(() => {});
    reader.releaseLock();
    port.close();
    credit = null;
  }
}

/** At most one transferred frame awaits acknowledgement and one frame waits here (the newest). */
export function createFrameDelivery(send) {
  let inFlight = null, pending = null, sequence = 0, droppedFrames = 0;
  function flush() {
    if (inFlight !== null || !pending) return;
    const next = pending;
    pending = null;
    inFlight = ++sequence;
    try { send({ ...next, frameId: inFlight }); }
    catch (_) { droppedFrames++; next.frame.close(); inFlight = null; }
  }
  return {
    present(frame, config, id, timing, outputWindow) {
      if (pending) { droppedFrames++; pending.frame.close(); }
      pending = { frame, config, id, timing, outputWindow };
      flush();
    },
    acknowledge(frameId) {
      if (frameId !== inFlight) return;
      inFlight = null;
      flush();
    },
    stop() {
      pending?.frame.close();
      pending = null;
      droppedFrames = 0;
      // The transferred frame still belongs to the main thread; keep its credit until it acknowledges.
    },
    stats: () => ({ transferDroppedFrames: droppedFrames }),
  };
}
