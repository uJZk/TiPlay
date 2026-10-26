// SPDX-License-Identifier: GPL-3.0-only
import { VERSION, MediaAttachMixin, HTMLVideoAdapter } from './vendor/videojs/player.min.js';
import { createMediaEngine } from './airplay-media.js';
import { createAirPlayAudioMedia } from './airplay-audio-player.js';

/** Register AVPlayer's native-like facade with Video.js controls. */
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

const stopButtonMarkup = `<button class="media-button airplay-stop" type="button"><svg class="media-button-icon" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><path d="M4.2 2.8 9 7.6l4.8-4.8 1.4 1.4L10.4 9l4.8 4.8-1.4 1.4L9 10.4l-4.8 4.8-1.4-1.4L7.6 9 2.8 4.2z"/></svg></button>`;
const playButtonMarkup = `<media-play-button class="media-button media-play-button"><media-icon family="default" name="restart" class="media-button-icon media-play-button-restart-icon"></media-icon><media-icon family="default" name="play" class="media-button-icon media-play-button-play-icon"></media-icon><media-icon family="default" name="pause" class="media-button-icon media-play-button-pause-icon"></media-icon></media-play-button>`;

// All receiver surfaces use the existing official Video.js video toolbar.
// Capability changes hide/disable controls without restyling or relocating them.
function receiverControlsMarkup({ lang, audio = false } = {}) {
  const captionsMenu = `tiplay-captions-${++playerSequence}`;
  const audioMenu = `tiplay-audio-${playerSequence}`;
  return `    <media-buffering-indicator class="media-buffering-indicator"><media-icon family="default" name="spinner" class="media-buffering-indicator-spinner-icon"></media-icon></media-buffering-indicator>
    <media-controls><media-controls-backdrop class="video-controls-backdrop"></media-controls-backdrop><media-controls-content class="video-controls video-controls-content"><media-controls-group class="video-controls-primary">
      ${audio ? `<button class="media-button airplay-previous" type="button" disabled aria-label="${lang === 'zh' ? '上一首' : 'Previous track'}" title="${lang === 'zh' ? '上一首' : 'Previous track'}"><svg class="media-button-icon" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><path d="M3 3h2v12H3zm12 0v12L6 9z"/></svg></button>` : ''}
      ${playButtonMarkup}
      ${audio ? `<button class="media-button airplay-next" type="button" disabled aria-label="${lang === 'zh' ? '下一首' : 'Next track'}" title="${lang === 'zh' ? '下一首' : 'Next track'}"><svg class="media-button-icon" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><path d="M13 3h2v12h-2zM3 3l9 6-9 6z"/></svg></button>` : ''}
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
      ${stopButtonMarkup}
    </media-controls-group></media-controls-content></media-controls>
    <media-gesture type="tap" action="toggleControls"></media-gesture>
    <media-status-announcer class="media-status-announcer"></media-status-announcer>
`;
}

function createReceiverShell(layer, { lang, stop, stopText, media }, kind, content) {
  const locale = document.createElement('media-i18n');
  locale.lang = lang === 'zh' ? 'zh-CN' : 'en';
  locale.innerHTML = `<video-player data-version="${VERSION}"><media-container class="media-skin media-container video-skin airplay-${kind}-surface" data-theme="default" data-preset="video">${content}</media-container></video-player>`;
  const element = locale.querySelector('video-player'), surface = locale.querySelector('media-container');
  const elementMedia = document.createElement('tiplay-media');
  elementMedia.initialize(media); surface.prepend(elementMedia);
  const end = surface.querySelector('.airplay-stop');
  end.setAttribute('aria-label', stopText); end.title = stopText;
  end.addEventListener('click', stop); layer.append(locale);
  let disposed = false;
  return { element, surface, locale, dispose() {
    if (disposed) return; disposed = true;
    end.removeEventListener('click', stop); elementMedia.adapter.destroy(); locale.remove();
  } };
}

/** Full-screen now playing, attached to the receiver's existing audio transport.
 * Official Video.js controls share a snapshot facade, never a second media clock. */
