/*! SPDX-License-Identifier: GPL-3.0-only
 * TiPlay page cache: once loaded, the page opens without internet access. The worker answers only requests for the
 * page's own files in ASSETS, with any query or fragment (the pairing link's #c=), from the cache. Its scope is the
 * page's directory, which is the root of the published site, so every other page there (the download pages under
 * download/) goes to the network untouched.
 * Requests to the phone (cross-origin, plain HTTP) are never answered here: a fetch re-issued from the worker might
 * not get the page's local-network and mixed-content treatment.
 *
 * Bump VERSION whenever a file in ASSETS changes; the new worker caches the new files and deletes older caches. */
const VERSION = 'v108';
const CACHE = `tiplay-play-${VERSION}`;
const ASSETS = ["./","airplay-artwork.js","airplay-audio-decoder.js","airplay-audio-player.js","airplay-audio-tracks.js","airplay-capabilities.js","airplay-controls.css","airplay-controls.js","airplay-diagnostics.js","airplay-fetch-bridge.js","airplay-fetch.js","airplay-libav-worker.js","airplay-libav.js","airplay-media.js","airplay-now-playing.css","airplay-photo.js","airplay-sdr.js","airplay-track-menu.js","airplay-trust.css","airplay-trust.js","app-version.js","app.js","appearance.js","audio-buffer-policy.js","audio-device-clock.js","audio-evidence.js","audio-output-clock.js","audio-pcm-stats.js","audio-playback-stats.js","audio-protocol.js","audio-record-queue.js","audio-worklet.js","audio.js","browser-diagnostic-log.js","browser-diagnostics.js","browser-notice.js","clock-sync.js","decoder-worker.js","delay-plan.js","fps-window.js","geolocation.js","icon.svg","index.html","link.js","live-audio-software.js","location-notice.js","media-ranges.js","media-timing.js","neteq-audio.js","neteq.js","playback-window.js","receiver-presentation.js","reconnect-wallpaper-blurred.png","reconnect.css","reconnect.js","rtc-audio.js","rtc-diagnostics.js","rtc-pairing.js","rtc-video-receive.js","rtc-video.js","style.css","transport.js","vendor/captions/extractor.js","vendor/captions/parser.js","vendor/libav/libav-6.10.9.0-tiplay-simd.wasm.mjs","vendor/libav/libav-6.10.9.0-tiplay-simd.wasm.wasm","vendor/libav/libav-6.10.9.0-tiplay.wasm.mjs","vendor/libav/libav-6.10.9.0-tiplay.wasm.wasm","vendor/libav/libav.js","vendor/libmedia/163.avplayer.js","vendor/libmedia/182.avplayer.js","vendor/libmedia/195.avplayer.js","vendor/libmedia/199.avplayer.js","vendor/libmedia/239.avplayer.js","vendor/libmedia/248.avplayer.js","vendor/libmedia/26.avplayer.js","vendor/libmedia/261.avplayer.js","vendor/libmedia/272.avplayer.js","vendor/libmedia/325.avplayer.js","vendor/libmedia/33.avplayer.js","vendor/libmedia/384.avplayer.js","vendor/libmedia/43.avplayer.js","vendor/libmedia/462.avplayer.js","vendor/libmedia/502.avplayer.js","vendor/libmedia/573.avplayer.js","vendor/libmedia/630.avplayer.js","vendor/libmedia/641.avplayer.js","vendor/libmedia/735.avplayer.js","vendor/libmedia/747.avplayer.js","vendor/libmedia/749.avplayer.js","vendor/libmedia/790.avplayer.js","vendor/libmedia/794.avplayer.js","vendor/libmedia/850.avplayer.js","vendor/libmedia/881.avplayer.js","vendor/libmedia/932.avplayer.js","vendor/libmedia/943.avplayer.js","vendor/libmedia/956.avplayer.js","vendor/libmedia/961.avplayer.js","vendor/libmedia/97.avplayer.js","vendor/libmedia/991.avplayer.js","vendor/libmedia/AudioSourceWorkletProcessor2Worklet.js","vendor/libmedia/AudioSourceWorkletProcessorWorklet.js","vendor/libmedia/avplayer.js","vendor/libmedia/decode/aac.wasm","vendor/libmedia/decode/ac3.wasm","vendor/libmedia/decode/eac3.wasm","vendor/libmedia/decode/flac.wasm","vendor/libmedia/decode/mp3.wasm","vendor/libmedia/decode/opus.wasm","vendor/libmedia/decode/pcm.wasm","vendor/libmedia/decode/vorbis.wasm","vendor/libmedia/embedded-captions.js","vendor/libmedia/resample/resample.wasm","vendor/libmedia/stretchpitch/stretchpitch.wasm","vendor/libmedia/upstream.js","vendor/neteq/neteq.wasm","vendor/tssrp6a/crossEnvCrypto.js","vendor/tssrp6a/index.js","vendor/tssrp6a/parameters.js","vendor/tssrp6a/routines.js","vendor/tssrp6a/serde.js","vendor/tssrp6a/session-client.js","vendor/tssrp6a/session-server.js","vendor/tssrp6a/utils.js","vendor/videojs/player.min.js","vendor/videojs/skin.min.css","video-diagnostics.js","video.js","videojs-player.js","wasm/audio-core.js","wasm/audio-core.wasm","webrtc-transport.js"];
const OWN = new Set(ASSETS.map(path => new URL(path, self.location).href));

self.addEventListener('install', event => {
  // Bypass the HTTP cache (GitHub Pages sends max-age=600) so a new version never stores older files.
  const requests = ASSETS.map(path => new Request(path, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(requests)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('tiplay-play-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  url.search = url.hash = '';
  if (!OWN.has(url.href)) return;
  event.respondWith(caches.open(CACHE)
    .then(cache => cache.match(request, { ignoreSearch: true }))
    .then(cached => cached ?? fetch(request)));
});
