/*! SPDX-License-Identifier: GPL-3.0-only */
const SIMD = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
  3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11);
const MAX_FRAMES = 4096;
let preparation;
export const soundTouchSimdSupported = () => WebAssembly.validate(SIMD);

/** Compile once, lazily for non-1x URL audio; instances never share mutable state. */
export function loadSoundTouch({ bytes, module, simd = soundTouchSimdSupported(), cache = true, planar = false } = {}) {
  if (cache && preparation) return preparation;
  const pending = (async () => {
    if (!module) {
      if (bytes) module = await WebAssembly.compile(bytes);
      else {
        const response = await fetch(new URL(simd ? './soundtouch.simd.wasm' : './soundtouch.wasm', import.meta.url));
        if (!response.ok) throw new Error(`SoundTouch download failed (${response.status}).`);
        module = typeof WebAssembly.compileStreaming === 'function' && /^application\/wasm(?:;|$)/i.test(response.headers.get('Content-Type') || '')
          ? await WebAssembly.compileStreaming(response) : await WebAssembly.compile(await response.arrayBuffer());
      }
    }
    return Object.freeze({ backend: simd ? 'wasm-simd' : 'wasm', create: (sampleRate, rate) => createProcessor(module, sampleRate, rate, planar) });
  })();
  if (cache) {
    preparation = pending;
    pending.catch(() => { if (preparation === pending) preparation = null; });
  }
  return pending;
}

function createProcessor(module, sampleRate, rate, planar) {
  let memory;
  let engine = new WebAssembly.Instance(module, { wasi_snapshot_preview1: {
    fd_close: () => 8, fd_seek: () => 8, fd_write: () => 8,
    random_get(pointer, count) {
      const bytes = new Uint8Array(memory.buffer, pointer, count);
      for (let offset = 0; offset < count; offset += 65536)
        crypto.getRandomValues(bytes.subarray(offset, Math.min(count, offset + 65536)));
      return 0;
    },
  } }).exports;
  memory = engine.memory;
  engine._initialize();
  let handle = engine.tempo_create(sampleRate, rate), pointer = 0;
  if (!handle) throw new Error('SoundTouch rejected the audio format or exhausted its bounded memory.');
  const capacity = MAX_FRAMES * (planar ? 6 : 2);
  pointer = engine.malloc(capacity * 4);
  if (!pointer) { engine.tempo_delete(handle); throw new Error('SoundTouch input allocation failed.'); }
  let planarView;
  const view = () => {
    if (!planar) return new Float32Array(memory.buffer, pointer, capacity);
    if (!planarView || planarView.buffer !== memory.buffer) planarView = new Float32Array(memory.buffer, pointer, capacity);
    return planarView;
  };
  function close() {
    if (!handle) return;
    try { engine.tempo_delete(handle); engine.free(pointer); }
    finally { handle = pointer = 0; engine = memory = planarView = null; }
  }
  function assertOpen() { if (!handle) throw new Error('The tempo processor is closed.'); }
  function receive(blocks) {
    while (engine.tempo_available(handle)) {
      const frames = engine.tempo_receive(handle, pointer, MAX_FRAMES);
      if (!frames) throw new Error('SoundTouch output did not make progress.');
      blocks.push(view().slice(0, frames * 2));
    }
  }
  function collect(blocks) {
    if (!blocks.length) return null;
    if (blocks.length === 1) return blocks[0];
    const samples = new Float32Array(blocks.reduce((length, block) => length + block.length, 0));
    let offset = 0;
    for (const block of blocks) { samples.set(block, offset); offset += block.length; }
    return samples;
  }
  return {
    push(left, right = left) {
      assertOpen();
      if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length)
        throw new TypeError('Audio channels must contain equally sized Float32 arrays.');
      const blocks = [];
      try {
        for (let offset = 0; offset < left.length; offset += MAX_FRAMES) {
          const frames = Math.min(MAX_FRAMES, left.length - offset), samples = view();
          for (let i = 0; i < frames; i++) {
            samples[i * 2] = left[offset + i]; samples[i * 2 + 1] = right[offset + i];
          }
          engine.tempo_put(handle, pointer, frames); receive(blocks);
        }
        return collect(blocks);
      } catch (cause) { close(); throw cause; }
    },
    // Experimental all-native layout path. It isolates the extra copy on
    // mono/stereo from the selected production policy, using identical DSP.
    pushChannels(channels) {
      assertOpen();
      if (!planar) throw new Error('Native planar mode must be requested explicitly.');
      const blocks = [];
      try {
        for (let offset = 0; offset < channels[0].length; offset += MAX_FRAMES) {
          const frames = Math.min(MAX_FRAMES, channels[0].length - offset), samples = view();
          for (let channel = 0; channel < channels.length; channel++) {
            if (channels.length === 6 && channel === 3) continue;
            const plane = channels[channel];
            samples.set(offset === 0 && frames === plane.length ? plane : plane.subarray(offset, offset + frames), channel * MAX_FRAMES);
          }
          if (!engine.tempo_put_planar(handle, pointer, frames, channels.length)) throw new Error('Invalid reference audio.');
          receive(blocks);
        }
        return collect(blocks);
      } catch (cause) { close(); throw cause; }
    },
    finish() {
      if (!handle) return null;
      try { engine.tempo_finish(handle); const blocks = []; receive(blocks); return collect(blocks); }
      finally { close(); }
    },
    dispose: close,
  };
}
