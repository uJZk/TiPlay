/*! SPDX-License-Identifier: GPL-3.0-only
 * TiPlay page cache: once loaded, the page opens without internet access. The worker answers only requests for the
 * page's own files in ASSETS, with any query or fragment (the pairing link's #c=), from the cache. Its scope is the
 * page's directory, which is the root of the published site, so every other page there (the download pages under
 * download/) goes to the network untouched.
 * Requests to the phone (cross-origin, plain HTTP) are never answered here: a fetch re-issued from the worker might
 * not get the page's local-network and mixed-content treatment.
 *
 * Bump VERSION whenever a file in ASSETS changes; the new worker caches the new files and deletes older caches. */
const VERSION = 'v78';
const CACHE = `tiplay-play-${VERSION}`;
const ASSETS = ["./","aac-eld-software.js","aac-eld-worker.js","airplay-audio-decoder.js","airplay-audio-tracks.js","airplay-canvas.js","airplay-capabilities.js","airplay-caption-data.js","airplay-captions.js","airplay-controls.css","airplay-controls.js","airplay-diagnostics.js","airplay-fetch.js","airplay-media-state.js","airplay-media.js","airplay-photo.js","airplay-resource-fetch.js","airplay-sdr.js","airplay-subtitle-bmff.js","airplay-tempo.js","airplay-text-tracks.js","airplay-track-selection.js","airplay-trust.css","airplay-trust.js","app-version.js","app.js","appearance.js","audio-buffer-policy.js","audio-calibration-worker.js","audio-calibration.js","audio-device-clock.js","audio-output-clock.js","audio-pcm-stats.js","audio-playback-stats.js","audio-protocol.js","audio-source-clock.js","audio-worklet.js","audio.js","browser-diagnostics.js","browser-notice.js","clock-sync.js","continuous-audio.js","decoder-worker.js","delay-plan.js","fps-window.js","geolocation.js","icon.svg","index.html","link.js","location-notice.js","media-timing.js","pcm-timeline.js","playback-window.js","reconnect-wallpaper-blurred.png","reconnect.css","reconnect.js","rtc-diagnostics.js","rtc-pairing.js","streaming-resampler.js","style.css","transport.js","vendor/aac-eld/.gitattributes","vendor/aac-eld/MODIFICATIONS.txt","vendor/aac-eld/NOTICE","vendor/aac-eld/README.md","vendor/aac-eld/SHA256SUMS","vendor/aac-eld/aac-eld-source.zip","vendor/aac-eld/aac-eld.js","vendor/mediabunny/README.md","vendor/mediabunny/THIRD_PARTY_LICENSES.txt","vendor/mediabunny/mediabunny.min.js","vendor/mediabunny/mediabunny.min.js.LEGAL.txt","vendor/soxr/COPYING.LGPL","vendor/soxr/LICENCE","vendor/soxr/LICENSE.GPL-3.0","vendor/soxr/README.md","vendor/soxr/provenance.json","vendor/soxr/source/soxr-source.tar.gz","vendor/soxr/source/soxr-wrapper.c","vendor/soxr/source/tiplay.patch","vendor/soxr/source/wrap.py","vendor/soxr/soxr.asm.js","vendor/tssrp6a/LICENSE","vendor/tssrp6a/README.md","vendor/tssrp6a/crossEnvCrypto.js","vendor/tssrp6a/index.js","vendor/tssrp6a/package.json","vendor/tssrp6a/parameters.js","vendor/tssrp6a/routines.js","vendor/tssrp6a/serde.js","vendor/tssrp6a/session-client.js","vendor/tssrp6a/session-server.js","vendor/tssrp6a/utils.js","vendor/videojs/APACHE-2.0.txt","vendor/videojs/LICENSE","vendor/videojs/README.md","vendor/videojs/SKIN_LICENSES.txt","vendor/videojs/THIRD_PARTY_LICENSES.txt","vendor/videojs/player.min.js","vendor/videojs/player.min.js.LEGAL.txt","vendor/videojs/skin.min.css","video-diagnostics.js","video-pacing.js","video.js","videojs-player.js","webrtc-transport.js"];
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
