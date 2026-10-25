// SPDX-License-Identifier: GPL-3.0-only
// Feed the production readAudioRecords/createBrowserAudio boundary from a local capture.
// Clock mapping is supplied by the caller; captured presentation timestamps stay intact.
export function createCaptureReplay({ events, readRange, signal, startAtMs = null, holdOpenAtEnd = false, now = () => performance.now(),
  schedule = (callback, ms) => setTimeout(callback, ms), unschedule = timer => clearTimeout(timer) }) {
  let position = 0, origin = startAtMs, timer = null, releaseWait = null, stopped = false;
  const counters = { emittedRecords: 0, emittedBytes: 0, lateRecords: 0, maxLatenessMs: 0, timestampRegressions: 0 };
  if ((startAtMs !== null && !Number.isFinite(startAtMs)) || !Array.isArray(events) || events.some(event => !Number.isFinite(event.atMs)
    || !Number.isSafeInteger(event.offset) || event.offset < 0
    || !Number.isSafeInteger(event.length) || event.length < 0 || event.length > 256 * 1024 + 4)) {
    throw Error('Invalid capture replay events');
  }
  function stop() {
    stopped = true;
    if (timer !== null) unschedule(timer);
    timer = null; releaseWait?.(); releaseWait = null;
    signal?.removeEventListener('abort', abort);
  }
  let controller;
  function abort() {
    stop();
    controller?.error(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  }
  const stream = new ReadableStream({
    start(value) {
      controller = value;
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    },
    async pull(controller) {
      if (stopped) return;
      if (position === events.length) {
        if (holdOpenAtEnd) await new Promise(resolve => { releaseWait = resolve; });
        else { stop(); controller.close(); }
        return;
      }
      origin ??= now();
      const event = events[position];
      const wait = origin + event.atMs - now();
      if (wait > 0) await new Promise(resolve => {
        releaseWait = resolve;
        timer = schedule(() => { timer = null; releaseWait = null; resolve(); }, wait);
      });
      if (stopped) return;
      try {
        const bytes = await readRange(event.offset, event.length);
        if (stopped) return;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== event.length) throw Error('Truncated capture range');
        const late = Math.max(0, now() - origin - event.atMs);
        counters.maxLatenessMs = Math.max(counters.maxLatenessMs, late);
        if (late > 1) counters.lateRecords++;
        if (position && event.atMs < events[position - 1].atMs) counters.timestampRegressions++;
        counters.emittedRecords++; counters.emittedBytes += bytes.length; position++;
        controller.enqueue(bytes);
      } catch (error) { if (!stopped) { stop(); controller.error(error); } }
    },
    cancel() { stop(); },
  }, { highWaterMark: 0 });
  return { stream, stats: () => ({ ...counters, stopped }) };
}
