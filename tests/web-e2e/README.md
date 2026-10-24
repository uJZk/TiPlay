# Browser end-to-end checks

These optional scripts run the production browser code in desktop Chromium. [CI](../../.github/workflows/android.yml) runs browser unit tests, not these harnesses. Loopback HTTP is a secure context for WebCodecs and Service Workers; this simulates the hosted HTTPS page without proving vehicle permissions, iPhone negotiation, routing or physical/acoustic latency.

## Requirements and basic runs

Use Node 22, `playwright-core` installed outside the repository, and a Chromium executable supplied through `CHROMIUM`. Codec availability varies by Chromium build. The general/video scripts default to `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; audio/photo default to `/usr/bin/chromium`, so explicitly setting the path is recommended.

```sh
npm install --prefix /tmp/pw playwright-core
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium node tests/web-e2e/run.mjs
```

The default general harness keeps the production `prefer-hardware` request. On a
desktop browser that rejects it, the harness checks the explicit unsupported
capability state and stops before playback cases. To exercise real compressed
WebCodecs decode and the complete page on such a machine, explicitly set
`E2E_SOFTWARE_VIDEO=1`. That harness-only instrumentation replaces the native
decoder's hardware hint with `no-preference` in the main page and worker; its
output labels the override. It does not establish hardware decoding or change
production behavior.

All harnesses disable the browser proxy (`--no-proxy-server`); their loopback/LAN servers require direct access. `run.mjs` and `phone-run.mjs` print `ok -` checks and finish with `all checks passed`, or exit nonzero on failure. Other harnesses print results and exit nonzero on assertion failure.

| Script | Coverage and extra requirements |
| --- | --- |
| `geolocation.mjs` | Actual Chromium geolocation permissions/watch, browser-local datum cache across reload, release on opt-out, and persistent guidance with an explicit close action. Uses a module fixture without vehicle/Android sensors. |
| `webrtc.mjs` | Production transport against a second real Chromium PeerConnection: reliable ordered channels, fragmentation, byte-exact record reconstruction, consumption credit, independent audio cancellation, touch/control, owner abort, malformed epochs and bounded signaling timeout. No synthetic RTCPeerConnection or media API is substituted. |
| `run.mjs` | Complete production page over a real browser DataChannel peer with synthetic phone VP8 input, pairing/code privacy, touch/viewport, telemetry, reconnect/keyframe recovery, localization, takeover, nested hosting and offline Service Worker cache boundaries. Exercises worker-stream, worker-chunk, worker-frame and main-thread fallback, and asserts no legacy HTTP media stream opens. Optional FFmpeg/libvpx (`FFMPEG` override); otherwise browser `VideoEncoder`, also forced by `E2E_VP8=browser`. |
| `phone-run.mjs` | Compiled JVM shared compatibility API: removed local-page routes, Host/cache rules, H.264 framing, authenticated control/touch, source-owner epochs, `/bye` and privacy. Directly requests legacy records and verifies the production page rejects this server's missing native RTC. It does not test production playback or Android native WebRTC. |
| `receiver-ui.mjs` | Production presentation functions with real Chromium DOM, CSS and CSP, driven by structured receiver/decoder events. Covers Chinese/English at 320/800 pixels, pending borrow, producer/epoch replacement, no success text, permission/failure revisions, closable notices, diagnostics and monitor controls. This component harness does not pair, decode media or establish DataChannel delivery. |
| `airplay-video.mjs` | Real Mediabunny/WebCodecs playback engine, Video.js controls/skin, canvas pixels, seek/pause/rate, ±10-second buttons, mouse/touch double-tap isolation, narrow layout with production CSS, captions, mute restoration, ownership, disposal and sanitized failure diagnostics under production CSP. Needs an MP4 fixture; HLS optional. |
| `airplay-photo.mjs` | Actual page CSP, authenticated synthetic EXIF JPEG, native decode/contain fit, ownership, resource reuse and cleanup. |
| `aac-eld-wasm.mjs` | Exact production CSP and a real module worker decode all eight raw ELD profiles against independent PCM goldens; rejects failed/corrupt loads, retries new epochs, bounds concurrent workers and checks close/transfer ownership. |
| `wasm-offline.mjs` | Installs the actual production Service Worker at a nested path, reloads the production page with Chromium networking offline, checks the complete cache and exact hashes for all five WASM files, executes soxr/audio core/scalar and supported SIMD SoundTouch, and decodes AAC-ELD through both the direct loader and a real module worker against independent PCM goldens. Source archives stay outside the playback cache; checks unchanged inputs, CSP and external-request boundaries. |
| `airplay-audio.mjs` | Actual WebCodecs AAC-LC and CarPlay Opus decoding, nonzero PCM, sample metadata and asynchronous timeline sequence preservation. Prints ALAC/AAC-ELD capability probes; no software fallback is implied. |
| `url-audio-signal.mjs` | Production URL engine with synthetic decoded PCM, native OfflineAudioContext source nodes and a whole-buffer reference, plus real AudioContext/AudioWorklet capture during deliberate main-thread stalls. Checks source-rate requests, packet/slice continuity, continuous resampling and bounded scheduling recovery for 44.1/48 kHz output. No mirror worklet or captured media is used. |
| `airplay-short-audio.mjs` | Production URL engine against native whole-buffer duration-limited rendering at 44.1/48 kHz. Covers one-sample and fractional-sample durations, padded decoded packets, exact output samples and play/ended ordering; it does not measure physical speaker output. |
| `media-clock.mjs` | Production CSP, genuine WASM soxr/audio core/AudioWorklet, independent mixed CarPlay/mirror PCM, actual output timestamps, suspend/resume, and main/worker/OffscreenCanvas video timing. Requires H.264 decoding, AudioWorklet, `getOutputTimestamp`, OffscreenCanvas and transferable streams. |
| `rtc.mjs` | Production four-digit SRP6a pairing with native browser WebCrypto, actual BC 1.79 cross-language vectors and forged-proof/SDP/session rejection. The full run then checks two real Chromium peers with ICE/DTLS/SCTP, byte-exact large-record fragmentation, independent audio consumption and reopen barriers, receive credit, eight concurrent delayed control replies, trusted clock, graceful bye, abort, malformed epochs and bounded signaling timeout. No Android JNI, packet-loss simulation, vehicle hardware decode or physical output proof. |

The Performance monitor check verifies a non-intercepting overlay without replacing the media connection. Current fields are codec, actual last-second draw FPS, latest synchronized Delta and explicit browser discards; five-second offset distributions remain in diagnostics. Fake source times validate the timing path, not iPhone capture-to-display latency. Resize/reconnect checks cover browser layout/reporting, not iPhone replacement-display negotiation.

For URL audio signal regression, run
`NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium node tests/web-e2e/url-audio-signal.mjs`.
`TEST_URL_AUDIO_ENGINE=/absolute/path/to/airplay-media.js` optionally selects a
frozen source snapshot for a before/after check; the runner reports its SHA-256.
The deterministic scheduling clock creates the production graph before native
offline rendering. This measures PCM, node boundaries and native resampling;
it does not establish live device deadlines, autoplay permission or audible
speaker behavior. Keep this separate from the mirror decoder/worklet checks.

## DataChannel transport

```sh
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium node tests/web-e2e/rtc.mjs
# Runs pairing and tamper checks independently of local ICE connectivity:
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium node tests/web-e2e/rtc.mjs --pairing-only
```

This harness uses the production SRP6a helper and four-digit code. Local HTTP
carries ephemeral PAKE messages and SDP; the code and reusable password hashes
stay off that link. It checks real Bouncy Castle 1.79 vectors and rejects a wrong
code, forged server proof, changed binding, offer, answer or session before DTLS
authorization. Only the subsequent encrypted DataChannel auth releases media and a random
resource token. The HTTP answer has no resource token. The two endpoints then
send TDR1 application fragments through actual browser WebRTC and the production
reassembler. Receive acknowledgements reflect reader consumption; audio reopen
waits for the matching generation barrier. Server fixtures model Android's
PAKE, record producer and control replies. No copy/paste or fingerprint entry is
required. A successful `--pairing-only` run establishes browser PAKE behavior;
it does not establish successful ICE, DTLS or DataChannel delivery.

Chromium needs permission to enumerate interfaces and open local UDP/TCP sockets.
The runner grants local-network access, permits loopback candidates and disables
mDNS obfuscation for this local test; it does not prove vehicle permission prompts,
Android interface selection or Tesla mDNS policy.
If the execution container provides no ICE candidates, the check fails and prints
both peers' gathering/connection states. A timeout in that environment is not
evidence of successful DataChannel delivery.

## Media clock and actual browser output

`MEDIA_CLOCK_GETTER_FAULT=frozen|slow|jumping|unreadable` runs the same production
integration with an injected faulty main-thread `AudioContext.currentTime` getter.
The actual native graph, Worklet frame counter, output timestamp API, sample
waveforms and timing assertions remain unchanged. Run each mode separately after
ordinary source tests; `slow` exposes 0.98× progress and `jumping` adds ±5 seconds.

```sh
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium \
  MEDIA_CLOCK_RESULT=/tmp/media-clock.json node tests/web-e2e/media-clock.mjs
