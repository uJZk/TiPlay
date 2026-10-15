// SPDX-License-Identifier: GPL-3.0-only
import { VERSION, MediaAttachMixin, HTMLVideoAdapter } from './vendor/videojs/player.min.js';
import { createVideoCaptions } from './airplay-captions.js';
import { createMediaEngine } from './airplay-media.js';
import { createMediaTextTracks } from './airplay-text-tracks.js';
import { fetchSdrMediaResource } from './airplay-sdr.js';

/** Register a native-like media surface with Video.js; TiPlay owns its clock and output. */
class TiPlayMedia extends MediaAttachMixin(HTMLElement) {
  getMediaTarget() { return this.adapter; }
  initialize(engine) {
    this.engine = engine;
    this.adapter = new HTMLVideoAdapter();
    Object.defineProperty(this.adapter, 'audioTracks', { get: () => engine.audioTracks });
    this.adapter.attach(engine);
  }
}
// Use the official adapter's public surface rather than a second media element/clock.
for (let prototype = HTMLVideoAdapter.prototype; prototype !== EventTarget.prototype; prototype = Object.getPrototypeOf(prototype)) {
  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name in TiPlayMedia.prototype || ['constructor', 'attach', 'detach', 'destroy'].includes(name)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    Object.defineProperty(TiPlayMedia.prototype, name, descriptor.get ? {
      get() { return this.adapter?.[name]; },
      ...(descriptor.set ? { set(value) { this.adapter[name] = value; } } : {}),
    } : { value(...args) { return this.adapter[name](...args); } });
  }
}
customElements.define('tiplay-media', TiPlayMedia);
let playerSequence = 0;

