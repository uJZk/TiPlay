// SPDX-License-Identifier: GPL-3.0-only
const MAX_BYTES = 16 * 1024 * 1024, MAX_PIXELS = 64 * 1024 * 1024;
const abortError = () => new DOMException('Photo display cancelled', 'AbortError');

/** Inspect encoded dimensions before invoking an image decoder; never accept SVG or an unbounded image. */
export function photoMetadata(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width, height, type;
  if (bytes.length >= 24 && bytes.slice(0, 8).every((value, i) => value === [137, 80, 78, 71, 13, 10, 26, 10][i])) {
    if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) throw new Error('Invalid PNG header');
    width = view.getUint32(16); height = view.getUint32(20); type = 'image/png';
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    type = 'image/jpeg';
    let cursor = 2;
    while (cursor < bytes.length) {
      if (bytes[cursor++] !== 255) throw new Error('Invalid JPEG marker');
      while (cursor < bytes.length && bytes[cursor] === 255) cursor++;
      const marker = bytes[cursor++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (cursor + 2 > bytes.length) throw new Error('Truncated JPEG');
      const length = view.getUint16(cursor);
      if (length < 2 || cursor + length > bytes.length) throw new Error('Truncated JPEG segment');
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) throw new Error('Invalid JPEG frame');
        height = view.getUint16(cursor + 3); width = view.getUint16(cursor + 5); break;
      }
      cursor += length;
    }
  }
  if (!width || !height || width > 16384 || height > 16384 || width * height > MAX_PIXELS) {
    throw new Error('Unsupported photo dimensions');
  }
  return { width, height, type };
}

export async function readPhotoResource(response, signal) {
  if (signal?.aborted) throw abortError();
  if (!response.ok || Number(response.headers.get('Content-Length')) > MAX_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Photo unavailable or too large');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (signal?.aborted) throw abortError();
    if (bytes.length > MAX_BYTES) throw new Error('Photo too large');
    return bytes;
  }
  let size = 0;
  const chunks = [];
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw abortError();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('Photo too large');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

/** Native JPEG/PNG decoding preserves EXIF orientation and fits every browser resize without re-encoding. */
export function createPhotoPresenter(layer, { fetchResource = fetch, signal } = {}) {
  const image = document.createElement('img');
  image.className = 'airplay-photo'; image.alt = ''; image.decoding = 'async';
  Object.assign(image.style, { width: '100%', height: '100%', objectFit: 'contain', imageOrientation: 'from-image', display: 'block' });
  layer.append(image);
  let disposed = false, objectUrl = null, serial = 0;
  const controller = new AbortController();
  function dispose() {
    if (disposed) return;
    disposed = true; serial++; controller.abort(); image.removeAttribute('src'); image.remove();
    if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null;
    signal?.removeEventListener('abort', dispose);
  }
  signal?.addEventListener('abort', dispose, { once: true });
  if (signal?.aborted) dispose();
  return {
    async load(url) {
      if (disposed) throw abortError();
      const token = ++serial;
      const response = await fetchResource(url, { signal: controller.signal, referrerPolicy: 'no-referrer', cache: 'no-store' });
      const bytes = await readPhotoResource(response, controller.signal);
      const metadata = photoMetadata(bytes);
      if (disposed || token !== serial) throw abortError();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: metadata.type }));
      image.src = objectUrl;
      await image.decode();
      if (disposed || token !== serial) throw abortError();
      return metadata;
    },
    dispose,
  };
}