```

The runner clicks the page's Start button and uses the production CSP and bundled
WASM resampler and audio core without autoplay or CSP bypasses. All assets and synthetic media stay on
loopback. It verifies output references before enabling diagnostic capture, then
checks nonzero worklet output, independent CarPlay/mirror producers, an actual
context suspend/resume and clock refinement. Main-thread presentation, real H.264
worker decode with frame transfer, and worker OffscreenCanvas use the same output
reference and retain separate source-relative video and audio timelines.

The page uses the exact production CSP with `'wasm-unsafe-eval'` and without
JavaScript eval permission. Both shipped WASM modules must load and produce actual
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

CarPlay Canvas and audio check independent sender-relative 300 ms ceilings.
AirPlay mirror Canvas and audio check the same independent 300 ms ceilings;
audio skew is diagnostic and does not gate video. These bounds cover known
software clock/output mappings, not unknown upstream capture or physical output.
Worker hardware-preference probes are reported separately: an unsupported headless configuration is explicitly unavailable,
without software fallback or a claim of validated CarPlay hardware decoding.

## Compiled phone API

Use a JDK 17+ (`JAVA` override) and compile the shared classes:

```sh
./gradlew :shared:compileDebugKotlin
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium node tests/web-e2e/phone-run.mjs
```

`SHARED_CLASSES` overrides the default Gradle class directory. `BCPROV_JAR` can override the Bouncy Castle dependency discovered in the Gradle cache. The script finds the matching Kotlin standard-library jar from `gradle/libs.versions.toml` in the Gradle cache; use `KOTLIN_STDLIB` for another location. `PAGE_DIR` overrides `site/play/`. Optional FFmpeg/libx264 generates real Annex-B input (`FFMPEG` override); otherwise the harness builds synthetic SPS/PPS/slices.

`RealPhone.java` wires `BrowserOnlyMediaSink` → `WebMediaSink` → `WebVideoHub` to an
API-only `BrowserLinkServer` with its RTC factory explicitly absent. Node requests
the retained compatibility `/video` records and `/control` API directly. The
current production page attempts SRP, retains a retry state after the explicit
`rtc-unavailable` response, and opens no compatibility media transport. The old
plaintext `/rtc` route remains HTTP 410 even in this fixture. Successful compatibility checks do not establish the Android
native RTC library, device UDP reachability, hardware decode or physical output.

## AirPlay media

Generate original synthetic 320×180 moving video/audio; FFmpeg needs libx264 and AAC encoding:

```sh
mkdir -p work/canvas
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 24 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart -y work/canvas/sample.mp4
ffmpeg -i work/canvas/sample.mp4 -c copy -hls_time 1 -hls_playlist_type vod \
  -hls_segment_filename work/canvas/part%d.ts -y work/canvas/sample.m3u8
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium \
  TEST_VIDEO_MP4="$PWD/work/canvas/sample.mp4" TEST_VIDEO_HLS="$PWD/work/canvas/sample.m3u8" \
  node tests/web-e2e/airplay-video.mjs
```

Omit `TEST_VIDEO_HLS` for MP4-only coverage. The HLS stub supplies authenticated WebVTT and language switching. At 1.25x, the harness requires an actual SoundTouch SIMD WASM fetch and the `wasm-simd` diagnostic under the exact production CSP. `TEST_PLAYER_SCREENSHOT` optionally saves a player screenshot. Test instrumentation alone reads canvas pixels. The harness forces autoplay and uses local resources; production autoplay, FCUP/CORS reachability, HFP/SCO and vehicle compatibility remain device checks.

```sh
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium node tests/web-e2e/airplay-photo.mjs
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium node tests/web-e2e/airplay-audio.mjs
```

Checked-in media is original synthetic material; source/generation notes and expected cues are in the [fixture README](../web/fixtures/README.md). No personal recordings or third-party media are used.
