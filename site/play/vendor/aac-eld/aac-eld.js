/* Third-Party Modified Version of the Fraunhofer FDK AAC Codec Library for Android.
 * TiPlay WASM adapter, modified 2026-10-24. See NOTICE and MODIFICATIONS.txt.
 */
let compiled;
async function loadModule() {
  if (!compiled) {
    compiled = (async () => {
      const response = await fetch(new URL('aac-eld.wasm', import.meta.url));
      if (!response.ok) throw new Error(`AAC-ELD WASM download failed (${response.status}).`);
      if (typeof WebAssembly.compileStreaming === 'function'
        && response.headers.get('Content-Type')?.split(';')[0].trim() === 'application/wasm')
        return WebAssembly.compileStreaming(response);
      return WebAssembly.compile(await response.arrayBuffer());
    })().catch(cause => { compiled = null; throw cause; });
  }
  return compiled;
}

/** Raw decrypted AAC-ELD access units; one independent fixed-memory WASM instance per stream. */
export async function createEldDecoder({ sampleRate = 44100, channels = 2, frameLength = 480,
  sbr = false, module } = {}) {
  if (sbr) throw new RangeError('The TiPlay ELD interface does not negotiate SBR.');
  if (![44100, 48000].includes(sampleRate) || ![1, 2].includes(channels) || ![480, 512].includes(frameLength))
    throw new RangeError('Supported ELD configurations: 44100/48000 Hz, mono/stereo, 480/512 samples.');
  let engine, input, output, closed = false;
  const unavailable = () => 8; // WASI EBADF: this media module has no filesystem or console capability.
  const instance = await WebAssembly.instantiate(module ?? await loadModule(), {
    wasi_snapshot_preview1: {
      fd_close: unavailable, fd_prestat_get: unavailable, fd_prestat_dir_name: unavailable,
      fd_seek: unavailable, fd_write: unavailable,
      proc_exit(code) { throw new Error(`AAC-ELD WASM exited (${code}).`); },
      random_get(pointer, length) {
        const bytes = new Uint8Array(engine.memory.buffer, pointer, length);
        for (let offset = 0; offset < bytes.length; offset += 65536)
          globalThis.crypto.getRandomValues(bytes.subarray(offset, offset + 65536));
        return 0;
      },
    },
  });
  engine = instance.exports;
  engine._initialize();
  const live = () => { if (closed) throw new Error('ELD decoder is closed.'); };
  const check = status => {
    // FDK's 0x4000..0x4fff status range contains usable concealment PCM.
    if (status && (status < 0x4000 || status > 0x4fff)) {
      const cause = new Error(`ELD decode failed: 0x${status.toString(16)}`); cause.code = status; throw cause;
    }
  };
  try {
    check(engine.eld_init(sampleRate, channels, frameLength));
    input = new Uint8Array(engine.memory.buffer, engine.eld_input(), 8192);
    output = new Int16Array(engine.memory.buffer, engine.eld_pcm(), frameLength * channels);
  } catch (cause) { engine.eld_close(); throw cause; }
  const api = {
    sampleRate, channels, frameLength, backend: 'wasm', lastStatus: 0,
    /** Borrowed interleaved PCM16; pass copy=true before transferring ownership. */
    decode(packet, copy = false) {
      live();
      const data = packet instanceof ArrayBuffer ? new Uint8Array(packet) : packet;
      if (!(data instanceof Uint8Array)) throw new TypeError('Expected a Uint8Array or ArrayBuffer containing one raw ELD access unit.');
      if (data.byteLength < 1 || data.byteLength > input.length) throw new RangeError('ELD packet must contain 1..8192 bytes.');
      input.set(data); api.lastStatus = engine.eld_decode(data.byteLength); check(api.lastStatus);
      return copy ? output.slice() : output;
    },
    decodeInto(packet, destination) {
      live();
      if (!(destination instanceof Int16Array) || destination.length < output.length)
        throw new RangeError('Destination must be a sufficiently large Int16Array.');
      destination.set(api.decode(packet)); return output.length;
    },
    conceal(copy = false) {
      live(); api.lastStatus = engine.eld_conceal(); check(api.lastStatus); return copy ? output.slice() : output;
    },
    reset() {
      live(); check(engine.eld_init(sampleRate, channels, frameLength)); output.fill(0); api.lastStatus = 0;
    },
    close() {
      if (closed) return;
      engine.eld_close(); input.fill(0); output.fill(0); closed = true;
      input = null; output = null; engine = null;
    },
  };
  return api;
}
