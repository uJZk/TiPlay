/*! SPDX-License-Identifier: GPL-3.0-only */
// LibTomMath 1.3.0: Unlicense; complete upstream source and license accompany the binary.
let preparedModule, loading;
const encoder = new TextEncoder(), decoder = new TextDecoder();

export function prepareSrpMath(module) {
  if (!(module instanceof WebAssembly.Module)) throw new TypeError('Invalid pairing arithmetic module.');
  preparedModule = module;
  return module;
}

/** Compile once before starting the authenticated handshake; failures remain retryable. */
export function loadSrpMath({ timeoutMs = 10000 } = {}) {
  if (preparedModule) return Promise.resolve(preparedModule);
  return loading ??= (async () => {
    const abort = new AbortController();
    let timeout;
    const preparation = (async () => {
      const response = await fetch(new URL('libtommath.wasm', import.meta.url), { signal: abort.signal });
      if (!response.ok) throw new Error('Pairing arithmetic could not be loaded.');
      return WebAssembly.compileStreaming && response.headers.get('content-type')?.split(';')[0].trim() === 'application/wasm'
        ? WebAssembly.compileStreaming(response) : WebAssembly.compile(await response.arrayBuffer());
    })();
    try {
      const module = await Promise.race([preparation, new Promise((_, reject) => {
        timeout = setTimeout(() => { abort.abort(); reject(new Error('Pairing arithmetic preparation timed out.')); }, timeoutMs);
      })]);
      return prepareSrpMath(module);
    } finally { clearTimeout(timeout); }
  })().catch(error => {
    loading = null;
    // An unavailable browser asset cannot establish that the pairing code is wrong.
    error.rtcReason ??= /timed out/.test(error.message) ? 'timeout' : 'connection';
    throw error;
  });
}

/** One bounded private heap per handshake. WebCrypto owns randomness and hashing. */
export class SrpMath {
  constructor(module = preparedModule) {
    if (!module) throw new Error('Pairing arithmetic was not prepared.');
    let api;
    // The complete library also exports optional file/platform helpers. This
    // arithmetic sandbox grants no filesystem, sockets or process access.
    const wasi = Object.fromEntries(WebAssembly.Module.imports(module).map(({ module: namespace, name, kind }) => {
      if (namespace !== 'wasi_snapshot_preview1' || kind !== 'function') throw new Error('Invalid pairing arithmetic imports.');
      return [name, () => 52]; // WASI ENOSYS for capabilities outside this adapter.
    }));
    const empty = (count, size) => {
      const view = new DataView(api.memory.buffer);
      view.setUint32(count, 0, true); view.setUint32(size, 0, true); return 0;
    };
    Object.assign(wasi, {
      args_get: () => 0, args_sizes_get: empty, environ_get: () => 0, environ_sizes_get: empty,
      random_get: (pointer, length) => {
        const bytes = new Uint8Array(api.memory.buffer, pointer, length);
        for (let offset = 0; offset < bytes.length; offset += 65536)
          crypto.getRandomValues(bytes.subarray(offset, Math.min(bytes.length, offset + 65536)));
        return 0;
      },
      proc_exit: () => { throw new Error('Pairing arithmetic exited.'); },
    });
    api = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi }).exports;
    api._initialize(); api.srp_initialize();
    this.api = api;
    this.scratch = new Uint8Array(api.memory.buffer, api.srp_scratch(), 4096);
  }
  modPow(base, exponent, modulus) {
    if (!this.api) throw new Error('Pairing arithmetic was disposed.');
    if ([base, exponent, modulus].some(value => typeof value !== 'bigint') || base < 0n || exponent < 0n || modulus < 2n)
      throw new RangeError('Invalid pairing arithmetic operands.');
    const values = [base, exponent, modulus].map(value => value.toString(16));
    // RFC 5054's fixed 2048-bit group can produce one extra base/exponent bit.
    if (values[0].length > 513 || values[1].length > 513 || values[2].length > 512)
      throw new RangeError('Pairing arithmetic exceeds its group bounds.');
    const scratch = this.scratch;
    try {
      for (let index = 0; index < values.length; index++) {
        scratch.set(encoder.encode(values[index]), index * 1024);
        scratch[index * 1024 + values[index].length] = 0;
      }
      if (this.api.srp_pow() !== 0) throw new Error('Pairing arithmetic failed.');
      const end = scratch.indexOf(0, 3072);
      if (end < 3073 || end > 3584) throw new Error('Invalid pairing arithmetic result.');
      return BigInt('0x' + decoder.decode(scratch.subarray(3072, end)));
    } finally { scratch.fill(0); }
  }
  dispose() {
    // LTO may remove an ordinary C clear immediately before free. Once no more
    // WASM calls are possible, explicitly erase the entire private heap instead.
    if (this.api) new Uint8Array(this.api.memory.buffer).fill(0);
    this.scratch = null; this.api = null;
  }
}
