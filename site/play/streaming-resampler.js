/*! SPDX-License-Identifier: GPL-3.0-only */
const INPUT_FRAMES = 4096, OUTPUT_FRAMES = 512;

/** A replaceable, offline libsoxr reactor; allocation occurs when a stream is created. */
export class SoxrRuntime {
  constructor(module) {
    this.instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: {
      proc_exit: code => { throw new Error(`Audio resampler exited (${code}).`); },
      fd_close: () => 0, fd_seek: () => 8, fd_write: () => 8,
      environ_sizes_get: (count, size) => {
        const memory = new DataView(this.instance.exports.memory.buffer);
        memory.setUint32(count, 0, true); memory.setUint32(size, 0, true); return 0;
      },
      environ_get: () => 0,
      clock_time_get: (_clock, _precision, pointer) => {
        new DataView(this.instance.exports.memory.buffer).setBigUint64(pointer, 0n, true); return 0;
      },
    } });
    this.exports = this.instance.exports; this.exports._initialize(); this.calibrations = new Map();
  }
  create(rate, outputRate, channels) { return new StreamingResampler(this, rate, outputRate, channels); }
  /** vr_delay() is an upstream TODO. Measure this engine's impulse energy centroid instead. */
  filterDelay(rate, outputRate) {
    const key = `${rate}:${outputRate}`;
    if (this.calibrations.has(key)) return this.calibrations.get(key);
    const probe = this.create(rate, outputRate, 1), input = new Float32Array(4096), output = new Float32Array(512);
    input[256] = 1;
    let consumed = 0, emitted = 0, energy = 0, moment = 0;
    for (let call = 0; call < 100; call++) {
      const result = probe.process(input.subarray(consumed), input.length - consumed, output);
      consumed += result.consumed;
      for (let i = 0; i < result.produced; i++) { const weight = output[i] ** 2; energy += weight; moment += (emitted + i) * weight; }
      emitted += result.produced;
      if (!result.produced && !result.consumed) break;
    }
    probe.dispose();
    if (!(energy > 0)) throw new Error('Audio resampler calibration failed.');
    const delay = (moment / energy - 256 * outputRate / rate) * 1000 / outputRate;
    this.calibrations.set(key, delay); return delay;
  }
}

export class StreamingResampler {
  constructor(runtime, rate, outputRate, channels) {
    this.runtime = runtime; this.api = runtime.exports; this.channels = channels;
    this.ratio = rate / outputRate; this.outputRate = outputRate;
    this.handle = this.api.tiplay_create(this.ratio * 1.05, this.ratio, channels);
    this.inputPointer = this.api.malloc(INPUT_FRAMES * channels * 4);
    this.outputPointer = this.api.malloc(OUTPUT_FRAMES * channels * 4);
    if (!this.handle || !this.inputPointer || !this.outputPointer) { this.dispose(); throw new Error('Audio resampler allocation failed.'); }
    this.inputFrames = 0; this.outputFrames = 0;
  }
  setRatio(ratio, slewFrames = 128) {
    if (!(ratio > 0) || ratio > this.ratio * 1.05 || ratio < this.ratio * 0.95) throw new Error('Audio resampling ratio is outside its drift range.');
    if (this.api.tiplay_ratio(this.handle, ratio, slewFrames)) throw new Error('Audio resampling ratio update failed.');
  }
  /** Input is interleaved float32; a zero length requests buffered output without flushing. */
  process(input, frames, output, capacity = output.length / this.channels) {
    frames = Math.min(frames, INPUT_FRAMES); capacity = Math.min(capacity, OUTPUT_FRAMES);
    const heap = new Float32Array(this.api.memory.buffer);
    if (frames) heap.set(input.subarray(0, frames * this.channels), this.inputPointer / 4);
    if (this.api.tiplay_process(this.handle, this.inputPointer, frames, this.outputPointer, capacity)) throw new Error('Audio resampling failed.');
    const consumed = this.api.tiplay_input_done(), produced = this.api.tiplay_output_done();
    output.set(new Float32Array(this.api.memory.buffer, this.outputPointer, produced * this.channels));
    this.inputFrames += consumed; this.outputFrames += produced;
    return { consumed, produced };
  }
  dispose() {
    if (this.handle) this.api.tiplay_delete(this.handle);
    if (this.inputPointer) this.api.free(this.inputPointer);
    if (this.outputPointer) this.api.free(this.outputPointer);
    this.handle = this.inputPointer = this.outputPointer = 0;
  }
}
