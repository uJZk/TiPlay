# Browser link end-to-end check

`run.mjs` opens `site/play/` in headless Chromium against `fake-phone.mjs`, a Node stand-in for the phone's HTTP
server (protocol v1: `/hello`, `/video`, `/control`, `/bye`, CORS preflights). CI does not run it.

It serves the page from `http://127.0.0.1` under a nested path, which is a secure context, so WebCodecs and the
Service Worker work without HTTPS. As on GitHub Pages, the page is the root of that path and a download page lives
beside it in `download/`. The Chromium used for the recorded checks decodes VP8 and VP9 but not H.264; codec support can differ by build. The fake phone streams VP8
with optional synthetic frame timing records.
The page does not assume H.264 or HEVC; it configures `VideoDecoder` with whatever codec string the config record names.

## Requirements

- Node 22.
- `playwright-core`, installed anywhere. Do not add it to this repository.
- A Chromium build. Set `CHROMIUM` to its executable; the default is `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- Optional: `ffmpeg` with libvpx (set `FFMPEG` if it is not on `PATH`). Without libvpx, or with
  `E2E_VP8=browser`, the script encodes the VP8 clip with the browser's own `VideoEncoder`.

## Run

```sh
npm install --prefix /tmp/pw playwright-core
NODE_PATH=/tmp/pw/node_modules node tests/web-e2e/run.mjs
```

Each check prints one `ok -` line, and the script ends with `all checks passed` or `FAILED: <reason>` (exit code 1).
Both scripts launch Chromium with `--no-proxy-server`: their loopback and LAN HTTP servers must be reached directly,
even when the environment configures a system proxy.

## What it checks

1. The page decodes frames: the fake phone receives `dec` for epoch 1, and `tiplayStats` shows `decodedFps > 0`.
2. The link fragment is stored and removed from the address, and the stats never contain the pairing code.
3. A `vp` event matches the video area (CSS × DPR, rounded to even), and the canvas backing store has the size of
   the video area in device pixels (a page that connects before its decoder is ready must still size it).
4. A tap at 25 % / 75 % of the letterboxed picture arrives as touch `[0, 0.25, 0.75, 1]` and then `[0, 0.25, 0.75, 0]`.
5. A `st` stats event arrives within 8 s.
6. After the fake phone drops `/video` without an end record, the page reconnects, decodes again and repeats its
   viewport. After a garbage key frame the decoder fails; the page asks for a key frame and decodes again.
7. "Apply and reconnect" appears when `status.fit` is true, and clicking it sends `{"k":"fit"}`.
8. A `zh-CN` browser gets the Chinese page.
9. The default phone (`100.109.220.253:8080`) leaves only the page address in the address bar, another phone keeps
   `?t=`, a link with a code and no `?t=` is for the default phone even after another one was saved, and the bare page
   address keeps the saved phone. These run on `http://page.localhost`: the page treats a plain-HTTP IPv4 origin as the
   phone's own copy, and a `*.localhost` name as the public page.
10. Each fallback rung decodes and maps a tap, with one feature taken away per run: `worker-chunks` (streams not
    transferable), `worker-frames` (no `OffscreenCanvas`) and `main` (no `VideoDecoder` in workers). Each run takes
    the display over, and the first page says so and stops instead of taking it back.
11. The page's Service Worker, whose scope is the site root, controls the download page but answers none of its
    requests; with the page server stopped the download page does not open.
12. With the page server stopped, a reload and the pairing link (with `#c=`) are served by the Service Worker and decode
    again.
13. Plain HTTP on a non-loopback LAN address disables Connect and names the secure WebCodecs requirement;
    no `<video>` element or MSE/fMP4 playback path remains.
14. The Debug switch shows five fields at the top center, does not intercept touches or replace the video session,
    and hides the overlay when disabled. Worker-stream, worker-chunk, worker-frame and main-thread paths all collect
    rolling presentation FPS and synthetic timestamp-to-draw latency. Synthetic timestamps validate the plumbing,
    not an actual iPhone capture-to-screen measurement.
15. The picture starts at the top and fills the resized window without a header or fullscreen button. The TiPlay
    icon returns to the pairing portal; its Connect button, labeled **Return to CarPlay** while active,
    resumes the same video connection.
