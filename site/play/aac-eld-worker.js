// SPDX-License-Identifier: GPL-3.0-only
import { createEldDecoder } from './vendor/aac-eld/aac-eld.js';

let decoder = null, configuring = false, failed = false;
function fail() {
  if (failed) return;
  failed = true; decoder?.close(); decoder = null;
  self.postMessage({ kind: 'error' });
}
self.onmessage = async ({ data }) => {
  if (failed) return;
  try {
    if (data?.kind === 'configure') {
      if (decoder || configuring) throw new Error('Already configured.');
      configuring = true;
      decoder = await createEldDecoder(data.options);
      if (failed) { decoder.close(); decoder = null; return; }
      self.postMessage({ kind: 'ready' }); return;
    }
    if (data?.kind !== 'decode' || !decoder || !Number.isSafeInteger(data.id)
      || !(data.packet instanceof ArrayBuffer) || data.packet.byteLength < 1 || data.packet.byteLength > 8192)
      throw new Error('Invalid decode request.');
    // Never transfer the borrowed PCM view: its buffer is the decoder's entire WASM memory.
    const pcm = decoder.decode(new Uint8Array(data.packet), true);
    if (!(pcm instanceof Int16Array) || pcm.length !== decoder.frameLength * decoder.channels
      || pcm.byteOffset !== 0 || pcm.buffer.byteLength !== pcm.byteLength)
      throw new Error('Invalid decoded PCM.');
    self.postMessage({ kind: 'pcm', id: data.id, pcm: pcm.buffer }, [pcm.buffer]);
  } catch (_) { fail(); }
};
