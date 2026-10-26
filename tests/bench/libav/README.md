# libav.js audio SIMD performance

These are **decoder + continuous 44.1→48 kHz resampler + PCM16 copy-out**
measurements, not whole-player CPU usage or vehicle measurements. Both variants
use libav.js 6.10.9 (internal build version 6.10.9.0), FFmpeg 9.0 and Emscripten
4.0.7, with identical configuration. Portable uses `-O3`; SIMD uses
`-O3 -msimd128`. The build script and retained sources are in
[scripts/libav](../../../scripts/libav/build.py) and
[vendor/libav](../../../site/play/vendor/libav/README.md).

## Recorded result

Three separate Chromium 151 Linux x64 module-Worker runs on an Intel Xeon
Platinum 8573C container (five visible CPUs), without another benchmark running.
Each fixture's access units repeat 20 times through one continuous decoder and
filter; five warmup rounds precede 20 measured rounds. Execution order alternates
portable/SIMD each round. Loading, codec/filter initialization, fixture copying,
cleanup and SHA-256 checks are outside the timed interval. Packet calls, PCM
copy-out and final decoder/filter flush are inside. Synthetic tone packet
repetition does not reproduce a live stream's content distribution or burst
scheduling. All timings below are per complete workload, not per packet.

| Workload | Run | Portable median | SIMD median | Time reduction |
| --- | --- | --- | --- | --- |
| AAC-LC, stereo, 4.644 s output | 1 | 18.2 ms | 15.2 ms | 16.5% |
| AAC-LC, stereo, 4.644 s output | 2 | 17.6 ms | 14.6 ms | 17.0% |
| AAC-LC, stereo, 4.644 s output | 3 | 18.3 ms | 14.7 ms | 19.7% |
| ALAC, stereo, 20 s output | 1 | 110.0 ms | 106.4 ms | 3.3% |
| ALAC, stereo, 20 s output | 2 | 107.2 ms | 101.0 ms | 5.8% |
| ALAC, stereo, 20 s output | 3 | 98.5 ms | 91.1 ms | 7.5% |

Supplementary 48 kHz tests use generated one-second stereo inputs repeated
20 times; the output remains 48 kHz, with format conversion but no sample-rate
change. Three more sequential, isolated browser runs under the production CSP:

| Workload | Run | Portable median | SIMD median | Time change |
| --- | --- | --- | --- | --- |
| AAC-LC 48 kHz | 1 | 46.1 ms | 45.4 ms | −1.5% |
| AAC-LC 48 kHz | 2 | 41.7 ms | 41.7 ms | 0.0% |
| AAC-LC 48 kHz | 3 | 45.4 ms | 44.2 ms | −2.6% |
| ALAC 48 kHz | 1 | 59.8 ms | 68.9 ms | +15.2% |
| ALAC 48 kHz | 2 | 59.5 ms | 66.8 ms | +12.3% |
| ALAC 48 kHz | 3 | 56.8 ms | 64.8 ms | +14.1% |

These outputs also match byte-for-byte between variants and across runs.
AAC-LC 48 kHz gains are small; ALAC 48 kHz consistently regresses. The staged
loader therefore defaults to portable and requires an explicit SIMD selection
for an independently validated path. It checks actual support before loading
SIMD. No format-specific performance guarantee is inferred for a different CPU.

Raw measurements and output SHA-256 values are in [results](results/).
AAC-LC and ALAC produce byte-identical output between variants and across all
three runs. Portable has no SIMD instructions; LLVM disassembly finds 5,163
SIMD instruction lines in the SIMD binary. This establishes actual generated
vector code, not an assumption from the filename.

The original eight AAC-ELD failures were caused by our adapter, not missing
FFmpeg support. The codec parameters omitted `codec_type: AVMEDIA_TYPE_AUDIO`.
`avcodec_parameters_to_context()` therefore skipped its audio-field branch,
leaving the context sample rate at zero. AAC-LC updates it while decoding;
AAC-ELD emits a frame with the zero rate, rejected by `frame_validate()`.
A temporary native FFmpeg build instrumented `frame_validate()` and reproduced
an otherwise valid stereo/480-sample frame with `format=8`, a non-null buffer,
valid channel layout, and `sample_rate=0`. This independently identifies the
rejected field; no production FFmpeg source or binary was changed.
The original error entries remain historical evidence of that incorrect call.
They must not be read as a codec capability test.

