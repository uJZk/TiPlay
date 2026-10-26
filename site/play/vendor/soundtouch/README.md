# SoundTouch tempo engine

The normal non-1x URL audio path uses the complete upstream **SoundTouch 2.4.0**
C++ library compiled to WebAssembly, using SIMD when available. Pitch and sample rate stay unchanged;
TiPlay changes tempo only. At 1x, Web Audio receives the decoded source PCM
directly without creating a tempo processor.

The unmodified upstream source archive is retained in
[`source/soundtouch-2.4.0.tar.gz`](source/soundtouch-2.4.0.tar.gz), together with the
small browser ABI in [`source/tempo-wrapper.cpp`](source/tempo-wrapper.cpp).
All upstream library translation units are compiled, including the rate/pitch
and BPM implementations. There is no forked correlation or stretching algorithm.
The ordinary optimizer/linker removes unreachable code from the final binary.
The library is LGPL-2.1-or-later; its complete upstream license is retained in
[`COPYING.LGPL`](COPYING.LGPL). TiPlay's loader and ABI use the project's GPL-3.0-only
license. Users can rebuild and replace either standalone `.wasm` file.

The adapter enables upstream hierarchical quick-seek, shares a fixed 20/5/5 ms
sequence/seek/overlap policy across live and URL audio, accepts 0.2–4.8x effective tempo,
and disables the rate converter's anti-alias filter because its rate
always stays exactly 1. The library's `flush()` supplies the exact finite source
duration; padding is never published as additional media. Each processor owns a
separate instance with 4 MiB initial and 16 MiB maximum linear memory. Input is
submitted and output drained in bounded 4096-frame batches. Quad/5.1 source planes
are copied once into a fixed 96 KiB input scratch; the C ABI fuses Web Audio speaker
downmix and interleave before submitting to upstream SoundTouch. It omits LFE and
retains floating-point headroom, with the same double-expression-to-float32 rounding
as the prior JavaScript speaker mapping. Mono/stereo retain direct JavaScript layout
stores because an extra planar-copy stage regressed measured cases. Exported
samples are owned copies, and close drops the instance references as well as freeing
native objects. Compilation is cached; instance state is never shared between streams.

## URL-only tempo

Live streams use official NetEq and no longer construct SoundTouch handles.
The URL adapter retains manual/automatic tempo composition and the existing
20/5/5 ms windows. The obsolete live constructor export is removed.

## Capability and performance policy

`soundTouchSimdSupported()` tests native SIMD support. Supported browsers use
`soundtouch.simd.wasm`; download, CSP and compilation failures remain explicit
errors. Browsers without SIMD use `soundtouch.wasm`; the separate SoundTouchJS
playback fallback has been removed to keep one implementation across all modes.
The bounded `audioTempoBackend` diagnostic reports `none`, `wasm-simd` or `wasm`.

The reproducible full-adapter benchmark is
[`tests/bench/soundtouch/run.mjs`](../../../../tests/bench/soundtouch/run.mjs).
It extracts the original JavaScript adapter and library from baseline commit
`5ea829adf39d87bb1d3fc4360528fe5f3c590d7a`, includes construction, input/output
copies, processing, finite flush and disposal, and checks output duration and
finite samples. It tests thirty seconds of stereo output at 44.1/48 kHz,
512/1024/4096-frame chunks and 0.5/1.25/2x tempo; five measured repetitions follow
two warmup repetitions.
Compilation/download are separate startup costs.

On Node 22.23.3 / AMD EPYC 9V45, SIMD was **1.06–1.96x faster by process CPU time**
than the original adapter across all 18 cases. Portable WASM ranged from
**0.79–1.10x**. These are historical results for the previous longer URL windows;
the shared 20/5/5 ms policy has not been benchmarked on a vehicle. Portable WASM
is now selected for implementation consistency, not a demonstrated speed gain. The recorded
[raw results](../../../../tests/bench/soundtouch/Results.json) identify the runtime,
CPU and metric. Those measurements do not establish vehicle CPU, end-to-end
latency or physical sound quality. Independent signal tests verify pitch,
duration, stereo isolation, short streams and independent processor lifetimes.
The separate [`planar.mjs`](../../../../tests/bench/soundtouch/planar.mjs) experiment
compares the preceding JS downmix/interleave adapter, an all-native input candidate
and the selected production policy using the same native DSP binary. Its retained
reference adapter is benchmark-only. Thirty-second multichannel signals, alternating
order and two warmup repetitions keep the copy/layout decision separate from DSP
startup. [Raw results](../../../../tests/bench/soundtouch/Planar-results.json) record
binary and adapter hashes. This experiment justifies retaining the direct
mono/stereo layout stores while fusing quad/5.1 conversion in the native ABI.

## Rebuild

Prepare the checksum-pinned WASI SDK 34 using
[`scripts/soxr/prepare-toolchain.py`](../../../../scripts/soxr/prepare-toolchain.py),
then run from the repository root:

```sh
python3 scripts/soundtouch/build.py --sdk /path/to/wasi-sdk-34.0-x86_64-linux
node --test tests/web/airplay-tempo.test.mjs tests/web/airplay-media.test.mjs
node tests/bench/soundtouch/run.mjs
node tests/bench/soundtouch/planar.mjs
```

The builder verifies the full source archive, compiles with SDK 34's clang 23,
and produces both portable and SIMD binaries. Exact source/binary hashes and
the upstream download URL are in [`provenance.json`](provenance.json).

The linked WASI libc/musl, LLVM compiler-rt and applicable C++ runtime notices
are retained in [wasm-runtime](../wasm-runtime/README.md), with exact SDK source
revisions and full license texts. Keep that shared notice directory with binary
distributions.
