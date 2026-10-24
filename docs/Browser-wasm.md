# Browser WebAssembly boundary

TiPlay keeps browser APIs in JavaScript and runs bulk audio computation in genuine
WebAssembly. There is no wasm2js substitute. Source, adapters, pinned build inputs
and licenses ship alongside the replaceable libraries.

## Execution

| Work | Execution and reason |
| --- | --- |
| Continuous resampling | Full libsoxr C library in WASM; persistent filter state and variable ratio per source epoch. |
| Live mixing, ducking, fades, clipping | Fixed-memory WASM audio core, one block at a time. Very small PCM conversions retain JavaScript when copying costs more than the arithmetic. |
| AAC-ELD fallback | Full FDK AAC library compiled to WASM in its decoder worker. Native WebCodecs remains the first choice. |
| URL audio tempo | Full SoundTouch C++ SIMD WASM, including fused quad/5.1 downmix and interleave. Keep direct mono/stereo layout stores where boundary copies regressed; without SIMD use the faster SoundTouchJS backend. |
| Audio/video decode and display | Native WebCodecs, Web Audio, Canvas/WebGL, image decode and the browser compositor. |
| Transport and binary headers | Native WebRTC/SCTP, streams, typed arrays and DataView. Keeping views avoids copying whole media packets into WASM to inspect a few fields. |
| Pairing | Established SRP library with native BigInt and WebCrypto. A full LibTomMath WASM candidate was slower in actual Chromium, including both warm handshake and cold loading. |
| Geolocation | Browser geolocation; coordinate conversion already runs in Android's native library. |
| UI, captions, containers and control | DOM, native typed-array byte search, maintained Mediabunny/hls.js parsers, and bounded block-level scheduling. Object/string results would otherwise need repeated JS/WASM conversion. |
| Clock fitting and deadlines | Bounded scalar JavaScript policy. Device, source and presentation clocks remain independent; WASM does not provide a better browser clock. |

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

Soxr already adjusts its conversion ratio continuously for source pacing, the
Android/browser clock mapping, effective render progress and bounded residual
phase error. One controller owns the applied rate. No additional queue-depth
controller or user speed switch is needed for drift compensation; packet bursts
and decoder lookahead are not clock measurements. Real shortages and excessive
source age still require the existing silence/recovery policy.

URL playback retains `currentTime` as the coordinate required by native
`AudioBufferSourceNode.start()`. Its audio/video/media positions share that graph;
they do not assume one graph second equals one performance-clock second. Natural
node completion, scoped to the current playback owner, gates audio EOF. A getter
crossing the estimated tail cannot stop still-live sources. User tempo changes
remain independent of clock correction.

## Loading and memory

The main thread compiles live-audio modules before creating the AudioWorkletNode
and passes compiled `WebAssembly.Module` values in `processorOptions`. Each node
instantiates private memories before playback. Calibration runs in its own worker.
The render callback neither downloads nor compiles code and never grows memory.
The live resampler has a fixed 16 MiB heap; the audio core uses fixed scratch space.
Stream queues and network consumption credits keep their existing byte limits.
No SharedArrayBuffer, cross-origin isolation or WASM threads are required.

The [SRP candidate benchmark](../tests/bench/srp/README.md) retains complete
LibTomMath source and a reproducible comparison. Chromium's full-client median
was 9.6 ms for native BigInt versus 16.6 ms for WASM; cold loading also regressed.
Node's opposite result was insufficient to select a browser backend. The wire
proof, SDP transcript binding and Android Bouncy Castle verification remain intact.

Software AAC decoding and SIMD non-1× URL playback instantiate their own bounded
libraries away from the live render callback. A missing, blocked or invalid module
reports a playback error; it cannot silently run the old JavaScript engine under
a WASM label. The explicit no-SIMD tempo backend reports `soundtouchjs`.
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
upstream source archives are retained; TiPlay's small ABI adapters do not replace
or prune the underlying codec/resampler/tempo implementations.

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
