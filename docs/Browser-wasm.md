# Browser WebAssembly boundary

TiPlay keeps browser APIs in JavaScript and runs bulk audio computation in genuine
WebAssembly. There is no wasm2js substitute. Source, adapters, pinned build inputs
and licenses accompany the replaceable libraries; NetEq source archives are checksum-pinned build downloads.

## Execution

| Work | Execution and reason |
| --- | --- |
| Continuous resampling | Continuous libswresample in libav.js decoder Workers; source gaps reset the filter run. |
| Live mixing, ducking, fades, clipping | Fixed-memory WASM audio core, one block at a time. Very small PCM conversions retain JavaScript when copying costs more than the arithmetic. |
| Realtime AAC-LC/ELD/ALAC decode | FFmpeg/libav.js decoder Workers; no WebCodecs audio decoder. |
| Live buffering and tempo | Official NetEq WASM: adaptive jitter delay, Opus/L16 decode, time stretching and concealment. Opus decodes directly in NetEq; other codecs arrive as normalized PCM16/48 kHz. |
| URL audio tempo | SoundTouch C++ with the 20/5/5 ms policy, SIMD where available and portable WASM otherwise, including fused quad/5.1 downmix and interleave. |
| URL audio, video decode and display | Native WebCodecs, Web Audio, Canvas/WebGL, image decode and the browser compositor. |
| Transport and binary headers | Native WebRTC/SCTP, streams, typed arrays and DataView. Keeping views avoids copying whole media packets into WASM to inspect a few fields. |
| Pairing | Established SRP library with native BigInt and WebCrypto. A full LibTomMath WASM candidate was slower in actual Chromium, including both warm handshake and cold loading. |
| Geolocation | Browser geolocation; coordinate conversion already runs in Android's native library. |
| UI, captions, containers and control | DOM, native typed-array byte search, maintained Mediabunny/hls.js parsers, and bounded block-level scheduling. Object/string results would otherwise need repeated JS/WASM conversion. |
| Clock fitting and deadlines | Bounded scalar JavaScript policy. Device, source and presentation clocks remain independent; WASM does not provide a better browser clock. |

## libav.js SIMD validation

Libav.js portable and SIMD builds use the same minimal AAC/ALAC and
resampling configuration. [The browser benchmark](../tests/bench/libav/README.md)
records three isolated Chromium 151 runs: AAC-LC processing time falls
16.5–19.7%, ALAC 3.3–7.5%, with byte-identical output. Supplementary 48 kHz
runs show only 0–2.6% AAC-LC gains and 12.3–15.2% ALAC regression; the low-level
loader defaults to portable and validates SIMD support when it is requested. These are decode plus
44.1→48 kHz resampling workloads, not whole-player or vehicle CPU savings.
Both variants decode all eight existing AAC-ELD profiles after the adapter
explicitly supplies `AVMEDIA_TYPE_AUDIO`. Earlier failures were caused by our
missing codec-type parameter: the context sample rate stayed zero. The
[actual-WASM regression](../tests/web/libav-eld.test.mjs) reproduces that omission
and validates the corrected calls. The realtime ELD Worker now uses libav.js; the FDK runtime and build files are removed. URL casting now uses these modules as a native audio decoder fallback;
its adapter selects measured beneficial stereo 44.1→48 kHz AAC-LC/16-bit ALAC SIMD profiles
and portable otherwise. Realtime decoder migration and vehicle acceptance remain
separate, and this change is unpublished.

