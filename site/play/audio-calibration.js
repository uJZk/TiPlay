/*! SPDX-License-Identifier: GPL-3.0-only */
const valid = (rate, outputRate, delayMs = 0) => Number.isInteger(rate) && rate >= 8000 && rate <= 96000
  && Number.isInteger(outputRate) && outputRate >= 8000 && outputRate <= 192000 && Number.isFinite(delayMs) && Math.abs(delayMs) <= 100;

/** One fixed-heap worker measures real filter delay away from the audio thread. */
export function createAudioCalibration({ Worker = globalThis.Worker, timeoutMs = 10000 } = {}) {
  let worker = null, fallback = null, disposed = false, sequence = 0;
  const cache = new Map(), pending = new Map();
  function get(rate, outputRate) {
    const key = `${rate}:${outputRate}`, value = cache.get(key);
    if (value) { cache.delete(key); cache.set(key, value); }
    return value;
  }
  function finish(entry, value, error) {
    if (pending.get(entry.key) !== entry) return;
    clearTimeout(entry.timer); pending.delete(entry.key);
    if (error) entry.reject(error);
    else {
      cache.set(entry.key, value);
      while (cache.size > 16) cache.delete(cache.keys().next().value);
      entry.resolve(value);
    }
  }
  function fail(error) {
    worker?.terminate(); worker = null;
    for (const entry of [...pending.values()]) finish(entry, null, error);
  }
  function prepare(rate, outputRate) {
    if (disposed) return Promise.reject(new Error('Audio calibration was disposed.'));
    if (!valid(rate, outputRate)) return Promise.reject(new Error('Invalid audio calibration format.'));
    const existing = get(rate, outputRate); if (existing) return Promise.resolve(existing);
    const key = `${rate}:${outputRate}`;
    if (pending.has(key)) return pending.get(key).promise;
    if (pending.size >= 16) return Promise.reject(new Error('Too many pending audio calibration formats.'));
    const entry = { key, id: ++sequence, rate, outputRate };
    entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
    pending.set(key, entry);
    entry.timer = setTimeout(() => {
      if (pending.get(key) === entry) fail(new Error('Audio calibration timed out.'));
    }, timeoutMs);
    if (Worker) {
      try {
        if (!worker) {
          const installed = worker = new Worker(new URL('audio-calibration-worker.js', import.meta.url), { type: 'module' });
          installed.onmessage = ({ data }) => {
            if (worker !== installed || disposed) return;
            const item = [...pending.values()].find(value => value.id === data.id);
            if (!item) return;
            if (data.error) finish(item, null, new Error(data.error));
            else if (data.rate !== item.rate || data.outputRate !== item.outputRate || !valid(data.rate, data.outputRate, data.delayMs)) {
              fail(new Error('Invalid audio calibration response.'));
            } else finish(item, { rate: data.rate, outputRate: data.outputRate, delayMs: data.delayMs });
          };
          installed.onerror = () => { if (worker === installed) fail(new Error('Audio calibration worker failed.')); };
          installed.onmessageerror = () => { if (worker === installed) fail(new Error('Audio calibration worker response failed.')); };
        }
        worker.postMessage({ id: entry.id, rate, outputRate });
      } catch (error) { fail(error); }
    } else {
      // Compatibility only: this still runs outside AudioWorkletGlobalScope.
      fallback ??= import('./streaming-resampler.js').then(async ({ SoxrRuntime, loadSoxr }) => {
        await loadSoxr(); return new SoxrRuntime();
      }).catch(error => { fallback = null; throw error; });
      fallback.then(runtime => {
        if (disposed || !pending.has(key)) return;
        finish(entry, { rate, outputRate, delayMs: runtime.filterDelay(rate, outputRate) });
      }).catch(error => finish(entry, null, error));
    }
    return entry.promise;
  }
  return { get, prepare,
    cancel() { fail(new Error('Audio calibration was cancelled.')); },
    dispose() { disposed = true; fail(new Error('Audio calibration was disposed.')); cache.clear(); fallback = null; },
  };
}