/** TiPlay's control layout, composed from Video.js v10 elements. */
export function createVideoPlayer(layer, { lang, stop, stopText, fetchResource, signal, onCanvasError }) {
  const captionsMenu = `tiplay-captions-${++playerSequence}`;
  const audioMenu = `tiplay-audio-${playerSequence}`;
  const locale = document.createElement('media-i18n');
  locale.lang = lang === 'zh' ? 'zh-CN' : 'en';
  locale.innerHTML = `<video-player data-version="${VERSION}"><media-container class="media-skin video-skin" data-theme="neutral" data-preset="video">
    <media-buffering-indicator class="media-buffering-indicator"><media-icon family="neutral" name="spinner" class="media-buffering-indicator-spinner-icon"></media-icon></media-buffering-indicator>
    <media-controls><media-controls-content><div class="airplay-control-bar">
      <media-play-button class="media-button media-play-button"><media-icon family="neutral" name="restart" class="media-button-icon media-play-button-restart-icon"></media-icon><media-icon family="neutral" name="play" class="media-button-icon media-play-button-play-icon"></media-icon><media-icon family="neutral" name="pause" class="media-button-icon media-play-button-pause-icon"></media-icon></media-play-button>
      <media-time type="current"></media-time>
      <media-time-slider class="media-slider media-time-slider"><media-slider-track class="media-slider-track"><media-slider-buffer class="media-slider-buffer"></media-slider-buffer><media-slider-fill class="media-slider-fill"></media-slider-fill></media-slider-track><media-slider-thumb class="media-slider-thumb"></media-slider-thumb></media-time-slider>
      <media-time type="duration"></media-time>
      <media-playback-rate-button class="media-button airplay-rate"></media-playback-rate-button>
      <media-captions-button data-available="false" menu-for="${captionsMenu}" class="media-button media-captions-button"><media-icon family="neutral" name="captions-off" class="media-button-icon media-captions-button-off-icon"></media-icon><media-icon family="neutral" name="captions-on" class="media-button-icon media-captions-button-on-icon"></media-icon></media-captions-button>
      <media-menu id="${captionsMenu}" side="top" align="end" class="media-popup media-popup-surface media-menu-popup"><media-menu-content class="media-menu-content"><media-captions-radio-group class="media-menu-radio-group"><template><media-menu-radio-item class="media-menu-radio-item"><span data-part="label"></span><media-menu-item-indicator force-mount class="media-menu-item-indicator"><media-icon family="neutral" name="check" class="media-menu-radio-item-icon"></media-icon></media-menu-item-indicator></media-menu-radio-item></template></media-captions-radio-group></media-menu-content></media-menu>
      <button data-available="false" type="button" commandfor="${audioMenu}" command="toggle" class="media-button airplay-audio" aria-label="${lang === 'zh' ? '音轨' : 'Audio tracks'}">♫</button>
      <media-menu id="${audioMenu}" side="top" align="end" class="media-popup media-popup-surface media-menu-popup"><media-menu-content class="media-menu-content"><media-audio-track-radio-group class="media-menu-radio-group"><template><media-menu-radio-item class="media-menu-radio-item"><span data-part="label"></span><media-menu-item-indicator force-mount class="media-menu-item-indicator"><media-icon family="neutral" name="check" class="media-menu-radio-item-icon"></media-icon></media-menu-item-indicator></media-menu-radio-item></template></media-audio-track-radio-group></media-menu-content></media-menu>
      <button class="media-button airplay-stop" type="button"><svg class="media-button-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor"/></svg></button>
    </div></media-controls-content></media-controls>
    <p class="airplay-error" role="alert" hidden></p>
  </media-container></video-player>`;
  const element = locale.querySelector('video-player');
  const surface = locale.querySelector('media-container');
  const elementMedia = document.createElement('tiplay-media');
  let subtitles, disposed = false, sourceSerial = 0;
  const media = createMediaEngine(surface, { fetchResource, signal, onCanvasError,
    onClock: time => subtitles?.update(time),
    languages: [lang, ...(globalThis.navigator?.languages || [])],
    onCaptionPacket: (...args) => subtitles?.appendCaptionPacket?.(...args),
    onCaptionReset: position => subtitles?.resetCaptionDecoder?.(position),
    onResource: (url, response, origin) => subtitles?.inspectMediaResource?.(url, response, { origin }),
    onTimeline: timeline => subtitles?.setMediaOrigin?.(timeline.origin),
    onResync: (src, type) => { void subtitles?.load(src, type, { mediaOrigin: () => media.timestampOrigin }).catch(() => {}); },
  });
  media.querySelectorAll = selectors => elementMedia.querySelectorAll(selectors);
  media.querySelector = selectors => elementMedia.querySelector(selectors);
  subtitles = createMediaTextTracks({ fetchResource: (url, init) => fetchSdrMediaResource(fetchResource || fetch, url, init, { signal }), signal });
  Object.defineProperty(media, 'textTracks', { get: () => subtitles.tracks });
  media.addTextTrack = (...args) => subtitles.addTextTrack(...args);
  elementMedia.initialize(media);
  surface.prepend(elementMedia);
  const captionClock = () => subtitles.update(media.currentTime);
  for (const type of ['timeupdate', 'seeked', 'loadeddata']) media.addEventListener(type, captionClock);
  const end = locale.querySelector('.airplay-stop');
  end.setAttribute('aria-label', stopText); end.title = stopText;
  end.addEventListener('click', stop);
  layer.append(locale);
  const captions = createVideoCaptions(media, surface);
  const menu = locale.querySelector('media-menu');
  const subtitleButton = locale.querySelector('media-captions-button');
  const audioButton = locale.querySelector('.airplay-audio');
  const syncMenus = () => {
    subtitleButton.dataset.available = String([...subtitles.tracks].some(track => ['subtitles', 'captions'].includes(track.kind) && !track.error && (track.supported || track.cues?.length > 0)));
    audioButton.dataset.available = String(media.audioTracks.length > 1);
  };
  for (const type of ['addtrack', 'removetrack', 'change', 'load']) subtitles.tracks.addEventListener(type, syncMenus);
  for (const type of ['addtrack', 'removetrack', 'change']) media.audioTracks.addEventListener(type, syncMenus);
  // v10 adds commandfor only once a second track appears; rediscover the native menu trigger.
  const menuTrigger = new MutationObserver(() => menu.requestUpdate());
  menuTrigger.observe(locale.querySelector('media-captions-button'), { attributes: true, attributeFilter: ['commandfor'] });
  let failure = null;
  return {
    element, surface, media,
    error: () => failure || media.error,
    fail(message) {
      failure = { message };
      media.pause();
      const error = locale.querySelector('.airplay-error');
      error.textContent = message; error.hidden = false;
    },
    async source(src, type) {
      const serial = ++sourceSerial;
      subtitles.clear();
      // Install the caption session before the demuxer starts fetching init/segment resources.
      const subtitleLoading = subtitles.load(src, type, { mediaOrigin: () => media.timestampOrigin });
      void subtitleLoading.catch(() => {});
      await media.load(src, type);
      if (!disposed && serial === sourceSerial && !signal?.aborted) {
        // Independent discovery cannot hold video preparation or iPhone directives hostage.
        void subtitleLoading.then(() => {
          if (!disposed && serial === sourceSerial) { captionClock(); syncMenus(); }
        }, () => {
          if (!disposed && serial === sourceSerial && !signal?.aborted) subtitles.tracks.dispatchEvent(new Event('error'));
        });
      }
      syncMenus();
    },
    dispose() {
      if (disposed) return;
      disposed = true; sourceSerial++;
      menuTrigger.disconnect();
      for (const type of ['addtrack', 'removetrack', 'change', 'load']) subtitles.tracks.removeEventListener(type, syncMenus);
      for (const type of ['addtrack', 'removetrack', 'change']) media.audioTracks.removeEventListener(type, syncMenus);
      captions.dispose();
      subtitles.dispose();
      for (const type of ['timeupdate', 'seeked', 'loadeddata']) media.removeEventListener(type, captionClock);
      media.dispose(); elementMedia.adapter.destroy();
      locale.remove();
    },
  };
}