Tesla SIMD support was already established for the user's Model Y AMD Ryzen:
report `d73a0959`, 2026-10-08, Chromium 148, recorded WASM SIMD and AudioWorklet
available and SharedArrayBuffer unavailable. The source evidence is
[`docs/todo.md` at `8b6c0467`](https://github.com/uJZk/TiPlay/blob/8b6c04675c9d59eede9fcb1301b9e55b29262ecb/docs/todo.md).
This is feature support evidence; vehicle performance remains unmeasured.

## Audio clock roles

The main-thread `AudioContext.currentTime` getter is diagnostic data for live
audio. It cannot supply a wall-clock epoch, train a rate fit, invalidate a valid
output mapping or establish feedback age. Worklet controls and output positions
use actual `currentFrame` values and integrated emitted-frame counts. Dividing
frames by sample rate gives a graph coordinate, not independently measured time.

Render probes associate a verified frame frontier with the performance-clock
request/receipt interval, including the render quantum. Fits retain those bounds;
moving callback latency cannot itself prove a rate change. Native output timestamp
pairs are checked against verified frame progress and their own continuity.
Missing native timestamps use a bounded frame/probe mapping plus the browser's
latency estimates. Playback can continue, while source-deadline status stays
unknown until a valid native timestamp mapping is available. Neither mapping is
an independent measurement at the vehicle speakers.

Live audio follows NetEq's independent packet/consumption timeline. Libav.js
Workers normalize input to 48 kHz, and the AudioContext explicitly requests 48 kHz.
Browser-owned conversion handles the output device; browser libsoxr is removed.
No source/video phase controller or clock-generation recovery remains in this
path. Counter discrepancies change diagnostic measurement domains only. The
[buffering audit](Audio-tempo.md) documents decoder priority, EOS/credit handling,
capacity bounds and unverified physical behavior. Heavy sample conversion,
mixing, Opus and NetEq DSP execute in WASM; JS owns stream/block adaptation.

URL playback retains `currentTime` as the coordinate required by native
`AudioBufferSourceNode.start()`. Its audio/video/media positions share that graph;
they do not assume one graph second equals one performance-clock second. Natural
node completion, scoped to the current playback owner, gates audio EOF. A getter
crossing the estimated tail cannot stop still-live sources. User tempo changes
remain independent of clock correction. URL and live adapters share native
SoundTouch construction, effective tempo validation (0.2–4.8x), and 20/5/5 ms windows.
The user's 0.25–4x selection is multiplied by the shared ±20% automatic correction.
URL synchronization compares the native output timestamp's submitted PCM position
with the displayed video frame, targeting audio-minus-video −45…+125 ms. It never
uses `currentTime` getter jumps as a phase witness. Unknown/stale/discontinuous
native timestamps disable automatic correction. A breach enables PD toward the
40 ms centre; it continues in the window rather than toggling at its edges.
Processed queue duration lowers loop gain, and chunk-specific tempo keeps source
positions and native scheduling consistent through changes. The user-facing rate
and phone feedback retain the manual multiplier. This is a target window, not a
hard bound during initial error or stalls. URL EOF flushes finite input; live EOS explicitly drains and ends its NetEq stream.

## Loading and memory

The main thread compiles live-audio modules before creating the AudioWorkletNode
and passes compiled `WebAssembly.Module` values in `processorOptions`. Each node
instantiates private memories before playback. Calibration runs in its own worker.
The render callback initiates no downloads or explicit compilation. The live
NetEq runtime is shared within a worklet and bounded to 32 MiB; its handles
are independent and their scratch blocks are limited to 512 frames. `WebAssembly.compile()` performs initial browser compilation before
node creation; the browser may still lazily compile functions or optimize machine
code in the background. This does not guarantee that playback is free of internal
JIT activity.
The live resampler has a fixed 16 MiB heap; the audio core uses fixed scratch space.
Stream queues and network consumption credits keep their existing byte limits.
No SharedArrayBuffer, cross-origin isolation or WASM threads are required.

The [SRP candidate benchmark](../tests/bench/srp/README.md) retains complete
LibTomMath source and a reproducible comparison. Chromium's full-client median
was 9.6 ms for native BigInt versus 16.6 ms for WASM; cold loading also regressed.
Node's opposite result was insufficient to select a browser backend. The wire
proof, SDP transcript binding and Android Bouncy Castle verification remain intact.

Software AAC decoding and non-1× URL playback instantiate their own bounded
libraries away from the live render callback. A missing, blocked or invalid module
reports a playback error; it cannot silently run the old JavaScript engine under
a WASM label. The no-SIMD tempo backend reports `wasm`.
Concurrent module loads deduplicate and failed loads may be retried.

Production CSP grants `'wasm-unsafe-eval'` alongside same-origin scripts. This
permits WASM compilation while retaining the ban on JavaScript `eval`/`Function`.
All runtime binaries belong in the Service Worker manifest. Updating source or
binaries requires changing the page/cache revision together. The diagnostic
`chatgpt/` page remains independent of the production cache.
Only runtime assets are precached; corresponding source archives and license
materials remain publicly available alongside the modules.

## Transport and Android capture

Reliable ordered DataChannels retain their versioned binary framing, bounded
record sizes, generation barriers and consumption credits. Contiguous frames use
offset views; fragmented frames coalesce once. Transferable payload ownership is
explicit, so transferring one PCM record cannot detach the next unread record.

Android diagnostic raw capture retains synchronous, lossless session and export
semantics. Bulk Base64 encoding accepts the source range directly, avoiding a
48 KiB slice and an intermediate Base64 String for every fragment. This keeps the
documented export format while reducing capture allocation. Capture remains opt-in;
no per-render-block logs are added.

## Rebuild and verification

See [Build](Build.md#browser-wasm-build) for the pinned build entry points and
[third-party notices](Third-party-notices.md#browser-media) for licenses. Complete
upstream source archives are retained or checksum-pinned for build-time download
(NetEq); TiPlay adapters do not replace the underlying codec/resampler/tempo algorithms.

The browser suite exercises actual shipped WASM binaries, signal continuity,
deadlines, arbitrary packet boundaries, epoch changes and error recovery. The
[media-clock harness](../tests/web-e2e/media-clock.mjs) verifies actual nonzero
AudioWorklet output under production CSP, records module hashes, and checks
suspend/resume and independent source timing. The AAC tests compare PCM with
golden outputs from the preceding implementation. Tempo tests verify duration,
pitch and finite output.

Benchmarks include boundary copies and distinguish engine CPU from wall-clock
render scheduling. Run them on the target browser before interpreting small
differences; desktop CPU gains do not establish vehicle speaker timing or prove
that every audible click is eliminated. Physical acceptance remains in
[Todo](Todo.md#browser-and-carplay-audio).
