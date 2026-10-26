# Audio buffering and tempo

Browser v89 introduced the NetEq/libav implementation below. Source v90 adds
independent stream dispatch and direct Worker-to-Worklet PCM delivery; it has not
been published. Android retains the beta.20/code62 version identity. The current
work skips the full Android suite at the user's request; targeted results do not
establish vehicle sound quality, CPU headroom or physical speaker/video timing.

## Live audio: official NetEq

CarPlay, AirPlay mirror and live AirPlay audio use the official libWebRTC NetEq
core, compiled to WASM with its Opus and L16 decoders. Each source stream/epoch
has its own instance of the NetEq engine within a private worklet runtime. There
is no replacement JavaScript jitter controller, PD, PID or SoundTouch live path.
Video and live audio run independently. Neither video presentation timestamps nor
clock-fit generations steer live audio or cause a NetEq restart. `currentTime`
is never a live playback witness; counter discontinuities remain diagnostic
measurement-domain changes while actual emitted block lengths advance consumption.

Realtime decoder order is now:

1. Raw 48 kHz PCM16/24 is unpacked using the existing WASM audio kernel.
2. Encoded 48 kHz Opus goes directly to NetEq's official decoder, retaining FEC/PLC.
3. AAC-LC, AAC-ELD, ALAC 16/24-bit and other PCM rates use libav.js Workers.
   Continuous libswresample converts to PCM16/48 kHz before official NetEq L16.

Realtime decoding never probes or constructs WebCodecs AudioDecoder. The receiver
advertises intrinsic software PCM/ALAC/AAC capabilities rather than native-browser
support. Four simultaneous software decoder Workers are allowed; excess owners
fail explicitly. Cancellation terminates each Worker and settles pending calls.

The live record reader dispatches into bounded per-transport-stream FIFO queues.
Configuration, payload and EOS remain ordered within a stream; one stream's
asynchronous software decode no longer serializes other streams. Admission still
applies byte, record and stream limits. A full queue can backpressure the shared
ordered reader; finite memory does not guarantee unlimited isolation from a
producer that outruns playback.

Software decoder Workers transfer PCM directly to the AudioWorklet through
private MessagePorts. The main thread retains configuration, errors, timing and
capacity accounting, but does not relay the decoded PCM buffers. Output acceptance
and consumption acknowledgements preserve bounded admission. Reset, replacement
and cancellation retire the old port and its generation; late output cannot
revive a retired stream. Opus and native-rate PCM retain their existing direct
main-thread-to-Worklet path. URL casting uses its separate decoder adapter.
This removes a PCM payload hop, not all dependency on main-thread control work.

The AudioContext explicitly requests 48 kHz, matching NetEq; browser output-device
conversion remains browser-owned. There is no browser libsoxr runtime or post-NetEq
resampler. Android SCO still uses its separate native libsoxr source subset.
Fractional positions and resampler state persist across packets. Discontinuities
flush/reset the resampling run while retaining the source timestamp gap. EOS drains
the finite filter tail before ending the stream. NoData inserts source-rate silence
through the same filter and does not decode the special marker or reset AAC history.
Opus duration comes from libopus, not an assumed packet interval. PCM24 retains the
existing reduction to PCM16. Worker outputs preserve stream/epoch ownership and
use their actual output timestamps and sample counts; video never steers them.

SIMD selection follows the [recorded benchmarks](../tests/bench/libav/README.md).
AAC-LC/stereo and 16-bit ALAC/stereo 44.1→48 kHz use supported SIMD; unmeasured
profiles use portable. ELD uses SIMD only for the measured 48 kHz stereo/512 profile.
The measured direct 44.1 kHz ELD gains do not establish gains after resampling, so
those realtime paths remain portable. FDK and its browser adapters are removed.

NetEq owns its adaptive target, packet buffering, time stretching and loss
concealment. There is no external “twice the first batch” watermark and no fixed
300 ms target. The upstream default starts with an 80 ms target; this is an
upstream policy, not a vehicle-validated optimum. Its 10 ms GetAudio output feeds
a small block adapter for browser-owned render sizes. Arrival history advances
with NetEq's consumption ticks. Native arrival stamps are retained but do not
turn bursty source production into artificial evenly spaced packet arrivals.

