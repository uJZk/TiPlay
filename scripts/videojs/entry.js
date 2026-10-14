// SPDX-License-Identifier: GPL-3.0-only
import { createPlayer } from '@videojs/html';
import { videoFeatures } from '@videojs/html/video';
// Keep the native rate feature and controls, with the choices TiPlay supports.
const features = videoFeatures.map(feature => feature.name === 'playbackRate' ? {
  ...feature, state: context => ({ ...feature.state(context), playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2] }),
} : feature);
const { PlayerElement } = createPlayer({ features });
class TiPlayVideoPlayer extends PlayerElement { static tagName = 'video-player'; }
customElements.define('video-player', TiPlayVideoPlayer);
import '@videojs/html/ui/container';
import '@videojs/html/ui/controls';
import '@videojs/html/ui/controls-content';
import '@videojs/html/ui/play-button';
import '@videojs/html/ui/seek-button';
import '@videojs/html/ui/playback-rate-button';
import '@videojs/html/ui/captions-button';
import '@videojs/html/ui/captions-radio-group';
import '@videojs/html/ui/menu';
import '@videojs/html/ui/menu-content';
import '@videojs/html/ui/menu-radio-item';
import '@videojs/html/ui/menu-item-indicator';
import '@videojs/html/ui/time-slider';
import '@videojs/html/ui/slider-track';
import '@videojs/html/ui/slider-buffer';
import '@videojs/html/ui/slider-fill';
import '@videojs/html/ui/slider-thumb';
import '@videojs/html/ui/time';
import '@videojs/html/ui/buffering-indicator';
import { registerIcons } from '@videojs/html/icons/element/register';
import { playIcon, pauseIcon, restartIcon, captionsOffIcon, captionsOnIcon, spinnerIcon, checkIcon } from '@videojs/html/icons/neutral';
registerIcons('neutral', { play: playIcon, pause: pauseIcon, restart: restartIcon,
  'captions-off': captionsOffIcon, 'captions-on': captionsOnIcon, spinner: spinnerIcon, check: checkIcon });
import '@videojs/html/i18n';
import '@videojs/html/i18n/locales/zh-CN/register';
export { VERSION } from '@videojs/html';
export { MediaAttachMixin } from '@videojs/html';
export { HTMLVideoAdapter } from '@videojs/media/dom';
