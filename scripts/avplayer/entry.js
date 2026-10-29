// SPDX-License-Identifier: GPL-3.0-only
import UpstreamAVPlayer, { Events, AVPlayerSupportedCodecs } from './upstream.js';
import { createEmbeddedCaptionBridge } from './embedded-captions.js';
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
    this.__tiplayCaptions = createEmbeddedCaptionBridge(this);
    this.on('played', () => this.__tiplayCaptions.resume());
    this.on('ended', () => this.__tiplayCaptions.ended());
  }
  load(source, options = {}) {
    return this.__tiplayLoading = (async () => {
      await super.stop(true);
      const captionOptions = this.__tiplayCaptions.options();
      const result = await super.load(source, { ...options, formatOptions: { ...options.formatOptions, ...captionOptions } });
      this.__tiplayCaptions.loaded();
      return result;
    })();
  }
  play(...args) { return this.__tiplayPlaying = super.play(...args); }
  pause(...args) { this.__tiplayCaptions.pause(); return super.pause(...args); }
  async seek(...args) {
      // Native seek returns without touching demux for these states; do not
      // await an epoch barrier the worker will never produce.
      if (this.getStatus() === 9 || this.isLive_ || !this.getStreams().length) return super.seek(...args);
      const ticket = this.__tiplayCaptions.seek();
      try { const result = await super.seek(...args); this.__tiplayCaptions.finishSeek(ticket); return result; }
      catch (error) { this.__tiplayCaptions.finishSeek(ticket, true); throw error; }
  }
    async selectVideo(...args) { const result = await super.selectVideo(...args); this.__tiplayCaptions.videoSelected(); return result; }
  getEmbeddedSubtitleList() { return this.__tiplayCaptions.list(); }
  getEmbeddedCaptionDiagnostics() { return this.__tiplayCaptions.diagnostics(); }
  selectEmbeddedSubtitle(id) { return this.__tiplayCaptions.select(id); }
  __tiplaySetNativeSubtitleEnable(value) { return super.setSubtitleEnable(value); }
  setSubtitleEnable(value) { if (!this.__tiplayCaptions.enable(value)) return super.setSubtitleEnable(value); }
  async selectSubtitle(...args) {
    this.__tiplayCaptions.native();
    super.setSubtitleEnable(true);
    return super.selectSubtitle(...args);
  }
  stop(...args) { this.__tiplayCaptions?.stop(); return super.stop(...args); }
  destroy() {
    return this.__tiplayDestroying ||= (async () => {
      this.__tiplayCaptions.destroy();
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
