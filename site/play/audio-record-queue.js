// SPDX-License-Identifier: GPL-3.0-only
import { MAX_AUDIO_AHEAD_BYTES } from './audio-buffer-policy.js';

const aborted = () => new DOMException('Audio record queue was cancelled.', 'AbortError');
const recordBytes = record => 64 + (record.pcm?.byteLength ?? record.payload?.byteLength
  ?? (record.config ? new TextEncoder().encode(JSON.stringify(record.config)).byteLength : 0));

/** Bounded admission, FIFO within a transport stream, independent progress between streams. */
export function createAudioRecordQueue({ process, signal, onError = () => {},
  maxBytes = MAX_AUDIO_AHEAD_BYTES, maxStreamBytes = MAX_AUDIO_AHEAD_BYTES / 2,
  maxRecords = 1024, maxStreamRecords = 256, maxStreams = 16 } = {}) {
  const fresh = () => ({ lanes: new Map(), bytes: 0, records: 0, waits: new Set(), idle: new Set(),
    abort: new AbortController(), closed: false, error: null });
  let state = fresh(), closed = false;
  const wake = current => { for (const resolve of current.waits) resolve(); current.waits.clear(); };
  const settleIdle = current => {
    if (!current.records || current.closed) {
      for (const resolve of current.idle) resolve(); current.idle.clear();
    }
  };
  function cancel(current, cause) {
    current.closed = true; current.error = cause; current.abort.abort();
    current.lanes.clear(); current.bytes = current.records = 0;
    wake(current); settleIdle(current);
  }
  function fail(current, cause) {
    if (current.closed) return;
    cancel(current, cause); onError(cause);
  }
  async function run(current, key, lane) {
    while (!current.closed && lane.items.length) {
      const item = lane.items[0];
      try { await process(item.record, current.abort.signal); }
      catch (cause) { fail(current, cause); return; }
      if (current.closed) return;
      lane.items.shift(); lane.bytes -= item.bytes; current.bytes -= item.bytes; current.records--;
      if (!lane.items.length) current.lanes.delete(key);
      wake(current); settleIdle(current);
    }
  }
  const stop = () => {
    closed = true; cancel(state, aborted());
    signal?.removeEventListener('abort', stop);
  };
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  return {
    async enqueue(record) {
      const current = state, bytes = recordBytes(record), key = record.type;
      if (bytes > maxBytes || bytes > maxStreamBytes) throw Error('Audio record exceeds its dispatch memory limit.');
      for (;;) {
        if (closed || current.closed) throw current.error ?? aborted();
        const lane = current.lanes.get(key);
        if (!lane && current.lanes.size >= maxStreams) throw Error('Too many simultaneous audio dispatch streams.');
        if (current.bytes + bytes <= maxBytes && current.records < maxRecords
          && (lane?.bytes ?? 0) + bytes <= maxStreamBytes && (lane?.items.length ?? 0) < maxStreamRecords) {
          const target = lane ?? { items: [], bytes: 0 };
          target.items.push({ record, bytes }); target.bytes += bytes;
          current.bytes += bytes; current.records++;
          if (!lane) { current.lanes.set(key, target); void run(current, key, target); }
          return;
        }
        await new Promise(resolve => current.waits.add(resolve));
      }
    },
    async drain() {
      const current = state;
      if (current.records && !current.closed) await new Promise(resolve => current.idle.add(resolve));
      if (current.closed) throw current.error ?? aborted();
    },
    reset() { if (closed) return; cancel(state, aborted()); state = fresh(); },
    close: stop,
    stats: () => ({ bytes: state.bytes, records: state.records, streams: state.lanes.size }),
  };
}