The adapter retains transport credit until source progress passes each input,
returns outstanding credit on reset/termination, and bounds input bookkeeping to
1 MiB/1024 entries. NetEq retains at most 512 packet entries, matching the existing
receiver packet budget; these are capacities, not target delays. A worklet permits
at most 16 simultaneous source streams. EOS drains finite resampler tails and
ends the utterance instead of synthesizing concealment forever. Epoch replacement
releases the old engine, and stale epochs cannot revive it.

The PCM adapter pads a finite partial L16 transport block to NetEq's 10 ms input
size. Source timestamps, the real source end and byte credit exclude that padding.
This also applies to a partial block before a source timestamp gap; the next block
retains its original timestamp. Short unpadded final packets previously caused
GetAudio failures, reproduced on both the old main-thread and direct paths.

## Computation boundary

NetEq buffering decisions, Opus decode, PLC, acceleration and preemptive expansion
run in C++ WASM. PCM conversion and mixing/ducking/clipping use the existing audio
core WASM. Libav.js retains their upstream WASM implementations. JavaScript
handles protocol ownership, typed-array transfers and block scheduling. Debug-only
flight-recorder work is separate from the normal playback path. Its timings,
and WASI wall-clock fallback timings, do not establish CPU time.

Build provenance, licenses and platform adaptations are documented in
[the NetEq vendor README](../site/play/vendor/neteq/README.md). Upstream NetEq DSP
and controller source is unchanged. The platform layer supplies single-owner
mutexes and clock/environment services; it cannot start task queues.

## AirPlay URL casting

URL casting uses libmedia AVPlayer as its playback engine. AVPlayer owns resource
reading, compressed-packet queues, decoding, audio output, video scheduling,
buffering and audio/video synchronization. TiPlay adapts the AirPlay resource
proxy and playback controls; it does not run a second PCM queue or phase controller
around the player. Video uses the Canvas path, with MSE/video-element playback
disabled. This is separate from the real-time WebRTC and software-audio paths.

User rate changes are passed to AVPlayer. The former TiPlay
`manual × (1 + correction)` composition, custom PD target and standalone
SoundTouch adapter are retired with the previous URL engine. Upstream playback
statistics and media position describe software progress, not measured output at
the vehicle speakers or panel. See [URL playback ownership](AirPlay.md#url-engine-and-captions)
for buffering and resource boundaries. Vehicle CPU, peak memory, audible quality
and synchronization still require physical acceptance.

## Verification and limits

The published v89 local suite passed 729 tests. Tests run the shipped NetEq WASM with synthetic Opus/FEC and PCM, deliberate
loss, 384 ms music-style bursts, 44.1/48 kHz conversion, stream end/reset/credit,
variable render quanta and throwing/jumping clock getters. Browser tests cover
software AAC/ALAC/ELD decode and direct NetEq Opus and the production AudioWorklet/CSP path. These
are not vehicle acceptance or a closed-loop replay of every uploaded trace.

Required physical follow-up: actual Tesla sample rate and scheduling budget,
AAC music quality under repeated NetEq time stretching, initial burst adaptation,
independent navigation endings/ducking, and finite memory under all simultaneous
stream combinations. No promise of lower CPU or elimination of every click is
made solely because the core is WASM or upstream code.

## Web-only tie-up

The user explicitly skips CI and APK compilation. Local verification includes
Node tests, real Chromium software decoding/NetEq Worklet, URL fallback, normal
and jumping-currentTime media-clock runs, nested-path offline cache, site assembly
and native Android libsoxr source consistency. Browser v89 is deployed through
Pages; Android remains beta.20/code62. The removed native-first decoder and browser
libsoxr tests were replaced with actual software-decoder, continuous-resampler,
EOS/gap/cancellation and multistream lifecycle checks. Prior higher test counts
include retired implementations and are not current v89 coverage counts.

Physical follow-up remains Tesla CPU/peak memory, multi-stream headroom, output
quality and audible clicks. A bench gain or software test cannot complete those
checks remotely. The separate Cloudflare comparison is outside this audio rollout.

Ended PCM epochs are tombstoned before accepting implicit legacy PCM setup.
Only a newer epoch or an explicit owner reset can start again; late raw PCM
cannot revive an ended utterance. Browser v89 bumps both page/cache versions
so already cached v88 clients receive this lifecycle fix.