export function createAudioPlayer(layer, { lang = 'en', stop = () => {},
  stopText = lang === 'zh' ? '结束投放' : 'Stop casting', media: suppliedMedia, onPlay, onPause, onSeek, onPrevious, onNext, onSkipBack, onSkipForward } = {}) {
  const media = suppliedMedia || createAirPlayAudioMedia({ onPlay, onPause, onSeek, onPrevious, onNext, onSkipBack, onSkipForward });
  const player = createReceiverShell(layer, { lang, stop, stopText, media }, 'audio', `
    <div class="airplay-now-playing">
      <img class="airplay-artwork-background" alt="" hidden referrerpolicy="no-referrer">
      <div class="airplay-now-playing-content">
        <div class="airplay-artwork-frame">
          <img class="airplay-artwork" alt="" hidden referrerpolicy="no-referrer">
          <div class="airplay-artwork-placeholder" aria-hidden="true"><svg viewBox="0 0 64 64" fill="currentColor"><path d="M43 9v32a10 10 0 1 1-5-8.66V19l-17 4v25a10 10 0 1 1-5-8.66V16z"/></svg></div>
        </div>
        <div class="airplay-audio-details">
          <h1 class="airplay-audio-title"></h1>
          <p class="airplay-audio-artist" hidden></p>
          <p class="airplay-error" role="alert" hidden></p>
        </div>
      </div>
    </div>${receiverControlsMarkup({ lang, audio: true })}`);
  const title = player.surface.querySelector('.airplay-audio-title');
  const artist = player.surface.querySelector('.airplay-audio-artist');
  const artwork = player.surface.querySelector('.airplay-artwork');
  const background = player.surface.querySelector('.airplay-artwork-background');
  const placeholder = player.surface.querySelector('.airplay-artwork-placeholder');
  const playButton = player.surface.querySelector('media-play-button');
  const slider = player.surface.querySelector('media-time-slider');
  const progress = player.surface.querySelector('.video-time-slider-group');
  const skipBackButton = player.surface.querySelector('media-seek-button[seconds="-10"]');
  const skipForwardButton = player.surface.querySelector('media-seek-button[seconds="10"]');
  const previousButton = player.surface.querySelector('.airplay-previous');
  const nextButton = player.surface.querySelector('.airplay-next');
  player.surface.querySelector('media-playback-rate-button').hidden = true;
  const errorLabel = player.surface.querySelector('.airplay-error');
  let disposed = false, ownedArtwork = null, artworkSource, failure = null;
  const command = (name, capability) => {
    if (disposed || media[capability] !== true || typeof media[name] !== 'function') return;
    try { void Promise.resolve(media[name]()).catch(() => {}); } catch (_) {}
  };
  const previous = () => command('previous', 'canPrevious');
  const next = () => command('next', 'canNext');
  const skip = (event, name, capability) => {
    // Keep the official Video.js button, but the receiver owns relative skips.
    // Its live sender position can differ from the latest browser snapshot.
    event.preventDefault(); event.stopImmediatePropagation(); command(name, capability);
  };
  const skipBack = event => skip(event, 'skipBack', 'canSkipBack');
  const skipForward = event => skip(event, 'skipForward', 'canSkipForward');
  previousButton.addEventListener('click', previous); nextButton.addEventListener('click', next);
  skipBackButton.addEventListener('click', skipBack, true); skipForwardButton.addEventListener('click', skipForward, true);
  const text = (element, value) => {
    element.textContent = typeof value === 'string' ? value : ''; element.title = element.textContent; element.hidden = !element.textContent;
  };
  const noArtwork = () => { artwork.hidden = background.hidden = true; placeholder.hidden = false; };
  artwork.addEventListener('error', noArtwork);
  artwork.addEventListener('load', () => { if (!disposed && artwork.getAttribute('src')) {
    artwork.hidden = background.hidden = false; placeholder.hidden = true;
  } });
  function update(next = {}) {
    if (disposed) return;
    media.update?.(next);
    text(title, next.title || (lang === 'zh' ? 'AirPlay 音频' : 'AirPlay audio'));
    text(artist, typeof next.artist === 'string' ? next.artist.trim() : '');
    const source = next.artworkURL ?? next.artwork ?? null;
    if (source !== artworkSource) {
      artworkSource = source; noArtwork();
      artwork.removeAttribute('src'); background.removeAttribute('src');
      if (ownedArtwork) URL.revokeObjectURL(ownedArtwork); ownedArtwork = null;
      let url = '';
      if (source instanceof Blob) url = ownedArtwork = URL.createObjectURL(source);
      else if (typeof source === 'string' && /^(blob:|https?:|data:image\/(?:png|jpeg|webp|gif);)/i.test(source)) url = source;
      if (url) { artwork.src = url; background.src = url; }
    }
    const canControl = media.paused ? next.canPlay ?? next.canPause : next.canPause;
    playButton.toggleAttribute('disabled', canControl !== true); playButton.setAttribute('aria-disabled', String(canControl !== true));
    const canSeek = next.seekable === true && media.seekable.length > 0;
    slider.toggleAttribute('disabled', !canSeek); slider.setAttribute('aria-disabled', String(!canSeek));
    progress.hidden = !(media.duration > 0);
    for (const [button, supported] of [[skipBackButton, media.canSkipBack === true], [skipForwardButton, media.canSkipForward === true]]) {
      button.toggleAttribute('disabled', !supported); button.setAttribute('aria-disabled', String(!supported));
    }
    previousButton.disabled = media.canPrevious !== true; nextButton.disabled = media.canNext !== true;
    previousButton.setAttribute('aria-disabled', String(previousButton.disabled)); nextButton.setAttribute('aria-disabled', String(nextButton.disabled));
    failure = next.error ? { message: String(next.error.message || next.error) } : null;
    text(errorLabel, failure?.message);
  }
  update();
  return { element: player.element, surface: player.surface, media, update,
    error: () => failure || media.error,
    fail(message) { failure = { message }; text(errorLabel, message); },
    dispose() {
      if (disposed) return; disposed = true; player.dispose();
      previousButton.removeEventListener('click', previous); nextButton.removeEventListener('click', next);
      skipBackButton.removeEventListener('click', skipBack, true); skipForwardButton.removeEventListener('click', skipForward, true);
      artwork.removeAttribute('src'); background.removeAttribute('src');
      if (ownedArtwork) URL.revokeObjectURL(ownedArtwork); ownedArtwork = null;
      if (!suppliedMedia) media.dispose();
    },
  };
}

