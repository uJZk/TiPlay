/*! SPDX-License-Identifier: GPL-3.0-only */
import { SoxrRuntime } from './streaming-resampler.js';

let runtime;
self.onmessage = ({ data }) => {
  const { id, rate, outputRate } = data;
  try {
    if (!Number.isInteger(rate) || rate < 8000 || rate > 96000 || !Number.isInteger(outputRate)
      || outputRate < 8000 || outputRate > 192000) throw new Error('Invalid audio calibration format.');
    runtime ??= new SoxrRuntime();
    self.postMessage({ id, rate, outputRate, delayMs: runtime.filterDelay(rate, outputRate) });
  } catch (error) { self.postMessage({ id, error: error.message || String(error) }); }
};
