/*! SPDX-License-Identifier: GPL-3.0-only */
import { soundTouchSimdSupported } from './vendor/soundtouch/soundtouch.js';
let preparedModule = null, pending = null;
export function prepareLiveTempo(module) {
  if (!(module instanceof WebAssembly.Module)) throw new TypeError('Invalid live tempo module.');
  return preparedModule = module;
}
export function loadLiveTempo() {
  if (preparedModule) return Promise.resolve(preparedModule);
  return pending ||= (async () => {
    const name = soundTouchSimdSupported() ? 'soundtouch.simd.wasm' : 'soundtouch.wasm';
    const response = await fetch(new URL(`vendor/soundtouch/${name}`, import.meta.url));
    if (!response.ok) throw new Error(`Live tempo load failed (${response.status}).`);
    return prepareLiveTempo(await WebAssembly.compile(await response.arrayBuffer()));
  })().catch(error => { pending = null; throw error; });
}

/** One bounded WASM memory per worklet; each live stream owns a native handle. */
export class LiveTempoRuntime {
  constructor(module = preparedModule) {
    if (!(module instanceof WebAssembly.Module)) throw new Error('Live tempo module was not prepared.');
    this.api = new WebAssembly.Instance(module, { wasi_snapshot_preview1: {
      fd_close: () => 8, fd_seek: () => 8, fd_write: () => 8, random_get: () => 52,
    } }).exports;
    this.api._initialize();
  }
  create(rate, channels) {
    const api = this.api;
    let handle = api.tempo_live_create(rate, channels), pointer = 0;
    if (!handle) throw new Error('Live tempo format/allocation failed.');
    pointer = api.malloc(512 * channels * 4);
    if (!pointer) { api.tempo_delete(handle); throw new Error('Live tempo buffer allocation failed.'); }
    const view = () => new Float32Array(api.memory.buffer, pointer, 512 * channels);
    return {
      setTempo(tempo) {
        if (!handle || !api.tempo_set(handle, tempo)) throw new Error('Invalid live tempo.');
      },
      put(input, frames) {
        if (!handle || !Number.isSafeInteger(frames) || frames < 0 || frames > 512 || input.length < frames * channels)
          throw new Error('Invalid live tempo input.');
        view().set(input.subarray(0, frames * channels)); api.tempo_put(handle, pointer, frames);
      },
      receive(output, frames) {
        if (!handle || !Number.isSafeInteger(frames) || frames < 0 || frames > 512 || output.length < frames * channels)
          throw new Error('Invalid live tempo output.');
        const produced = api.tempo_receive(handle, pointer, frames);
        output.set(view().subarray(0, produced * channels)); return produced;
      },
      dispose() {
        if (handle) { api.tempo_delete(handle); api.free(pointer); handle = pointer = 0; }
      },
    };
  }
}

/** Sample-rate conversion and pitch-preserving tempo have independent controls. */
export class LiveResampler {
  constructor(runtime, rate, outputRate, channels) {
    this.resampler = runtime.create(rate, outputRate, channels);
    try {
      runtime.liveTempo ||= new LiveTempoRuntime();
      this.stretch = runtime.liveTempo.create(outputRate, channels);
    } catch (error) { this.resampler.dispose(); throw error; }
    this.ratio = rate / outputRate;
    this.channels = channels; this.scratch = new Float32Array(512 * channels);
    this.active = false;
  }
  setRatio(ratio, frames) { this.resampler.setRatio(ratio, frames); this.ratio = ratio; }
  setTempo(tempo) {
    this.stretch.setTempo(tempo);
    // Avoid changing the nominal path for sub-0.01% numerical phase noise.
    // Once stretching starts, retain its overlap history until stream recovery.
    if (Math.abs(tempo - 1) >= .0001) this.active = true;
  }
  get sourceUncertaintyMs() { return this.active ? 20 : 0; }
  process(input, frames, output, capacity = output.length / this.channels) {
    capacity = Math.min(capacity, 512);
    if (!this.active) return this.resampler.process(input, frames, output, capacity);
    const queued = this.stretch.receive(output, capacity);
    if (queued) return { consumed: 0, produced: queued };
    const converted = this.resampler.process(input, frames, this.scratch, 512);
    if (converted.produced) this.stretch.put(this.scratch, converted.produced);
    return { consumed: converted.consumed, produced: this.stretch.receive(output, capacity), progress: converted.produced > 0 };
  }
  dispose() { this.resampler.dispose(); this.stretch.dispose(); }
}
