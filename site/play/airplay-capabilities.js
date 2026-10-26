// SPDX-License-Identifier: GPL-3.0-only
import { chooseDecoderConfig } from './link.js';
const results = new Map();

/** PCM, ALAC, AAC-LC and AAC-ELD are intrinsic software decoder capabilities. */
export function probeMirrorAudioFormats() { return Promise.resolve(0x3fffffc); }

/** Match the production hardware request for the next mirror negotiation; this probe does not prove actual hardware use. */
export function probeMirrorCapabilities(width, height, Decoder = globalThis.VideoDecoder) {
  const w = Math.max(2, Math.min(3840, Math.floor(width / 2) * 2));
  const h = Math.max(2, Math.min(2160, Math.floor(height / 2) * 2));
  const key = `${w}x${h}`;
  if (results.has(key) && Decoder === globalThis.VideoDecoder) return results.get(key);
  const promise = (async () => {
    const support = async (codec, x, y) => {
      if (!Decoder?.isConfigSupported) return false;
      let timer;
      try {
        const result = await Promise.race([
          chooseDecoderConfig(config => Decoder.isConfigSupported(config), { codec, width: x, height: y }),
          new Promise(resolve => { timer = setTimeout(() => resolve(null), 1000); }),
        ]);
        return Boolean(result);
      } catch (_) { return false; } finally { clearTimeout(timer); }
    };
    let maxWidth = 0, maxHeight = 0;
    for (const scale of [1, 0.75, 0.5, 0.25]) {
      const x = Math.max(2, Math.floor(w * scale / 2) * 2), y = Math.max(2, Math.floor(h * scale / 2) * 2);
      if (await support(x * y > 1920 * 1080 ? 'avc1.640033' : 'avc1.64002a', x, y)) { maxWidth = x; maxHeight = y; break; }
    }
    const hevc = maxWidth > 0 && await support('hvc1.1.6.L153.B0', maxWidth, maxHeight);
    return { h264: maxWidth > 0, hevc, maxWidth, maxHeight };
  })();
  if (Decoder === globalThis.VideoDecoder) { results.set(key, promise); if (results.size > 16) results.delete(results.keys().next().value); }
  return promise;
}