The shared `libavAudioParameters()` now supplies the audio type explicitly and
uses libav.js's supported `channel_layoutmask` property. With the same binaries
and access units, all eight ELD configurations decode all twelve packets in
both portable and SIMD builds: 192 output frames in total, correct rate/channel/
frame lengths, finite nonzero PCM and clean EOF. The regression test also
removes only `codec_type` and reproduces the zero-rate error for every profile:
[`tests/web/libav-eld.test.mjs`](../../web/libav-eld.test.mjs).
No compiler flag or upstream codec modification was needed. The subsequent ELD migration uses libav.js in the existing epoch-scoped Worker
and removes the FDK runtime. Native FFmpeg PCM16 references validate all eight
profiles independently of the WASM build.

The single-packet P95 values in raw results use the browser's unisolated timer
resolution and can be quantized to 0.1 ms; use whole-workload medians for these
small differences. These runs show a repeatable AAC-LC gain and a smaller,
variable ALAC gain. The 48 kHz results prevent a blanket SIMD recommendation. These runs do not establish Tesla speedup, maximum concurrent
stream capacity, underrun prevention or whole-player CPU savings.

## URL fallback output validation

The retired custom URL fallback emitted planar float PCM, so the same browser workload was
repeated with `LIBAV_BENCH_PLANAR=1`, selecting all four stereo fixtures. Raw
results are `results/chromium-planar-run-{1,2,3}.json`. These runs use the same
warmup/order/iteration rules and production CSP, with no concurrent benchmark
or test suite. The third run replaces a discarded run that overlapped tests.
All portable/SIMD planar outputs also match byte-for-byte.

| Planar-float workload | SIMD processing-time change across three runs | Selection |
| --- | --- | --- |
| AAC-LC 44.1→48 kHz | −11.7% to −18.8% | SIMD when supported |
| 16-bit ALAC 44.1→48 kHz | −3.1% to −3.9% | SIMD when supported |
| AAC-LC 48→48 kHz | −2.1% to +31.6% | Portable |
| 16-bit ALAC 48→48 kHz | +8.1% to +16.6% | Portable |

The 48 kHz measurements remain variable; they do not justify enabling SIMD.
Unmeasured mono, higher-bit-depth ALAC and other rate pairs also use portable.
This is a conservative selection from measured workloads, not a claim that
portable is faster on every CPU. The low-level factory retains an explicit
SIMD option. The former `airplay-libav.js` URL policy is historical; current URL
playback uses the separately pinned AVPlayer runtime.

## ELD migration: old FDK versus libav.js

`results/eld-fdk-comparison-{1,2,3}.json` records three sequential Chromium 151
runs in a production-CSP module Worker on the same Xeon 8573C host. Each of the
8 real ELD fixture profiles uses the actual old FDK adapter, libav portable
adapter and libav SIMD adapter. PCM16 output stays at the source sample rate;
resampling and Worker round trips are excluded. All adapters receive the same
packets and return owned PCM. Six warmup rounds precede 30 measured rounds,
with 20 repetitions of each 12-packet fixture per round. Three-way execution
order rotates each round; loading, initialization and hashes are outside timing.
Decoder state remains continuous throughout the repeated stream.

| Profile | Portable libav time reduction versus FDK | SIMD time change versus portable | Selected |
| --- | --- | --- | --- |
| 44.1 kHz mono, 480 | 18.5–26.9% | −1.9% to −6.1% | SIMD |
| 44.1 kHz mono, 512 | 25.4–28.4% | −3.3% to −8.0% | SIMD |
| 44.1 kHz stereo, 480 | 40.0–48.2% | −4.5% to +8.6% | Portable |
| 44.1 kHz stereo, 512 | 32.7–47.8% | −7.8% to +9.2% | Portable |
| 48 kHz mono, 480 | 11.3–25.0% | −7.9% to 0.0% | Portable |
| 48 kHz mono, 512 | 25.4–29.2% | −4.0% to +4.2% | Portable |
| 48 kHz stereo, 480 | 39.8–47.2% | −4.5% to +6.2% | Portable |
| 48 kHz stereo, 512 | 39.1–49.2% | −4.5% to −8.6% | SIMD |

