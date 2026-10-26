# Browser end-to-end checks

These optional scripts run the production browser code in desktop Chromium. [CI](../../.github/workflows/android.yml) runs browser unit tests, not these harnesses. Loopback HTTP is a secure context for WebCodecs and Service Workers; this simulates the hosted HTTPS page without proving vehicle permissions, iPhone negotiation, routing or physical/acoustic latency.

## Requirements and basic runs

Use Node 22, `playwright-core` installed outside the repository, and a Chromium executable supplied through `CHROMIUM`. Codec availability varies by Chromium build. The general harness defaults to `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; URL/audio/photo checks default to `/usr/bin/chromium`, so explicitly setting the path is recommended.

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

## Direct live-audio and video-track checks

```sh
CHROMIUM=/path/to/chromium node tests/web-e2e/audio-direct-output.mjs
CHROMIUM=/path/to/chromium node tests/web-e2e/rtc-canvas.mjs
```

The audio check runs actual AAC-LC, AAC-ELD and ALAC stereo decoder Workers into
the production AudioWorklet through MessagePorts. It requires nonzero rendered
output, scalar-only main-thread reports, exact admitted/consumed byte accounting,
finite EOS and released owners. It does not measure speakers or CPU savings.

The video check uses a Canvas-generated source, local WebRTC RTP reception,
MediaStreamTrackProcessor and the production main/Worker Canvas presenters; it
does not create a video element. `--local-track` bypasses RTP solely to isolate
Processor and Canvas behavior. That result must not be reported as successful
WebRTC reception or Android compressed-video passthrough. The current execution
environment's managed Chromium policy disables non-proxied UDP, so the RTP check
cannot obtain ICE candidates there; leave that policy unchanged and report the
unrun integration boundary. Both paths still require actual vehicle acceptance.

## Live CarPlay CPU sampling

With an existing Chromium remote-debugging connection and CarPlay already playing:

```sh
node scripts/measure_carplay_cpu.mjs --endpoint http://127.0.0.1:9222 --seconds 30 --output /tmp/carplay-cpu
```

This requires Node 22+ and no npm dependencies. For Android Chromium, forward its
debug socket first (`adb forward tcp:9222 localabstract:chrome_devtools_remote`);
the socket name and availability depend on the browser. With multiple tabs, select
the TiPlay target ID from `/json/list` using `--target`. The tool attaches without
reloading, changing diagnostics settings or injecting playback code. It stops its
profilers and detaches when complete. Avoid running another DevTools CPU profiler
at the same time. A sampling interval of 1 ms adds overhead.

`report.json` contains main-thread task time as a percentage of elapsed time,
per-thread/module **self sampled wall-time** percentages, and audio/video counters
at both boundaries. A missing CarPlay mode or no increase in timed audio packets
produces a warning. Idle and unattributed native/program samples stay separate;
these percentages are not OS CPU utilization, and cannot be summed across workers
with different sampling intervals. Open each `.cpuprofile` in DevTools Performance
for function-level analysis. Profiles retain source URLs; keep artifacts local.
AudioWorklet, native codecs, WebRTC internals, GPU and compositor threads remain
unmeasured. Those require a browser/system trace on the target device. A low JS
sample count therefore does not rule out overload or establish an audible cause.

Capture repeated 30-second runs for idle, music, music plus navigation, and music
plus map interaction on the same device and configuration. Compare component time,
GC and audio underrun/recovery counters; keep desktop synthetic results separate
from vehicle results. A disconnected page is only a tool smoke check.

## Preparing a local CarPlay replay

Keep the original ZIP and generated inputs outside Git. Prepare browser audio
records using the Python standard library:

```sh
python3 scripts/prepare_carplay_capture.py /tmp/TiPlay-debug.zip --output /tmp/carplay-replay
```

The output directory must be new. `--session ID` selects one retained capture;
otherwise the manifest keeps sessions separate. The importer checks ZIP entry
uniqueness, stream sizes, contiguous event ranges and browser audio record headers.
It refuses invalid input rather than repairing or silently skipping records.
Indexes are bounded to 64 MiB each; selected audio is bounded to 512 MiB. It writes
only numbered browser RTC audio files and a JSON manifest, without extracting
control, credentials, session configuration or unrelated protocol payloads.
The manifest includes source/archive SHA-256, a stream inventory, original journal
order, capture times, source presentation times, audio formats and capture gaps.
It reports partial coverage, unparsed records and clock regressions explicitly.
Unselected streams receive index/size checks, not full payload validation.

`tests/web-e2e/capture-replay.mjs` provides a backpressured `ReadableStream` adapter
for the production `readAudioRecords`/`createBrowserAudio` input boundary. Supply
one stream's manifest events and a `readRange(offset, length)` function. Use a
shared `startAtMs` in the local performance-clock domain for streams in the same
session; `atMs` retains offsets from their shared capture origin. Record order and
source timestamps remain unchanged, including clock regressions. Cancellation
releases pending timers. Replay lateness is counted separately from capture gaps.

These are preparation tools, not an automatic whole-session CarPlay emulator.
RTC audio records include attempted sends; correlate the original `/events`
channel's `attempt`/`local-enqueue`/`failed` outcomes before selecting delivered
inputs. Capture times precede Android SCTP admission and are not browser arrival
times. A session-specific browser clock mapping and buffering configuration must
be reconstructed from the supplied diagnostics before audio playback. Video
requires matching encoded input, transformations and keyframe/epoch boundaries;
neither network arrival jitter nor video content can be inferred from audio alone.
Standard TXT supports counter/timing analysis but cannot supply missing payloads.

### Audio playback and thread CPU traces

After correlating audio send outcomes and choosing the session clock mapping,
the actual audio pipeline can replay a bounded clip:

```sh
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/usr/bin/chromium \
  node tests/web-e2e/capture-audio.mjs --capture /tmp/carplay-replay \
  --clock-offset-ms ORIGINAL_BROWSER_CLOCK_OFFSET --start-ms 180000 \
  --duration-ms 30000 --context-rate 48000 --debug true --output /tmp/carplay-audio-profile
