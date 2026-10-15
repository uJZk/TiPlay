// SPDX-License-Identifier: GPL-3.0-only
import { fetchMediaResource } from './airplay-fetch.js';
const attributes = line => Object.fromEntries([...line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)].map(match => [match[1], match[2].replace(/^"|"$/g, '')]));
export const sdrError = () => new DOMException('This video requires HDR; TiPlay requests SDR video only.', 'NotSupportedError');
export function hasHdrTransfer(colorSpace) {
  return /^(pq|hlg|smpte2084|arib-std-b67)$/i.test(colorSpace?.transfer || '');
}
export function isDolbyVision(codec) { return /(?:^|[,\s])dv(?:h1|he|av|a1)(?:\.|$)/i.test(codec || ''); }

/** Filter master renditions before the demuxer can request an HDR variant or its first segment. */
export function sdrPlaylist(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/), variants = [];
  for (let index = 0; index < lines.length; index++) if (lines[index].startsWith('#EXT-X-STREAM-INF:')) {
    const fields = attributes(lines[index]);
    const range = fields['VIDEO-RANGE'];
    variants.push({ index, sdr: range === 'SDR', allowed: (!range || range === 'SDR') && !isDolbyVision(fields.CODECS) });
  }
  if (!variants.length) return text;
  const explicitSdr = variants.some(variant => variant.allowed && variant.sdr);
  const rejected = new Set();
  for (const variant of variants) if (!variant.allowed || (explicitSdr && !variant.sdr)) {
    rejected.add(variant.index);
    let uri = variant.index + 1;
    while (uri < lines.length && (!lines[uri].trim() || lines[uri].startsWith('#'))) uri++;
    if (uri < lines.length) rejected.add(uri);
  }
  if (variants.every(variant => rejected.has(variant.index))) throw sdrError();
  return lines.filter((line, index) => {
    if (rejected.has(index)) return false;
    if (line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) {
      const fields = attributes(line); return (!fields['VIDEO-RANGE'] || fields['VIDEO-RANGE'] === 'SDR') && !isDolbyVision(fields.CODECS);
    }
    return true;
  }).join('\n');
}

export async function requireSdrTrack(track) {
  if (!track) return;
  const [codec, color, config] = await Promise.all([track.getCodecParameterString?.(), track.getColorSpace?.(), track.getDecoderConfig?.()]);
  if (isDolbyVision(codec) || isDolbyVision(config?.codec) || hasHdrTransfer(color) || hasHdrTransfer(config?.colorSpace)) throw sdrError();
}

export async function filterSdrResponse(response, url, fetchFull) {
  if (!/mpegurl/i.test(response.headers.get('Content-Type') || '') && !/\.m3u8(?:[?#]|$)/i.test(String(url))) return response;
  // Partial manifests must be re-read in full; returning 200 is supported by URLSource's range reader.
  if (response.status === 206) { await response.body?.cancel(); response = await fetchFull(); }
  if (!response.ok) return response;
  if (Number(response.headers.get('Content-Length')) > 2 * 1024 * 1024) throw new Error('Playlist too large');
  const reader = response.body?.getReader();
  if (!reader) return response;
  const chunks = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('Playlist too large'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const filtered = sdrPlaylist(new TextDecoder().decode(bytes)), headers = new Headers(response.headers);
  headers.delete('Content-Range'); headers.delete('Content-Length'); headers.set('Content-Type', 'application/vnd.apple.mpegurl');
  const result = new Response(filtered, { status: 200, headers });
  Object.defineProperties(result, { url: { value: response.url }, redirected: { value: response.redirected } });
  return result;
}

export async function fetchSdrMediaResource(fetcher, url, init, options) {
  const response = await fetchMediaResource(fetcher, url, init, options);
  return filterSdrResponse(response, url, () => {
    const headers = new Headers(init?.headers); headers.delete('Range');
    return fetchMediaResource(fetcher, url, { ...init, headers }, options);
  });
}
