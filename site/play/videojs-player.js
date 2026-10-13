// SPDX-License-Identifier: GPL-3.0-only
import { VERSION } from './vendor/videojs/player.min.js';
import { createVideoCaptions } from './airplay-captions.js';

/** TiPlay's control layout, composed from Video.js v10 elements. */
export function createVideoPlayer(layer, { hls, lang, stop, stopText }) {
  const locale = document.createElement('media-i18n');
  locale.lang = lang === 'zh' ? 'zh-CN' : 'en';
  locale.innerHTML = `<video-player data-version="${VERSION}"><media-container>
    <media-buffering-indicator><span></span></media-buffering-indicator>
    <media-controls><media-controls-content><div class="airplay-control-bar">
      <media-play-button><span class="play-icon" aria-hidden="true">▶︎</span><span class="pause-icon" aria-hidden="true">Ⅱ</span></media-play-button>
      <media-seek-button seconds="-10"><span aria-hidden="true">↶10</span></media-seek-button>
      <media-seek-button seconds="10"><span aria-hidden="true">10↷</span></media-seek-button>
      <media-time type="current"></media-time>
      <media-time-slider><media-slider-track><media-slider-buffer></media-slider-buffer><media-slider-fill></media-slider-fill></media-slider-track><media-slider-thumb></media-slider-thumb></media-time-slider>
      <media-time type="duration"></media-time>
      <media-captions-button><span aria-hidden="true">CC</span></media-captions-button>
      <div class="airplay-volume"><media-mute-button><span aria-hidden="true">♪</span></media-mute-button>
        <media-volume-slider><media-slider-track><media-slider-fill></media-slider-fill></media-slider-track><media-slider-thumb></media-slider-thumb></media-volume-slider></div>
      <button class="airplay-stop" type="button"></button>
    </div></media-controls-content></media-controls>
    <p class="airplay-error" role="alert" hidden></p>
  </media-container></video-player>`;
  const element = locale.querySelector('video-player');
  const surface = locale.querySelector('media-container');
  const media = document.createElement(hls ? 'hlsjs-video' : 'video');
  const video = hls ? media.target : media;
  for (const name of ['playsinline', 'disablepictureinpicture']) media.setAttribute(name, '');
  media.setAttribute('crossorigin', 'anonymous'); media.setAttribute('preload', 'auto');
  surface.prepend(media);
  const end = locale.querySelector('.airplay-stop');
  end.textContent = '■'; end.setAttribute('aria-label', stopText); end.title = stopText;
  end.addEventListener('click', stop);
  layer.append(locale);
  const captions = createVideoCaptions(video, surface);
  let failure = null;
  return {
    element, surface, media, video, volume: locale.querySelector('.airplay-volume'),
    error: () => failure || media.error,
    fail(message) {
      failure = { message };
      media.pause();
      const error = locale.querySelector('.airplay-error');
      error.textContent = message; error.hidden = false;
    },
    source(src, type) {
      if (hls) media.source = { src, type, preferPlayback: 'mse' };
      else video.src = src;
    },
    dispose() {
      captions.dispose();
      media.pause();
      locale.remove();
      // Removing the custom element destroys its engine; release progressive downloads too.
      video.removeAttribute('src'); video.load();
    },
  };
}