16. While reconnecting, **Setting** opens the portal, keeps the active address/code disabled and preserves the retry;
    returning to CarPlay does not replace it. The full-window reconnect surface blocks CarPlay input and keeps its
    logo centered and action reachable at desktop, portrait and short landscape sizes in light and dark modes.
    Recovery hides the surface after the first decoded frame.

These runs use a fake phone and local browser. They verify browser resize reporting and layout,
not the iPhone's replacement-display negotiation or real vehicle routing, recovery or presentation latency.

## Real phone side (`phone-run.mjs`)

`phone-run.mjs` checks the app's own phone side instead of the fake phone. `RealPhone.java` runs the compiled `:shared`
classes the way a phone + browser session wires them: `BrowserLinkServer` with an asset loader over the page directory
(as the app does over its bundled `assets/play/`), and a `WebVideoHub` fed through `VideoTeeMediaSink` → `WebMediaSink`
with an H.264 Annex-B clip. Headless Chromium then opens the page that this server serves. CI does not run it.

The secure-context run forces `VideoDecoder.isConfigSupported` to return unsupported
inside the worker, so the unsupported-H.264 message is checked independently of the
installed Chromium's codec support. The LAN run checks that non-secure contexts cannot start playback. The script then repeats with a
`VideoDecoder` stand-in inside the decoder worker that checks every chunk and outputs a plain frame.

### Requirements

- Node 22, `playwright-core` and Chromium as above; a JDK 17 or later as `java` (or set `JAVA`).
- The compiled `:shared` classes. Any Gradle build of the AGENTS.md CI set produces them; on their own:
  `./gradlew :shared:compileDebugKotlin`. Set `SHARED_CLASSES` if they are elsewhere.
- The Kotlin standard library of the version in `gradle/libs.versions.toml`, found in the Gradle cache (set
  `KOTLIN_STDLIB` to the jar otherwise).
- Optional: `ffmpeg` with libx264 for a real clip; without it `RealPhone.java` streams hand-made SPS/PPS and slices.
- `PAGE_DIR` serves another copy of the page, for example the APK's: `common/build/generated/assets/bundleDebugBrowserPage/play`.

### Run

```sh
NODE_PATH=/tmp/pw/node_modules node tests/web-e2e/phone-run.mjs
```

### What it checks

1. `GET /` answers `302` to `/play/`; the page's files have their types, `no-cache`, `nosniff` and the page policy;
   `/hello` keeps `no-store`; a foreign `Host` gets `421`.
2. Loopback (a secure context): `/` keeps `#c=` through the redirect, the page stores the code and removes the fragment,
   takes the Tesla path (worker), opens `/video` with the code, gets the config record (codec and canvas), says
   "This browser cannot decode H.264.", reports its viewport (CSS × DPR), sends a `/control` heartbeat every 400 ms and
   a stats event, and registers its Service Worker under the served policy.
3. The LAN address is not a secure context: Connect is disabled, the page explains the WebCodecs requirement,
   and no removed video element opens.
4. With the decoder stand-in: the page's `dec` reaches the session's diagnostic handler as `first frame rendered`; key
   frames arrive as SPS, PPS and IDR slices with 4-byte start codes; a tap at 25 % / 75 % reaches `onTouch` as both
   slots, normalized; the page's stats event has every field of the app's `Browser:` session log line;
   "Apply and reconnect" reaches `onFit`; after a decoder error the page's `kf` reaches the session's recovery handler;
   after a new session (the old tap closed, and its screen coming up late) the page decodes the new session's epoch;
   leaving the page sends `/bye`.
5. The page from another origin (a static server with the page at its root, as the car opens the public HTTPS page)
   with `?t=`: it decodes a new session and its `dec` reaches that session, the phone echoes the page's origin with
   `Vary: Origin` and `no-store` on `/hello`, `/video` and `/control`, and a tap reaches `onTouch`.
6. In every run: all requests go to the page's own origin (the phone's, for the page the phone serves), only `/video`
   carries the code in its URL, no request sends a `Referer`, there are no CSP violations or page errors, and the phone
   never answers busy. The phone side never logs the code or a page session id.

The script removes its Playwright request routes before it leaves the page: Playwright's interception can drop a
`keepalive` request of a page that is going away, which looked like a lost `/bye`.

