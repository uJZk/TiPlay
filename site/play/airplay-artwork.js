// SPDX-License-Identifier: GPL-3.0-only
import { photoMetadata } from './airplay-photo.js';
const MAX_BYTES = 1024 * 1024;

/** Album artwork stays on the authenticated phone route and belongs to one playback item. */
export function createAirPlayArtwork(fetchResource, changed, { makeURL = URL.createObjectURL,
  revokeURL = URL.revokeObjectURL } = {}) {
  let owner = null, request = null, url = null, disposed = false;
  function retire() {
    request?.abort(); request = null;
    if (url) revokeURL(url);
    url = null;
  }
  return {
    update(identity, route) {
      if (disposed || identity === owner) return;
      owner = identity; retire(); changed(null);
      if (!identity || !route) return;
      const abort = request = new AbortController();
      void (async () => {
        const response = await fetchResource(route, { signal: abort.signal });
        if (!response.ok) { await response.body?.cancel(); throw new Error('Artwork unavailable'); }
        const type = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
        if (!['image/jpeg', 'image/png'].includes(type)) { await response.body?.cancel(); throw new Error('Unsupported artwork'); }
        const length = Number(response.headers.get('Content-Length'));
        if (length > MAX_BYTES) { await response.body?.cancel(); throw new Error('Artwork too large'); }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Missing artwork');
        const chunks = []; let size = 0;
        const cancel = () => { void reader.cancel().catch(() => {}); };
        abort.signal.addEventListener('abort', cancel, { once: true });
        try {
          while (true) {
            if (abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) throw new Error('Artwork too large');
            chunks.push(value);
          }
        } finally {
          abort.signal.removeEventListener('abort', cancel);
          await reader.cancel().catch(() => {}); reader.releaseLock();
        }
        if (abort.signal.aborted || request !== abort || disposed) return;
        const blob = new Blob(chunks, { type });
        const metadata = photoMetadata(new Uint8Array(await blob.arrayBuffer()));
        if (metadata.type !== type) throw new Error('Invalid artwork');
        if (abort.signal.aborted || request !== abort || disposed) return;
        url = makeURL(blob); changed(url);
      })().catch(() => { /* Missing or rejected art uses the player's local placeholder. */ });
    },
    dispose() { disposed = true; owner = null; retire(); },
  };
}
