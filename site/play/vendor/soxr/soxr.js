/*! SPDX-License-Identifier: GPL-3.0-only */
// libsoxr LGPL-2.1-or-later. The complete source and build recipe accompany soxr.wasm.
let preparedModule = null, pendingModule = null;

/** Install a compiled module before constructing a runtime in a worker/worklet. */
export function prepareSoxr(module) {
  if (!(module instanceof WebAssembly.Module)) throw new TypeError('Invalid audio resampler module.');
  preparedModule = module;
  return module;
}

/** Compile once outside the audio rendering thread. No eval or JavaScript fallback. */
export function loadSoxr() {
  if (preparedModule) return Promise.resolve(preparedModule);
  pendingModule ??= (async () => {
    const response = await fetch(new URL('soxr.wasm', import.meta.url));
    if (!response.ok) throw new Error(`Audio resampler load failed (${response.status}).`);
    let module;
    if (WebAssembly.compileStreaming && response.headers.get('content-type')?.split(';')[0].trim() === 'application/wasm') {
      module = await WebAssembly.compileStreaming(response);
    } else module = await WebAssembly.compile(await response.arrayBuffer());
    return prepareSoxr(module);
  })().catch(error => { pendingModule = null; throw error; });
  return pendingModule;
}

/** Each instance owns fixed memory; compiled code can be shared across agents. */
export default function createSoxr(module = preparedModule) {
  if (!(module instanceof WebAssembly.Module)) throw new Error('Audio resampler module was not prepared.');
  let api;
  const memory = () => new DataView(api.memory.buffer);
  const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: {
    random_get: () => 52, // ENOSYS: libc's non-cryptographic stack guard uses its fallback.
    environ_get: () => 0,
    environ_sizes_get: (count, size) => { memory().setUint32(count, 0, true); memory().setUint32(size, 0, true); return 0; },
    clock_time_get: (_clock, _precision, pointer) => { memory().setBigUint64(pointer, 0n, true); return 0; },
    fd_close: () => 8, fd_seek: () => 8, fd_write: () => 8,
    proc_exit: code => { throw new Error(`Audio resampler exited (${code}).`); },
  } });
  api = instance.exports;
  api._initialize();
  return instance;
}
