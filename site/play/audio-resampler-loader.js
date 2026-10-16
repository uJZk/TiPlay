// SPDX-License-Identifier: GPL-3.0-only
let pendingModule = null;

/** One replaceable, self-hosted module is shared by the independent stream resamplers. */
export function loadSoxrModule({ fetchAsset = globalThis.fetch } = {}) {
  if (!pendingModule) {
    pendingModule = (async () => {
      if (typeof globalThis.WebAssembly?.compile !== 'function') throw new Error('WebAssembly audio resampling is unavailable.');
      const response = await fetchAsset(new URL('./vendor/soxr/soxr.wasm', import.meta.url), {
        credentials: 'same-origin', cache: 'force-cache',
      });
      if (!response.ok) throw new Error(`Audio resampler HTTP ${response.status}`);
      if (Number(response.headers?.get('Content-Length')) > 4 * 1024 * 1024) throw new Error('Audio resampler is too large.');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 4 * 1024 * 1024) throw new Error('Audio resampler is too large.');
      return WebAssembly.compile(bytes);
    })().catch(error => { pendingModule = null; throw error; });
  }
  return pendingModule;
}
