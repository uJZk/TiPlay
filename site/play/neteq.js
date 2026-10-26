/*! SPDX-License-Identifier: GPL-3.0-only */
let prepared, loading;
export function prepareNetEq(module) {
  if (!(module instanceof WebAssembly.Module)) throw new TypeError('Invalid NetEq module.');
  return prepared = module;
}
export function loadNetEq() {
  if (prepared) return Promise.resolve(prepared);
  return loading ||= (async () => {
    const response = await fetch(new URL('vendor/neteq/neteq.wasm', import.meta.url));
    if (!response.ok) throw new Error(`NetEq download failed (${response.status}).`);
    return prepareNetEq(await WebAssembly.compile(await response.arrayBuffer()));
  })().catch(error => { loading = null; throw error; });
}

/** Official libWebRTC NetEq. One fixed-memory instance, owned by one audio thread. */
export class NetEqRuntime {
  constructor(module = prepared) {
    if (!(module instanceof WebAssembly.Module)) throw new Error('NetEq was not prepared.');
    this.api = new WebAssembly.Instance(module, { wasi_snapshot_preview1: {
      fd_close: () => 8, fd_seek: () => 8, fd_write: () => 8, fd_fdstat_get: () => 8,
      clock_time_get: (clock, precision, pointer) => {
        const ms = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
        new DataView(this.api.memory.buffer).setBigUint64(pointer, BigInt(Math.floor(ms * 1e6)), true);
        return 0;
      },
      proc_exit: code => { throw new Error(`NetEq aborted (${code}).`); },
      random_get: () => 52,
    } }).exports;
    this.api._initialize();
  }
  create(codec, channels) {
    const api = this.api;
    let handle = api.neteq_create(codec === 'opus' ? 1 : 0, channels);
    if (!handle) throw new Error('NetEq allocation/format failed.');
    const input = new Uint8Array(api.memory.buffer, api.neteq_input(handle), 65536);
    const floats = new Float32Array(api.memory.buffer, api.neteq_input(handle), 480 * channels);
    const pcm = new Float32Array(api.memory.buffer, api.neteq_pcm(handle), 480 * channels);
    return {
      insert(payload, sequence, timestamp, arrivalMs) {
        if (!handle || !(payload instanceof Uint8Array) || payload.length < 1 || payload.length > 65536)
          throw new Error('Invalid NetEq packet.');
        input.set(payload);
        return api.neteq_insert(handle, payload.length, sequence & 65535, timestamp >>> 0, arrivalMs) === 0;
      },
      insertPcm(samples, frames, sequence, timestamp, arrivalMs) {
        if (!handle || frames < 1 || frames > 480 || samples.length < frames * channels) throw new Error('Invalid NetEq PCM packet.');
        floats.set(samples.subarray(0, frames * channels));
        return api.neteq_insert_float(handle, frames, sequence & 65535, timestamp >>> 0, arrivalMs) === 0;
      },
      pull(output, nowMs) {
        if (!handle) return 0;
        const count = api.neteq_pull(handle, nowMs);
        if (count < 0) throw new Error('NetEq audio generation failed.');
        if (count) output.set(pcm);
        return count;
      },
      timestamp() { return handle ? api.neteq_timestamp(handle) : -1; },
      packetFrames() { return api.neteq_duration(handle); },
      stats() {
        const values = ['targetDelayMs', 'filteredDelayMs', 'concealedSamples', 'insertedSamples',
          'removedSamples', 'discardedPackets', 'bufferMs', 'fecPacketsReceived', 'fecPacketsDiscarded', 'concealmentEvents'];
        return Object.fromEntries(values.map((name, key) => [name, api.neteq_stat(handle, key)]));
      },
      dispose() { if (handle) api.neteq_delete(handle); handle = 0; },
    };
  }
}
