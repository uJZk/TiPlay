# Browser link end-to-end check

`run.mjs` opens `site/play/` in headless Chromium against `fake-phone.mjs`, a Node stand-in for the phone's HTTP
server (protocol v1: `/hello`, `/video`, `/control`, `/bye`, CORS preflights). CI does not run it.

It serves the page from `http://127.0.0.1` under a nested path, which is a secure context, so WebCodecs and the
Service Worker work without HTTPS. As on GitHub Pages, the page is the root of that path and a download page lives
beside it in `download/`. The Chromium used for the recorded checks decodes VP8 and VP9 but not H.264; codec support can differ by build. The fake phone streams VP8
with optional synthetic source presentation timing records.
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
   address keeps the saved phone. These run on `http://page.localhost`, a secure page origin separate from the phone.
10. Each fallback rung decodes and maps a tap, with one feature taken away per run: `worker-chunks` (streams not
    transferable), `worker-frames` (no `OffscreenCanvas`) and `main` (no `VideoDecoder` in workers). Each run takes
    the display over, and the first page says so and stops instead of taking it back.
11. The page's Service Worker, whose scope is the site root, controls the download page but answers none of its
    requests; with the page server stopped the download page does not open.
12. With the page server stopped, a reload and the pairing link (with `#c=`) are served by the Service Worker and decode
    again.
13. The Debug switch shows one line at the top center: codec, current draw FPS, the central-90% signed
    presentation-offset average and the slowest-5% signed presentation-offset average. It
    does not intercept touches or replace the video session,
    and hides the overlay when disabled. Worker-stream, worker-chunk, worker-frame and main-thread paths all collect
    actual draw counts in the last second and signed offsets from synthetic scheduled presentation times to canvas submission.
    Negative offsets mean early submission; positive offsets mean late submission. Synthetic timestamps validate
    the timing path, not an actual iPhone capture-to-screen measurement.
14. The picture starts at the top and fills the resized window without a header or fullscreen button. The TiPlay
    icon returns to the pairing portal; its Connect button, labeled **Return to CarPlay** while active,
    resumes the same video connection.
15. While reconnecting, **Setting** opens the portal, keeps the active address/code disabled and preserves the retry;
    returning to CarPlay does not replace it. The full-window reconnect surface blocks CarPlay input and keeps its
    logo centered and action reachable at desktop, portrait and short landscape sizes in light and dark modes.
    Recovery hides the surface after the first decoded frame.

These runs use a fake phone and local browser. They verify browser resize reporting and layout,
not the iPhone's replacement-display negotiation or real vehicle routing, recovery or physical screen presentation.

## AirPlay URL canvas (`airplay-video.mjs`)

This harness exercises the actual Mediabunny/WebCodecs and TiPlay playback engine under the production CSP,
with native Video.js controls and its self-hosted skin. It checks changing video pixels in WebGL and forced 2D,
plus optional HLS playback, authenticated WebVTT discovery and pure-text subtitle timing. It also checks
letterboxing, the source-resolution cap, paused seeking and resizing, WebGL context restoration, actual timeline
clicks, speed/rate feedback, native caption selection, Bluetooth mute enforcement/restoration, ended playback,
replacement, photo handoff, safe diagnostics and disposal. Pixel readback exists only in test instrumentation.

Generate the expected 320×180 moving fixture with audio and optionally an HLS copy:

```sh
mkdir -p work/canvas
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 4 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart -y work/canvas/sample.mp4
ffmpeg -i work/canvas/sample.mp4 -c copy -hls_time 1 -hls_playlist_type vod \
  -hls_segment_filename work/canvas/part%d.ts -y work/canvas/sample.m3u8
TEST_VIDEO_MP4="$PWD/work/canvas/sample.mp4" TEST_VIDEO_HLS="$PWD/work/canvas/sample.m3u8" \
  node tests/web-e2e/airplay-video.mjs
```

