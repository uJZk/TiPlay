/*! SPDX-License-Identifier: GPL-3.0-only
 * TiPlay page cache: once loaded, the page opens without internet access. The worker answers only requests for the
 * page's own files in ASSETS, with any query or fragment (the pairing link's #c=), from the cache. Its scope is the
 * page's directory, which is the root of the published site, so every other page there (the download pages under
 * download/) goes to the network untouched.
 * Requests to the phone (cross-origin, plain HTTP) are never answered here: a fetch re-issued from the worker might
 * not get the page's local-network and mixed-content treatment.
 *
 * Bump VERSION whenever a file in ASSETS changes. Persist client/cache ownership before takeover;
 * versioned module URLs keep Worker and Worklet imports on their original protocol until navigation.
 * Unmapped legacy clients reload instead of guessing a cache. Pairing URLs are never persisted. */
const VERSION = 'v122';
const CACHE = `tiplay-play-${VERSION}`;
const ASSETS = ["./","airplay-artwork.js","airplay-audio-decoder.js","airplay-audio-player.js","airplay-audio-tracks.js","airplay-capabilities.js","airplay-controls.css","airplay-controls.js","airplay-diagnostics.js","airplay-fetch-bridge.js","airplay-fetch.js","airplay-libav-worker.js","airplay-libav.js","airplay-media.js","airplay-now-playing.css","airplay-photo.js","airplay-sdr.js","airplay-track-menu.js","airplay-trust.css","airplay-trust.js","app-version.js","app.js","appearance.js","audio-buffer-policy.js","audio-device-clock.js","audio-evidence.js","audio-output-clock.js","audio-pcm-stats.js","audio-playback-stats.js","audio-protocol.js","audio-record-queue.js","audio-worklet.js","audio.js","browser-diagnostic-log.js","browser-diagnostics.js","browser-notice.js","clock-sync.js","decoder-worker.js","delay-plan.js","fps-window.js","geolocation.js","icon.svg","index.html","link.js","live-audio-software.js","location-notice.js","media-ranges.js","media-timing.js","neteq-audio.js","neteq.js","playback-window.js","receiver-presentation.js","reconnect-wallpaper-blurred.png","reconnect.css","reconnect.js","rtc-audio.js","rtc-diagnostics.js","rtc-pairing.js","rtc-video-receive.js","rtc-video.js","style.css","transport.js","vendor/captions/extractor.js","vendor/captions/parser.js","vendor/libav/libav-6.10.9.0-tiplay-simd.wasm.mjs","vendor/libav/libav-6.10.9.0-tiplay-simd.wasm.wasm","vendor/libav/libav-6.10.9.0-tiplay.wasm.mjs","vendor/libav/libav-6.10.9.0-tiplay.wasm.wasm","vendor/libav/libav.js","vendor/libmedia/163.avplayer.js","vendor/libmedia/182.avplayer.js","vendor/libmedia/195.avplayer.js","vendor/libmedia/199.avplayer.js","vendor/libmedia/239.avplayer.js","vendor/libmedia/248.avplayer.js","vendor/libmedia/26.avplayer.js","vendor/libmedia/261.avplayer.js","vendor/libmedia/272.avplayer.js","vendor/libmedia/325.avplayer.js","vendor/libmedia/33.avplayer.js","vendor/libmedia/384.avplayer.js","vendor/libmedia/43.avplayer.js","vendor/libmedia/462.avplayer.js","vendor/libmedia/502.avplayer.js","vendor/libmedia/573.avplayer.js","vendor/libmedia/630.avplayer.js","vendor/libmedia/641.avplayer.js","vendor/libmedia/735.avplayer.js","vendor/libmedia/747.avplayer.js","vendor/libmedia/749.avplayer.js","vendor/libmedia/790.avplayer.js","vendor/libmedia/794.avplayer.js","vendor/libmedia/850.avplayer.js","vendor/libmedia/881.avplayer.js","vendor/libmedia/932.avplayer.js","vendor/libmedia/943.avplayer.js","vendor/libmedia/956.avplayer.js","vendor/libmedia/961.avplayer.js","vendor/libmedia/97.avplayer.js","vendor/libmedia/991.avplayer.js","vendor/libmedia/AudioSourceWorkletProcessor2Worklet.js","vendor/libmedia/AudioSourceWorkletProcessorWorklet.js","vendor/libmedia/avplayer.js","vendor/libmedia/decode/aac.wasm","vendor/libmedia/decode/ac3.wasm","vendor/libmedia/decode/eac3.wasm","vendor/libmedia/decode/flac.wasm","vendor/libmedia/decode/mp3.wasm","vendor/libmedia/decode/opus.wasm","vendor/libmedia/decode/pcm.wasm","vendor/libmedia/decode/vorbis.wasm","vendor/libmedia/embedded-captions.js","vendor/libmedia/resample/resample.wasm","vendor/libmedia/stretchpitch/stretchpitch.wasm","vendor/libmedia/upstream.js","vendor/neteq/neteq.wasm","vendor/tssrp6a/crossEnvCrypto.js","vendor/tssrp6a/index.js","vendor/tssrp6a/parameters.js","vendor/tssrp6a/routines.js","vendor/tssrp6a/serde.js","vendor/tssrp6a/session-client.js","vendor/tssrp6a/session-server.js","vendor/tssrp6a/utils.js","vendor/videojs/player.min.js","vendor/videojs/skin.min.css","video-diagnostics.js","video.js","videojs-player.js","wasm/audio-core.js","wasm/audio-core.wasm","webrtc-transport.js"];
const OWN = new Set(ASSETS.map(path => new URL(path, self.location).href));