python3 scripts/summarize_browser_trace.py /tmp/carplay-audio-profile/trace.json \
  --output /tmp/carplay-audio-profile/cpu-summary.json
```

The harness serves only loopback fixtures and production assets under the actual
page CSP, preloads genuine WASM, clicks a start button, and runs
`createBrowserAudio`, native AAC/Opus decoding, libsoxr and the audio worklet.
It reinstalls the most recent captured configuration per logical stream when a
clip begins mid-epoch; original payloads and source presentation times remain
unchanged. An open clip stays open until cancellation so its end cannot manufacture
a production EOF/reset. Playing output references are required even with Debug off.
Non-finite protocol control/configuration timestamps are retained in the binary;
their JSON metadata uses `null` with `presentationFinite=false`.

`--clock-offset-ms` must come from the chosen session diagnostics; it is not inferred
from an encoded packet's presentation time. The harness uses that fixed offset,
unit rate, 6 ms RTT, 5 ms clock uncertainty and 20 ms audio delay by default
(`--delay-ms` overrides delay). These are explicit reconstruction assumptions,
not a replay of every target clock observation. `--stream` selects the manifest
audio stream. Use the captured output rate with `--context-rate` (default 48000).

The runner exports a main-thread `.cpuprofile`, a marked Chromium `trace.json`,
one-second audio snapshots and the archive SHA-256. The trace summary uses `tdur`
for actual recorded **thread CPU time**, counts enclosing tasks once, and preserves
unknown CPU fields. Partial thread-time coverage has an approximate range bounded
by the missing events' elapsed time. Callback CPU includes its children and is
already part of thread totals; never sum both. Report native audio-decoder tasks,
worklet `process` (resampling/mixing/recovery), worklet message handling and main
callbacks separately. All percentages use one logical CPU as 100%.

The runner's 100 ms completion polling, statistics collection, cold decoder/JIT
startup and trace/profiler overhead remain in these measurements. Run clips
sequentially and repeat before attributing a small difference to Debug. The harness
replays audio only: source video, full page UI, original SCTP/network scheduling,
Android capture I/O and the car's native output timestamp behavior are absent.
An audible click and the vehicle's total/component CPU utilization cannot be
claimed from successful desktop playback or a low measured thread average.

Use `--capture-waveform true` for a separate signal observation run. It inserts a
stereo pass-through worklet after the production output, saves interleaved native
Float32 samples as `output.f32` (little endian on the tested Linux Chromium), and
records original hardware-frame ranges in `output-index.json`. Missing hardware
frames stay unknown; analysis must not stitch across them or count missing frames
as observed silence. The tap's sample transparency and frame-gap handling are unit
tested. State/rejection changes are retained as `referenceEvents` in the report.
Their context times are the production worklet's logical cursor; one-quantum
hardware counter discrepancies can affect exact boundary alignment.

Signal observation disables the CPU profiler/trace and labels CPU fields unknown,
because the extra node/capture traffic changes the measured graph. A 30-second
mixed capture replay produced 63 source-deadline rejection transitions in one
approximately 2.17-second interval, rejecting 8,064 frames. Earlier profiling and
instrumented-tap runs produced 61 and 54 transitions respectively. These are
different runs with different native clock observations, not three inconsistent
counts of one trace. Several zeroing edges carry very low amplitude; this evidence
does not establish 63 audible clicks or disprove clicks at other recovery boundaries.
Count fault clusters and rejected frames beside single-sample changes, and do not
count copied counters on an `ended` reference as new rejection events.

After building the log-specific playback harness, use
`scripts/measure_carplay_cpu.mjs` for JS main/Worker profiles, with the usage and
measurement limits in [CPU sampling](#live-carplay-cpu-sampling).
Profile normal playback and the reported crackle window separately; compare
diagnostics on/off to account for collection overhead. AudioWorklet/native codec,
WebRTC, compositor and GPU load require device browser/system traces. Desktop
replay CPU cost does not establish vehicle CPU utilization or physical crackles.

| Script | Coverage and extra requirements |
| --- | --- |
| `geolocation.mjs` | Actual Chromium geolocation permissions/watch, browser-local datum cache across reload, release on opt-out, and persistent guidance with an explicit close action. Uses a module fixture without vehicle/Android sensors. |
| `webrtc.mjs` | Production transport against a second real Chromium PeerConnection: reliable ordered channels, fragmentation, byte-exact record reconstruction, consumption credit, independent audio cancellation, touch/control, owner abort, malformed epochs and bounded signaling timeout. No synthetic RTCPeerConnection or media API is substituted. |
| `run.mjs` | Complete production page over a real browser DataChannel peer with synthetic phone VP8 input, pairing/code privacy, touch/viewport, telemetry, reconnect/keyframe recovery, localization, takeover, nested hosting and offline Service Worker cache boundaries. Exercises worker-stream, worker-chunk, worker-frame and main-thread fallback, and asserts no legacy HTTP media stream opens. Optional FFmpeg/libvpx (`FFMPEG` override); otherwise browser `VideoEncoder`, also forced by `E2E_VP8=browser`. |
| `phone-run.mjs` | Compiled JVM shared compatibility API: removed local-page routes, Host/cache rules, H.264 framing, authenticated control/touch, source-owner epochs, `/bye` and privacy. Directly requests legacy records and verifies the production page rejects this server's missing native RTC. It does not test production playback or Android native WebRTC. |
| `receiver-ui.mjs` | Production presentation functions with real Chromium DOM, CSS and CSP, driven by structured receiver/decoder events. Covers Chinese/English at 320/800 pixels, all three AirPlay consent actions, sender/type/effect copy, notification fit/readability, pending borrow, producer/epoch replacement, no success text, permission/failure revisions, closable notices, diagnostics and monitor controls. This component harness does not pair, decode media or establish DataChannel delivery. |
| `airplay-video.mjs` | Production AVPlayer adapter and Video.js controls under the production CSP: changing Canvas pictures, pause/seek/rate, seek button, double-click isolation, narrow layout, upstream English/Chinese HLS subtitles at EOF, simultaneous subtitle selection/seek, stop signaling and disposal. Needs an MP4 fixture; HLS optional. |
| `avplayer-url.mjs` | Generates original MP4/HLS fixtures with FFmpeg and exercises the production AVPlayer adapter: real Canvas pixels, pause/resume, seek, ended/replay, no-ENDLIST live classification/refresh/resume, explicit SDR preference and all-HDR rejection, proxy-only nested URL/redirect guards, HTTP failure, cancellation and worker/context cleanup. Uses no SharedArrayBuffer, rejects video-element creation and external runtime dependencies. |
| `airplay-photo.mjs` | Actual page CSP, authenticated synthetic EXIF JPEG, native decode/contain fit, ownership, resource reuse and cleanup. |
| `airplay-now-playing.mjs` | Production audio controls and page CSP/CSS with locally generated PNG artwork and synthetic title/artist metadata. Chinese/English at 320×640, 800×480, 1440×900 and 800×320; shared Video.js toolbar, play/pause/stop, previous/next and ±10-second commands, sender-authoritative progress, unsupported/pending controls, artwork replacement/cancellation, object URL cleanup and hiding/revealing the view while CarPlay runs. Saves screenshots and result JSON under `NOW_PLAYING_ARTIFACT_DIR` (default `/tmp/tiplay-now-playing`). No AirPlay negotiation, decoder or physical audio claim. |
| `wasm-offline.mjs` | Production Service Worker at a nested path; offline loading of every cached WASM asset, audio core execution and live libav ELD Worker output against native FFmpeg PCM. This does not establish offline AVPlayer playback. Source archives stay outside the runtime cache. |
| `airplay-audio.mjs` | Real libav Workers under production CSP: AAC-LC, eight ELD profiles, ALAC 16/24-bit, normalized 48 kHz timelines, EOF, NoData codec history and cancellation. WebCodecs audio is disabled during the test. |
| `media-clock.mjs` | Production CSP, genuine NetEq/audio-core WASM and AudioWorklet, independent mixed CarPlay/mirror PCM, actual output timestamp evidence and suspend/resume. Requires AudioWorklet; renderer/output-timestamp availability stays explicit. Current native video/Canvas is checked separately by `rtc-canvas.mjs`. |
| `rtc.mjs` | Production four-digit SRP6a pairing with native browser WebCrypto, actual BC 1.79 cross-language vectors and forged-proof/SDP/session rejection. The full run then checks two real Chromium peers with ICE/DTLS/SCTP, byte-exact large-record fragmentation, independent audio consumption and reopen barriers, receive credit, eight concurrent delayed control replies, trusted clock, graceful bye, abort, malformed epochs and bounded signaling timeout. No Android JNI, packet-loss simulation, vehicle hardware decode or physical output proof. |

The Performance monitor check verifies a non-intercepting overlay without replacing the media connection. Current fields are codec, actual last-second draw FPS, latest synchronized Delta and explicit browser discards; five-second offset distributions remain in diagnostics. Fake source times validate the timing path, not iPhone capture-to-display latency. Resize/reconnect checks cover browser layout/reporting, not iPhone replacement-display negotiation.

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
context suspend/resume and clock refinement. It does not instantiate the retired
application video decoder or decoded-frame scheduler; `rtc-canvas.mjs` checks the
current native WebRTC track-to-Canvas path separately.

The page uses the exact production CSP with `'wasm-unsafe-eval'` and without
JavaScript eval permission. Both shipped WASM modules must load and produce actual
nonzero worklet output and Standard-mode references; it cannot pass by bypassing
audio output or inventing physical speaker timing.

Audio uses continuous nonzero synthetic tones, with separate producers and epochs.
No video codec or retired video-timing fixture is required for this audio check.

`MEDIA_CLOCK_RESULT` optionally saves the full result, served-asset hashes and
runtime SHA256 snapshots before and after the run. Runtime changes during a run
fail the check. Browser/workers and the loopback server close on success or failure.
These checks measure browser audio output-clock estimates and Worklet output. They
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

Omit `TEST_VIDEO_HLS` for MP4-only coverage. The subtitle fixtures deliberately retain valid EOF boundaries: one final newline in English and no final newline in Chinese. Both languages must render through the actual non-SAB Worker pipeline, including a same-turn subtitle change and seek. `TEST_PLAYER_SCREENSHOT` optionally saves a player screenshot. The harness uses the AVPlayer Canvas path and checks the production controls; it does not retain assumptions about the removed custom PCM queues or standalone SoundTouch backend. The harness forces autoplay and uses local resources; production autoplay, FCUP/CORS reachability, HFP/SCO and vehicle compatibility remain device checks.

For self-contained MP4/HLS engine checks (FFmpeg must provide libx264 and AAC):

```sh
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium node tests/web-e2e/avplayer-url.mjs
```

This check runs without cross-origin isolation, verifies changing nonblack Canvas pictures, observes the generated tone at the actual Web Audio output gain and rejects even transient main-document video-element creation. The analyser is test-only instrumentation, not speaker-output evidence. A mixed HLS master advertises higher-bandwidth PQ, Dolby Vision and unknown-range variants alongside explicit SDR; the test requires SDR playback without requesting the disallowed children, and an all-HDR master must fail before a child request. It exercises real decoding and playback; its live fixture repeats a fixed window and does not establish rotating live-window recovery. It does not measure vehicle memory peaks, hardware decoder selection, audible quality or physical output timing. `--cancellation-only` runs only HTTP failure and pending/early source retirement checks; its result does not establish playback. Cancellation cases cover MP4 headers, HLS master headers, AES-key loading and early 0/20 ms disposal.

Old custom-engine PCM waveform/short-tail harnesses were removed with that engine; their earlier results do not establish AVPlayer behavior.

Like the general video harness, both URL harnesses accept `E2E_SOFTWARE_VIDEO=1` for desktop browsers that reject the production hardware preference. This explicit test-only override applies `no-preference` to WebCodecs in the main document and generated worker scripts. The result labels the override; it does not prove hardware decoding or change the production player.

```sh
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium node tests/web-e2e/airplay-photo.mjs
NODE_PATH=/tmp/pw/node_modules CHROMIUM=/path/to/chromium node tests/web-e2e/airplay-audio.mjs
```

Checked-in media is original synthetic material; source/generation notes and expected cues are in the [fixture README](../web/fixtures/README.md). No personal recordings or third-party media are used.
