# Browser end-to-end checks

These optional scripts run the production browser code in desktop Chromium. [CI](../../.github/workflows/android.yml) runs browser unit tests, not these harnesses. Loopback HTTP is a secure context for WebCodecs and Service Workers; this simulates the hosted HTTPS page without proving vehicle permissions, iPhone negotiation, routing or physical/acoustic latency.

## Requirements and basic runs

Use Node 22, `playwright-core` installed outside the repository, and a Chromium executable supplied through `CHROMIUM`. Codec availability varies by Chromium build. The general/video scripts default to `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; audio/photo default to `/usr/bin/chromium`, so explicitly setting the path is recommended.

```sh
npm install --prefix /tmp/pw playwright-core
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium node tests/web-e2e/run.mjs
```

All harnesses disable the browser proxy (`--no-proxy-server`); their loopback/LAN servers require direct access. `run.mjs` and `phone-run.mjs` print `ok -` checks and finish with `all checks passed`, or exit nonzero on failure. Other harnesses print results and exit nonzero on assertion failure.

| Script | Coverage and extra requirements |
| --- | --- |
| `geolocation.mjs` | Actual Chromium geolocation permissions/watch, browser-local datum cache across reload, release on opt-out, and persistent guidance with an explicit close action. Uses a module fixture without vehicle/Android sensors. |
| `run.mjs` | Fake-phone VP8 streaming, pairing/code privacy, current default endpoint from `site/play/link.js`, touch/viewport, telemetry, reconnect/keyframe recovery, localization, takeover, nested hosting and offline Service Worker cache boundaries. Exercises worker-stream, worker-chunk, worker-frame and main-thread fallback. Optional FFmpeg/libvpx (`FFMPEG` override); otherwise browser `VideoEncoder`, also forced by `E2E_VP8=browser`. |
| `phone-run.mjs` | Compiled shared phone API with a separate page server: removed local-page routes, Host/CORS/cache rules, H.264 framing, authenticated control/touch, epochs, recovery, `/bye` and privacy. Uses an unsupported-codec case and an explicit decoder stand-in; it is not an Android-device test. |
| `airplay-video.mjs` | Real Mediabunny/WebCodecs playback engine, Video.js controls/skin, canvas pixels, seek/pause/rate, ±10-second buttons and mouse/touch half-screen gestures, accumulated feedback/bounds, narrow layout with production CSS, captions, mute restoration, ownership, disposal and sanitized failure diagnostics under production CSP. Needs an MP4 fixture; HLS optional. |
| `airplay-photo.mjs` | Actual page CSP, authenticated synthetic EXIF JPEG, native decode/contain fit, ownership, resource reuse and cleanup. |
| `airplay-audio.mjs` | Actual WebCodecs AAC-LC and CarPlay Opus decoding, nonzero PCM, sample metadata and asynchronous timeline sequence preservation. Prints ALAC/AAC-ELD capability probes; no software fallback is implied. |
| `media-clock.mjs` | Production CSP, bundled soxr WASM/AudioWorklet, independent mixed CarPlay/mirror PCM, actual output timestamps, suspend/resume, and main/worker/OffscreenCanvas video timing. Requires H.264 decoding, AudioWorklet, `getOutputTimestamp`, OffscreenCanvas and transferable streams. |

The Performance monitor check verifies a non-intercepting overlay without replacing the media connection. Current fields are codec, actual last-second draw FPS, latest synchronized Delta and explicit browser discards; five-second offset distributions remain in diagnostics. Fake source times validate the timing path, not iPhone capture-to-display latency. Resize/reconnect checks cover browser layout/reporting, not iPhone replacement-display negotiation.

## Media clock and actual browser output

```sh
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium \
  MEDIA_CLOCK_RESULT=/tmp/media-clock.json node tests/web-e2e/media-clock.mjs