const ROOT = new URL('./', self.location);
const PIN_ROOT = new URL('__tiplay_cache__/', ROOT);
const OWNERS = 'tiplay-client-owners-v1';
const OWNER_ROOT = new URL('__tiplay_clients__/', ROOT);
const RESERVATION_MS = 60000;
const RETIRED = new URL('__retired__/' + VERSION, OWNER_ROOT);
let ownerStore, cleaning, retiredStore;
const cacheVersion = name => typeof name === 'string' && name.startsWith('tiplay-play-') &&
  /^[A-Za-z0-9._-]{1,96}$/.test(name.slice('tiplay-play-'.length));
function plainUrl(value) { const url = new URL(value); url.search = url.hash = ''; return url; }
function pageUrl(value) {
  const url = new URL(value);
  return url.origin === ROOT.origin && (url.pathname === ROOT.pathname || url.pathname === new URL('index.html', ROOT).pathname);
}
function pinnedUrl(value) {
  const url = new URL(value);
  if (url.origin !== ROOT.origin || !url.pathname.startsWith(PIN_ROOT.pathname)) return null;
  const suffix = url.pathname.slice(PIN_ROOT.pathname.length), slash = suffix.indexOf('/');
  if (slash < 1) return { invalid: true };
  const version = suffix.slice(0, slash), cache = 'tiplay-play-' + version;
  const asset = new URL(suffix.slice(slash + 1), ROOT);
  if (!cacheVersion(cache) || asset.origin !== ROOT.origin || !asset.pathname.startsWith(ROOT.pathname) ||
    asset.pathname.startsWith(PIN_ROOT.pathname)) return { invalid: true };
  return { cache, asset, url };
}
async function store() {
  return ownerStore ??= (async () => {
    const cache = await caches.open(OWNERS), records = new Map();
    for (const key of await cache.keys()) {
      try {
        const url = new URL(key.url);
        if (url.origin !== ROOT.origin || !url.pathname.startsWith(OWNER_ROOT.pathname)) continue;
        const id = url.pathname.slice(OWNER_ROOT.pathname.length);
        const record = await (await cache.match(key)).json();
        if (id && (record.blocked === true || cacheVersion(record.cache))) records.set(id, record);
      } catch (_) {}
    }
    return { cache, records };
  })();
}
async function pin(id, record, parent) {
  if (!id) return;
  const state = await store(), next = { ...record, ...(parent && parent !== id ? { parent } : {}) };
  const previous = state.records.get(id);
  if (JSON.stringify(previous) === JSON.stringify(next)) return;
  state.records.set(id, next);
  await state.cache.put(new URL(id, OWNER_ROOT), new Response(JSON.stringify(next), { headers: { 'Content-Type': 'application/json' } }));
}
async function retired() {
  return retiredStore ??= (async () => {
    const state = await store(), response = await state.cache.match(RETIRED);
    const record = response ? await response.json() : {};
    return new Set((Array.isArray(record.caches) ? record.caches : []).filter(name => cacheVersion(name) && name !== CACHE));
  })();
}
async function cleanup() {
  return cleaning ??= (async () => {
    const state = await store(), clients = await self.clients.matchAll({ type: 'all', includeUncontrolled: true });
    const live = new Set(clients.map(client => client.id)), referenced = new Set([CACHE]);
    let legacy = false;
    for (const [id, record] of state.records) {
      const pending = !record.confirmed && Number.isFinite(record.reservedUntil) && Date.now() < record.reservedUntil;
      const parent = pending && record.reservationType !== 'window' && record.parent &&
        (live.has(record.parent) || await self.clients.get(record.parent).catch(() => null));
      const reserved = pending &&
        (record.reservationType === 'window' || !record.parent || parent);
      // clients.get can wait for a reserved navigation/worker to become ready;
      // awaiting it in activate would block that very navigation/worker fetch.
      const client = live.has(id) || (record.confirmed && await self.clients.get(id).catch(() => null));
      if (!client && !reserved) {
        state.records.delete(id); await state.cache.delete(new URL(id, OWNER_ROOT));
      } else {
        if (client && !record.confirmed) await pin(id, { ...record, confirmed: true }, record.parent);
        if (record.blocked) legacy = true;
        else referenced.add(record.cache);
      }
    }
    for (const client of clients) {
      const pinned = pinnedUrl(client.url);
      if (pinned && !pinned.invalid) referenced.add(pinned.cache);
    }
    // An older active worker must never delete a cache a newer worker is installing.
    // Only caches observed before this worker's activation belong to its GC scope.
    if (!legacy) for (const name of await retired()) if (!referenced.has(name)) await caches.delete(name);
  })().finally(() => { cleaning = null; });
}
function unavailable() {
  return new Response('TiPlay cached resources unavailable; reload this page.',
    { status: 503, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
}
async function cachedAsset(cacheName, asset) {
  if (!(await caches.keys()).includes(cacheName)) return unavailable();
  const cached = await (await caches.open(cacheName)).match(asset.href, { ignoreSearch: true });
  if (!cached) return unavailable();
  // Cached Response.url is the original unversioned URL. An empty response URL
  // makes module import.meta.url and relative imports inherit the pinned request URL.
  const headers = new Headers(cached.headers);
  headers.delete('Content-Encoding'); headers.delete('Content-Length');
  return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
}
self.addEventListener('install', event => {
  const requests = ASSETS.map(path => new Request(path, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(requests)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const old = (await caches.keys()).filter(name => cacheVersion(name) && name !== CACHE);
    const state = await store(), clients = await self.clients.matchAll({ type: 'all', includeUncontrolled: true });
    const history = await retired(); old.forEach(name => history.add(name));
    await state.cache.put(RETIRED, new Response(JSON.stringify({ caches: [...history] }), { headers: { 'Content-Type': 'application/json' } }));
    const migrating = old.length || clients.some(client => {
      const owner = state.records.get(client.id); return owner && owner.cache !== CACHE;
    });
    if (migrating) {
      for (const client of clients) {
        if (state.records.has(client.id)) continue;
        const pinned = pinnedUrl(client.url);
        if (pinned && !pinned.invalid && (await caches.keys()).includes(pinned.cache)) await pin(client.id, { cache: pinned.cache, confirmed: true });
        else if (pageUrl(client.url) || OWN.has(plainUrl(client.url).href)) await pin(client.id, { blocked: true, confirmed: true });
      }
      // Never wait for navigation in activate: its fetch waits for activation.
      // Durable pins keep old protocols isolated even if this worker stops here.
      const pages = clients.filter(client => client.type === 'window' && pageUrl(client.url) && state.records.get(client.id)?.cache !== CACHE);
      void Promise.allSettled(pages.map(client => client.navigate(client.url))).then(cleanup).catch(() => {});
    }
    await cleanup();
  })());
});
async function respond(event, pinned, plain) {
  const state = await store(), owner = state.records.get(event.clientId);
  if (!pinned && !OWN.has(plain.href)) {
    let previousAsset = false;
    for (const name of await caches.keys()) {
      if (!cacheVersion(name)) continue;
      if (await (await caches.open(name)).match(plain.href, { ignoreSearch: true })) { previousAsset = true; break; }
    }
    if (!previousAsset) return fetch(event.request);
  }
  if (event.request.mode === 'navigate' && pageUrl(plain)) {
    await pin(event.resultingClientId, { cache: CACHE, reservedUntil: Date.now() + RESERVATION_MS, reservationType: 'window' }, event.clientId);
    return cachedAsset(CACHE, plain);
  }
  if (owner?.blocked) return unavailable();
  if (pinned) {
    if (pinned.invalid) return unavailable();
    if (owner?.cache && owner.cache !== pinned.cache) return unavailable();
    await pin(event.resultingClientId, { cache: pinned.cache, reservedUntil: Date.now() + RESERVATION_MS, reservationType: 'worker' }, event.clientId);
    return cachedAsset(pinned.cache, pinned.asset);
  }
  if (!owner) {
    const client = event.clientId ? await self.clients.get(event.clientId) : null;
    if (client?.type === 'window' && pageUrl(client.url)) {
      await pin(client.id, { blocked: true, confirmed: true });
      void client.navigate(client.url).catch(() => {});
    }
    return unavailable();
  }
  const cache = owner.cache;
  if (!cacheVersion(cache) || !(await caches.keys()).includes(cache)) return unavailable();
  const version = cache.slice('tiplay-play-'.length);
  const target = new URL(version + '/' + plain.pathname.slice(ROOT.pathname.length), PIN_ROOT);
  target.search = new URL(event.request.url).search;
  await pin(event.resultingClientId, { cache, reservedUntil: Date.now() + RESERVATION_MS, reservationType: 'worker' }, event.clientId);
  return Response.redirect(target, 302);
}
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const plain = plainUrl(event.request.url), pinned = pinnedUrl(event.request.url);
  if (plain.origin !== ROOT.origin || !plain.pathname.startsWith(ROOT.pathname)) return;
  if (!pinned) {
    const path = plain.pathname.slice(ROOT.pathname.length);
    if (['chatgpt', 'download', 'play'].some(prefix => path === prefix || path.startsWith(prefix + '/')) ||
      path === 'sw.js' || path.split('/').includes('source') || /\.(?:zip|gz)$/.test(path) || path.endsWith('/') && path !== '') return;
  }
  event.respondWith(respond(event, pinned, plain));
  event.waitUntil(cleanup());
});
