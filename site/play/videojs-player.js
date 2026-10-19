// SPDX-License-Identifier: GPL-3.0-only
import { VERSION, MediaAttachMixin, HTMLVideoAdapter } from './vendor/videojs/player.min.js';
import { createVideoCaptions } from './airplay-captions.js';
import { createMediaEngine } from './airplay-media.js';
import { createMediaTextTracks } from './airplay-text-tracks.js';
import { fetchSdrMediaResource } from './airplay-sdr.js';
import { createSerialMediaFetch } from './airplay-resource-fetch.js';

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

/** Official Video.js default skin anatomy, with Canvas media and casting actions. */
export function createVideoPlayer(layer, { lang, stop, stopText, fetchResource, signal, onCanvasError }) {
  const captionsMenu = `tiplay-captions-${++playerSequence}`;
  const audioMenu = `tiplay-audio-${playerSequence}`;
  const locale = document.createElement('media-i18n');
  locale.lang = lang === 'zh' ? 'zh-CN' : 'en';
  locale.innerHTML = `<video-player data-version="${VERSION}"><media-container class="media-skin media-container video-skin" data-theme="default" data-preset="video">
    <media-buffering-indicator class="media-buffering-indicator"><media-icon family="default" name="spinner" class="media-buffering-indicator-spinner-icon"></media-icon></media-buffering-indicator>
    <media-controls><media-controls-backdrop class="video-controls-backdrop"></media-controls-backdrop><media-controls-content class="video-controls video-controls-content"><media-controls-group class="video-controls-primary">
      <media-play-button class="media-button media-play-button"><media-icon family="default" name="restart" class="media-button-icon media-play-button-restart-icon"></media-icon><media-icon family="default" name="play" class="media-button-icon media-play-button-play-icon"></media-icon><media-icon family="default" name="pause" class="media-button-icon media-play-button-pause-icon"></media-icon></media-play-button>
      <media-seek-button seconds="-10" class="media-button media-seek-button"><span class="media-seek-button-content"><media-icon family="default" name="seek" class="media-button-icon media-seek-button-backward-icon"></media-icon><span class="media-seek-button-label media-seek-button-backward-label" aria-hidden="true">10</span></span></media-seek-button>
      <media-seek-button seconds="10" class="media-button media-seek-button"><span class="media-seek-button-content"><media-icon family="default" name="seek" class="media-button-icon media-seek-button-forward-icon"></media-icon><span class="media-seek-button-label media-seek-button-forward-label" aria-hidden="true">10</span></span></media-seek-button>
      <media-controls-group class="video-time-slider-group"><media-time class="media-time-value video-time-value" type="current"></media-time>
      <media-time-slider class="media-slider media-time-slider"><media-slider-track class="media-slider-track"><media-slider-buffer class="media-slider-buffer"></media-slider-buffer><media-slider-fill class="media-slider-fill"></media-slider-fill></media-slider-track><media-slider-thumb class="media-slider-thumb media-time-slider-thumb"></media-slider-thumb></media-time-slider>
      <media-time class="media-time-value video-time-value" type="duration"></media-time></media-controls-group>
      <media-playback-rate-button class="media-button airplay-rate"></media-playback-rate-button>
      <media-captions-button data-available="false" menu-for="${captionsMenu}" class="media-button media-captions-button"><media-icon family="default" name="captions-off" class="media-button-icon media-captions-button-off-icon"></media-icon><media-icon family="default" name="captions-on" class="media-button-icon media-captions-button-on-icon"></media-icon></media-captions-button>
      <media-menu id="${captionsMenu}" side="top" align="end" class="media-popup media-popup-surface media-menu-popup"><media-menu-content class="media-menu-content"><media-captions-radio-group class="media-menu-radio-group"><template><media-menu-radio-item class="media-menu-radio-item"><span data-part="label"></span><media-menu-item-indicator force-mount class="media-menu-item-indicator"><media-icon family="default" name="check" class="media-menu-radio-item-icon"></media-icon></media-menu-item-indicator></media-menu-radio-item></template></media-captions-radio-group></media-menu-content></media-menu>
      <button data-available="false" type="button" commandfor="${audioMenu}" command="toggle" class="media-button airplay-audio" aria-label="${lang === 'zh' ? '音轨' : 'Audio tracks'}"><media-icon family="default" name="speech" class="media-button-icon"></media-icon></button>
      <media-menu id="${audioMenu}" side="top" align="end" class="media-popup media-popup-surface media-menu-popup"><media-menu-content class="media-menu-content"><media-audio-track-radio-group class="media-menu-radio-group"><template><media-menu-radio-item class="media-menu-radio-item"><span data-part="label"></span><media-menu-item-indicator force-mount class="media-menu-item-indicator"><media-icon family="default" name="check" class="media-menu-radio-item-icon"></media-icon></media-menu-item-indicator></media-menu-radio-item></template></media-audio-track-radio-group></media-menu-content></media-menu>
      <button class="media-button airplay-stop" type="button"><svg class="media-button-icon" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><path d="M4.2 2.8 9 7.6l4.8-4.8 1.4 1.4L10.4 9l4.8 4.8-1.4 1.4L9 10.4l-4.8 4.8-1.4-1.4L7.6 9 2.8 4.2z"/></svg></button>
    </media-controls-group></media-controls-content></media-controls>
    <media-gesture type="tap" action="toggleControls"></media-gesture>
    <media-status-announcer class="media-status-announcer"></media-status-announcer>
    <div class="video-status-indicators airplay-seek-feedback" aria-hidden="true">
      <media-seek-indicator class="media-seek-indicator"><media-icon family="default" name="chevron" class="media-seek-indicator-icon"></media-icon><media-seek-indicator-value class="media-seek-indicator-value"></media-seek-indicator-value></media-seek-indicator>
    </div>
    <p class="airplay-error" role="alert" hidden></p>
  </media-container></video-player>`;
  const element = locale.querySelector('video-player');
  const surface = locale.querySelector('media-container');
  const elementMedia = document.createElement('tiplay-media');
  let subtitles, disposed = false, sourceSerial = 0;
  const serialFetchResource = createSerialMediaFetch(fetchResource || fetch, { signal });
  const media = createMediaEngine(surface, { serialFetchResource, signal, onCanvasError,
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
  subtitles = createMediaTextTracks({ fetchResource: (url, init) => fetchSdrMediaResource(serialFetchResource, url, init, { signal, deadline: null }), signal });
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
      serialFetchResource.dispose();
      locale.remove();
    },
  };
}