/** Photos share the official control shell, without playback or seek controls. */
export function createPhotoPlayer(layer, { lang = 'en', stop = () => {},
  stopText = lang === 'zh' ? '结束投放' : 'Stop casting' } = {}) {
  const media = createAirPlayAudioMedia();
  const shell = createReceiverShell(layer, { lang, stop, stopText, media }, 'photo', receiverControlsMarkup({ lang }));
  for (const control of shell.surface.querySelectorAll('media-play-button, media-seek-button, .video-time-slider-group, media-playback-rate-button')) control.hidden = true;
  let failure = null;
  return { element: shell.element, surface: shell.surface, error: () => failure,
    fail(message) {
      failure = { message }; let label = shell.surface.querySelector('.airplay-error');
      if (!label) { label = document.createElement('p'); label.className = 'airplay-error'; label.setAttribute('role', 'alert'); shell.surface.append(label); }
      label.textContent = message;
    },
    dispose() { shell.dispose(); media.dispose(); } };
}

/** Official Video.js default skin anatomy, with Canvas media and casting actions. */
export function createVideoPlayer(layer, { lang, stop, stopText, signal, onCanvasError, proxyOnly = false, proxyOrigin }) {
  const locale = document.createElement('media-i18n');
  locale.lang = lang === 'zh' ? 'zh-CN' : 'en';
  locale.innerHTML = `<video-player data-version="${VERSION}"><media-container class="media-skin media-container video-skin" data-theme="default" data-preset="video">
    ${receiverControlsMarkup({ lang })}
    <div class="video-status-indicators airplay-seek-feedback" aria-hidden="true">
      <media-seek-indicator class="media-seek-indicator"><media-icon family="default" name="chevron" class="media-seek-indicator-icon"></media-icon><media-seek-indicator-value class="media-seek-indicator-value"></media-seek-indicator-value></media-seek-indicator>
    </div>
    <p class="airplay-error" role="alert" hidden></p>
    <p class="airplay-gesture" role="status" hidden>${lang === 'zh' ? '点击播放以开始投屏' : 'Tap Play to start casting'}</p>
  </media-container></video-player>`;
  const element = locale.querySelector('video-player');
  const surface = locale.querySelector('media-container');
  const elementMedia = document.createElement('tiplay-media');
  let disposed = false, sourceSerial = 0;
  const media = createMediaEngine(surface, { signal, onCanvasError, proxyOnly, proxyOrigin,
    languages: [lang, ...(globalThis.navigator?.languages || [])],
  });
  media.querySelectorAll = selectors => elementMedia.querySelectorAll(selectors);
  media.querySelector = selectors => elementMedia.querySelector(selectors);
  elementMedia.initialize(media);
  surface.prepend(elementMedia);
  const playButton = surface.querySelector('media-play-button');
  const gestureHint = surface.querySelector('.airplay-gesture');
  const gestureLabel = lang === 'zh' ? '开始播放' : 'Start playback';
  let gestureLabelActive = false;
  const syncGesture = () => {
    const blocked = media.gestureRequired;
    surface.toggleAttribute('data-gesture-required', blocked);
    gestureHint.hidden = !blocked;
    if (blocked) {
      playButton.setAttribute('aria-label', gestureLabel); playButton.setAttribute('title', gestureLabel);
    } else if (gestureLabelActive) {
      const label = media.paused ? (lang === 'zh' ? '播放' : 'Play') : (lang === 'zh' ? '暂停' : 'Pause');
      playButton.setAttribute('aria-label', label); playButton.setAttribute('title', label);
    }
    gestureLabelActive = blocked;
  };
  const gestureEvents = ['play', 'pause', 'waiting', 'playing', 'progress', 'error'];
  for (const type of gestureEvents) media.addEventListener(type, syncGesture);
  const gesturePlay = event => {
    if (!event.isTrusted || !media.gestureRequired || !event.target.closest?.('media-play-button')) return;
    // Preserve the pending play intent: the existing button resumes the blocked clock
    // instead of toggling it to pause on the first trusted activation.
    event.preventDefault(); event.stopImmediatePropagation();
    void media.resumeFromGesture().catch(() => {});
  };
  surface.addEventListener('click', gesturePlay, true);
  const end = locale.querySelector('.airplay-stop');
  end.setAttribute('aria-label', stopText); end.title = stopText;
  end.addEventListener('click', stop);
  layer.append(locale);
  const menu = locale.querySelector('media-menu');
  const subtitleButton = locale.querySelector('media-captions-button');
  const audioButton = locale.querySelector('.airplay-audio');
  const rateButton = locale.querySelector('.airplay-rate');
  const syncMenus = () => {
    subtitleButton.dataset.available = String([...media.textTracks].some(track => ['subtitles', 'captions'].includes(track.kind) && !track.error && (track.supported || track.cues?.length > 0)));
    audioButton.dataset.available = String(media.audioTracks.length > 1);
    rateButton.dataset.available = String(!media.isLive);
  };
  for (const type of ['addtrack', 'removetrack', 'change', 'load']) media.textTracks.addEventListener(type, syncMenus);
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
    async source(src, type, sourceOptions) {
      const serial = ++sourceSerial;
      await media.load(src, type, sourceOptions);
      if (disposed || serial !== sourceSerial || signal?.aborted) return;
      syncMenus();
    },
    dispose() {
      if (disposed) return;
      disposed = true; sourceSerial++;
      menuTrigger.disconnect();
      for (const type of ['addtrack', 'removetrack', 'change', 'load']) media.textTracks.removeEventListener(type, syncMenus);
      for (const type of ['addtrack', 'removetrack', 'change']) media.audioTracks.removeEventListener(type, syncMenus);
      for (const type of gestureEvents) media.removeEventListener(type, syncGesture);
      surface.removeEventListener('click', gesturePlay, true);
      media.dispose(); elementMedia.adapter.destroy();
      locale.remove();
    },
  };
}
