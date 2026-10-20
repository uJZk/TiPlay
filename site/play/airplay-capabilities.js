// SPDX-License-Identifier: GPL-3.0-only
import { airPlayAudioDecoderConfig } from './airplay-audio-decoder.js';
import { chooseDecoderConfig } from './link.js';
const results = new Map();
const audioResults = new WeakMap();

function alacCookie(sampleRate, bitDepth) {
  const bytes = new Uint8Array(36), view = new DataView(bytes.buffer);
  view.setUint32(0, 36); bytes.set([97, 108, 97, 99], 4);
  view.setUint32(12, 352); bytes.set([0, bitDepth, 40, 10, 14, 2], 16);
  view.setUint16(22, 255); view.setUint32(32, sampleRate);
  return [...bytes];
}

/** Native-only formats require every accepted frame variant; AAC-ELD has a bundled decoder. */
export function probeMirrorAudioFormats(Decoder = globalThis.AudioDecoder, probeTimeout = 1000) {
  // PCM 2..17 uses JavaScript conversion; ELD 24..25 has a software fallback for both frame lengths.
  const intrinsic = 0x303fffc;
  if (!Decoder?.isConfigSupported) return Promise.resolve(intrinsic);
  if (audioResults.has(Decoder)) return audioResults.get(Decoder);
  const promise = (async () => {
    const support = async config => {
      let timer;
      try {
        const result = await Promise.race([
          Decoder.isConfigSupported(airPlayAudioDecoderConfig(config)),
          new Promise(resolve => { timer = setTimeout(() => resolve({ supported: false }), probeTimeout); }),
        ]);
        return result.supported === true;
      } catch (_) { return false; } finally { clearTimeout(timer); }
    };
    const formats = [];
    for (const sampleRate of [44100, 48000]) for (const bitDepth of [16, 24]) {
      formats.push([{ codec: 'alac', sampleRate, channels: 2, cookie: alacCookie(sampleRate, bitDepth) }]);
    }
    for (const sampleRate of [44100, 48000]) {
      formats.push([1024, 960].map(samplesPerFrame => ({ codec: 'aac-lc', sampleRate, channels: 2,
        asc: [sampleRate === 44100 ? 0x12 : 0x11, (sampleRate === 44100 ? 0x10 : 0x90) | (samplesPerFrame === 960 ? 4 : 0)] })));
    }
    const supported = await Promise.all(formats.map(async variants => (await Promise.all(variants.map(support))).every(Boolean)));
    return supported.reduce((mask, accepted, index) => accepted ? mask | (1 << (index + 18)) : mask, intrinsic);
  })();
  audioResults.set(Decoder, promise);
  return promise;
}

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