Only strictly positive SIMD gains in every run enable SIMD. Unsupported browsers
still use portable. The per-packet P95 values are in raw results, but the browser's
0.1 ms timer quantization limits small differences. Do not use these timings as
whole-player CPU utilization, speaker latency or Tesla performance measurements.
The old FDK build had a fixed 16 MiB WASM heap; libav.js starts at 24 MiB and permits
growth. This is configured linear-memory capacity, not measured resident/peak
process memory. The FDK build and libav build use their existing distinct
compilers/toolchains: the comparison is between the actual shipped artifacts,
not an isolated experiment attributing the difference solely to codec algorithms.

Portable/SIMD final-block PCM hashes agree in all timing runs. Separately, every
packet in all eight profiles matches independent native FFmpeg PCM16 references
in unit and actual-browser Worker tests. FDK and FFmpeg output are not required
to be byte-identical to one another. Physical listening remains unverified.

Reproduce the removed FDK baseline from its fixed historical commit; keep it
outside the production tree:

```sh
mkdir -p /tmp/eld-perf-baseline
git show 6d4e5018:site/play/vendor/aac-eld/aac-eld.js > /tmp/eld-perf-baseline/aac-eld.js
git show 6d4e5018:site/play/vendor/aac-eld/aac-eld.wasm > /tmp/eld-perf-baseline/aac-eld.wasm
node tests/bench/libav/eld-performance.mjs /tmp/eld-perf-baseline
```

## Reproduce

With Node 22 and installed `playwright-core` plus `/usr/bin/chromium`:

```sh
node tests/bench/libav/browser.mjs site/play/vendor/libav
LIBAV_BENCH_PLANAR=1 node tests/bench/libav/browser.mjs site/play/vendor/libav stereo
node tests/bench/libav/benchmark.mjs \
  "$PWD/site/play/vendor/libav/libav-6.10.9.0-tiplay.wasm.mjs" \
  "$PWD/site/play/vendor/libav/libav-6.10.9.0-tiplay-simd.wasm.mjs"
```

The Node runner exits nonzero on codec correctness failures. Browser output
contains separate codec errors; do not interpret completion as codec acceptance.
Run benchmarks sequentially. Node results are supplementary, not browser results.
The test server binds localhost only and the browser uses a module Worker without
SharedArrayBuffer, cross-origin isolation or WASM threads.

`alac-tone.json` contains only generated audio: FFmpeg's sine generator at
997 Hz, 44.1 kHz, one second, stereo, encoded with its native ALAC encoder:

```sh
ffmpeg -f lavfi -i 'sine=frequency=997:sample_rate=44100:duration=1' \
  -ac 2 -c:a alac alac-tone.m4a
ffprobe -show_packets -show_streams -show_data -of json alac-tone.m4a
```

`aac-48000-tone.json` and `alac-48000-tone.json` use the same generator at
48 kHz, with native AAC at 192 kbps and native ALAC respectively. These allow
checking decode performance without sample-rate conversion. An optional third
argument to the browser runner filters fixture names, e.g. `'48000 stereo'`.

The JSON retains the codec extradata and packet bytes from ffprobe's hex fields.
AAC fixtures reuse the repository's existing synthetic codec fixtures.

The final realtime pipeline normalizes all streams to 48 kHz in
`airplay-libav-worker.js`. The direct ELD adapter measured above is retained only
in `eld-adapter.mjs`; it is no longer a production transport path. Realtime ELD
therefore enables SIMD only for 48 kHz stereo/512. The 44.1 kHz ELD paths now add
resampling, an unmeasured composite workload, and conservatively remain portable.
These component measurements do not measure Worker IPC or complete playback CPU.
