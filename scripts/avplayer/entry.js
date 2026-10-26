// SPDX-License-Identifier: GPL-3.0-only
import UpstreamAVPlayer, { Events, AVPlayerSupportedCodecs } from './upstream.js';
export { Events, AVPlayerSupportedCodecs };

/** Local baseline audio modules; URL video decoding stays in WebCodecs. */
export function getWasm(type, codecId, mediaType) {
  let asset;
  if (type === 'resampler') asset = 'resample/resample.wasm';
  else if (type === 'stretchpitcher') asset = 'stretchpitch/stretchpitch.wasm';
  else if (type === 'decoder' && mediaType !== 0) {
    const names = { 86018: 'aac', 86017: 'mp3', 86076: 'opus', 86028: 'flac',
      86021: 'vorbis', 86019: 'ac3', 86056: 'eac3' };
    const name = codecId >= 65536 && codecId <= 65572 ? 'pcm' : names[codecId];
    if (name) asset = `decode/${name}.wasm`;
  }
  return asset ? new URL(asset, import.meta.url).href : undefined;
}

/** URL playback always uses the upstream Canvas/Web Audio pipeline. */
export default class AVPlayer extends UpstreamAVPlayer {
  constructor(options) {
    super({ ...options, wasmBaseUrl: new URL('./', import.meta.url).href, getWasm,
      enableHardware: true, enableWebCodecs: true, enableWebGPU: false });
  }
  load(...args) { return this.__tiplayLoading = super.load(...args); }
  play(...args) { return this.__tiplayPlaying = super.play(...args); }
  destroy() {
    return this.__tiplayDestroying ||= (async () => {
      await super.destroy();
      // Native source cancellation happens first; then await the actual operations,
      // including any pipeline initialization already in flight, before global teardown.
      await Promise.allSettled([this.__tiplayLoading, this.__tiplayPlaying].filter(Boolean));
    })();
  }
  async checkUseMSE() { return false; }
  createVideo() { throw new DOMException('Canvas playback is required.', 'NotSupportedError'); }
  createAudio() { throw new DOMException('Web Audio playback is required.', 'NotSupportedError'); }
}