```

The runner clicks the page's Start button and uses the production CSP and bundled
WASM without autoplay or CSP bypasses. All assets and synthetic media stay on
loopback. It verifies output references before enabling diagnostic capture, then
checks nonzero worklet output, independent CarPlay/mirror producers, an actual
context suspend/resume and clock refinement. Main-thread presentation, real H.264
worker decode with frame transfer, and worker OffscreenCanvas use the same output
reference and retain the production video caps and audio early/late window.

On Chromium builds that reject compiled WASM in AudioWorklet messages, the same
production loader retries with cached bytes. The probe still requires actual
nonzero worklet output and Standard-mode references; it cannot pass by bypassing
audio output or widening a video deadline.

The H.264 source is the original black 16×16
[`embedded-tx3g.mp4` fixture](../web/fixtures/README.md), whose FFmpeg generation
instructions are recorded with the fixture. The probe demuxes its first keyframe,
converts AVC parameter sets and length-prefixed NAL units to Annex B, and repeats
that independent keyframe with synthetic presentation timestamps. A 200 ms
producer lead permits desktop decoder buffering before the source deadline; it
does not increase the video latency cap. Audio uses continuous nonzero synthetic
tones, with separate producers and epochs.

`MEDIA_CLOCK_RESULT` optionally saves the full result, served-asset hashes and
runtime SHA256 snapshots before and after the run. Runtime changes during a run
fail the check. Browser/workers and the loopback server close on success or failure.
These checks measure browser output-clock estimates and Canvas submission. They
do not measure acoustic speaker delay, physical panel presentation, vehicle audio
routes or iPhone negotiation; physical acceptance remains separate.

## Compiled phone API

Use a JDK 17+ (`JAVA` override) and compile the shared classes:

```sh
./gradlew :shared:compileDebugKotlin
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium node tests/web-e2e/phone-run.mjs
```

`SHARED_CLASSES` overrides the default Gradle class directory. The script finds the matching Kotlin standard-library jar from `gradle/libs.versions.toml` in the Gradle cache; use `KOTLIN_STDLIB` for another location. `PAGE_DIR` overrides `site/play/`. Optional FFmpeg/libx264 generates real Annex-B input (`FFMPEG` override); otherwise the harness builds synthetic SPS/PPS/slices.

`RealPhone.java` wires `BrowserOnlyMediaSink` → `WebMediaSink` → `WebVideoHub` to an API-only `BrowserLinkServer`. Loopback and separate-origin runs check secure playback; a LAN HTTP page checks rejection of an insecure context. Authenticated `/video` and `/audio` may carry the code in their URL; other requests must not leak it or send a Referer. Request interception is removed before navigation so Playwright does not discard the outgoing keepalive `/bye`.

## AirPlay media

Generate original synthetic 320×180 moving video/audio; FFmpeg needs libx264 and AAC encoding:

```sh
mkdir -p work/canvas
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 4 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart -y work/canvas/sample.mp4
ffmpeg -i work/canvas/sample.mp4 -c copy -hls_time 1 -hls_playlist_type vod \
  -hls_segment_filename work/canvas/part%d.ts -y work/canvas/sample.m3u8
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium \
  TEST_VIDEO_MP4="$PWD/work/canvas/sample.mp4" TEST_VIDEO_HLS="$PWD/work/canvas/sample.m3u8" \
  node tests/web-e2e/airplay-video.mjs
```

Omit `TEST_VIDEO_HLS` for MP4-only coverage. The HLS stub supplies authenticated WebVTT and language switching. `TEST_PLAYER_SCREENSHOT` optionally saves a player screenshot. Test instrumentation alone reads canvas pixels. The harness forces autoplay and uses local resources; production autoplay, FCUP/CORS reachability, HFP/SCO and vehicle compatibility remain device checks.

```sh
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium node tests/web-e2e/airplay-photo.mjs
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium node tests/web-e2e/airplay-audio.mjs
```

Checked-in media is original synthetic material; source/generation notes and expected cues are in the [fixture README](../web/fixtures/README.md). No personal recordings or third-party media are used.