Set `CHROMIUM` and `NODE_PATH` as needed. Omit `TEST_VIDEO_HLS` to run only the MP4 cases.

## Real phone side (`phone-run.mjs`)

`phone-run.mjs` checks the app's own phone side instead of the fake phone. `RealPhone.java` runs the compiled `:shared`
classes the way a phone + browser session wires them: an API-only `BrowserLinkServer`, and a `WebVideoHub` fed
through `BrowserOnlyMediaSink` → `WebMediaSink` with an H.264 Annex-B clip. A separate static server hosts the page,
matching the production HTTPS page + phone API arrangement. CI does not run it.

The secure-context run forces `VideoDecoder.isConfigSupported` to return unsupported
inside the worker, so the unsupported-H.264 message is checked independently of the
installed Chromium's codec support. A separate LAN page host checks that non-secure contexts cannot start playback. The script then repeats with a
`VideoDecoder` stand-in inside the decoder worker that checks every chunk and outputs a plain frame.

### Requirements

- Node 22, `playwright-core` and Chromium as above; a JDK 17 or later as `java` (or set `JAVA`).
- The compiled `:shared` classes. Any Gradle build of the AGENTS.md CI set produces them; on their own:
  `./gradlew :shared:compileDebugKotlin`. Set `SHARED_CLASSES` if they are elsewhere.
- The Kotlin standard library of the version in `gradle/libs.versions.toml`, found in the Gradle cache (set
  `KOTLIN_STDLIB` to the jar otherwise).
- Optional: `ffmpeg` with libx264 for a real clip; without it `RealPhone.java` streams hand-made SPS/PPS and slices.
- `PAGE_DIR` selects the separately hosted page source (default `site/play/`); the APK has no browser page assets.

### Run

```sh
NODE_PATH=/tmp/pw/node_modules node tests/web-e2e/phone-run.mjs
```

### What it checks

1. `GET /`, `/play` and `/play/*` answer `404` without redirects; `/hello` keeps `no-store`; a foreign `Host` gets `421`.
2. A separate loopback page host (a secure context): the page stores the explicit `?t=` phone address and code, removes the fragment,
   takes the Tesla path (worker), opens `/video` with the code, gets the config record (codec and canvas), says
   "This browser cannot decode H.264.", reports its viewport (CSS × DPR), sends a `/control` heartbeat every 400 ms and
   a stats event, and registers its Service Worker.
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
6. In every run: requests go only to the page host and the phone, only `/video`
   carries the code in its URL, no phone request sends a `Referer`, there are no CSP violations or page errors, and the phone
   never answers busy. The phone side never logs the code or a page session id.

The script removes its Playwright request routes before it leaves the page: Playwright's interception can drop a
`keepalive` request of a page that is going away, which looked like a lost `/bye`.


The URL-video harness above is a desktop Chromium simulation, not a Tesla device or acoustic test.
It forces autoplay permission and uses a local resource stub, so production autoplay policy,
Android HFP/SCO transitions, actual iPhone FCUP access and vehicle performance remain device checks.
HLS URL rewriting, Range handling, peer direct access and stale playback reports are also covered
by shared module tests. Codec support in native HTML video does not establish WebCodecs support.

## Ordinary AirPlay audio

`airplay-audio.mjs` serves the production browser decoder and a checked-in,
synthetically generated AAC-LC fixture. It uses actual browser WebCodecs rather
than a fake decoder and verifies decoded nonzero PCM, rates/channels and RTP/NTP
presentation metadata. Run with the same `NODE_PATH` and `CHROMIUM` prerequisites:

```sh
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium node tests/web-e2e/airplay-audio.mjs
```

Chromium 151 on 2026-10-14 decoded 10 AAC-LC frames / 20,480 channel samples.
Its native probes returned unsupported for AAC-ELD (`mp4a.40.39`) and ALAC.
Those limits are browser dependent; TiPlay provides no Android/software fallback.
Fixture source and generation notes are in `tests/web/fixtures/README.md`.
