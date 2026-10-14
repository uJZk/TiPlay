/*! SPDX-License-Identifier: GPL-3.0-only
 * TiPlay page cache: once loaded, the page opens without internet access. The worker answers only requests for the
 * page's own files in ASSETS, with any query or fragment (the pairing link's #c=), from the cache. Its scope is the
 * page's directory, which is the root of the published site, so every other page there (the download pages under
 * download/) goes to the network untouched.
 * Requests to the phone (cross-origin, plain HTTP) are never answered here: a fetch re-issued from the worker might
 * not get the page's local-network and mixed-content treatment.
 *
 * Bump VERSION whenever a file in ASSETS changes; the new worker caches the new files and deletes older caches. */
const VERSION = 'v44';
const CACHE = `tiplay-play-${VERSION}`;
const ASSETS = ["./","airplay-canvas.js","airplay-captions.js","airplay-controls.css","airplay-controls.js","airplay-diagnostics.js","airplay-media-state.js","airplay-media.js","airplay-tempo.js","airplay-text-tracks.js","app.js","appearance.js","audio-protocol.js","audio-worklet.js","audio.js","clock-sync.js","decoder-worker.js","delay-plan.js","fps-window.js","icon.svg","index.html","link.js","media-timing.js","pcm-timeline.js","playback-window.js","reconnect-wallpaper-blurred.png","reconnect.css","reconnect.js","style.css","transport.js","vendor/mediabunny/README.md","vendor/mediabunny/THIRD_PARTY_LICENSES.txt","vendor/mediabunny/mediabunny.min.js","vendor/mediabunny/mediabunny.min.js.LEGAL.txt","vendor/videojs/APACHE-2.0.txt","vendor/videojs/LICENSE","vendor/videojs/README.md","vendor/videojs/SKIN_LICENSES.txt","vendor/videojs/THIRD_PARTY_LICENSES.txt","vendor/videojs/player.min.js","vendor/videojs/player.min.js.LEGAL.txt","vendor/videojs/skin.min.css","video.js","videojs-player.js"];
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
