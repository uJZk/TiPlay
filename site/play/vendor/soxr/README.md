# Browser audio resampler

TiPlay runs the pinned upstream libsoxr in genuine WebAssembly, self-hosted as
`soxr.wasm`. `soxr.js` compiles it once outside audio rendering, then a compiled
`WebAssembly.Module` is passed to the AudioWorklet in `processorOptions`. Every
runtime instantiates its own fixed 16 MiB heap before rendering begins. Playback
uses no generated JavaScript DSP, `eval`, Function constructor, CDN or external
initializer. The production script policy allows `'wasm-unsafe-eval'` solely for
WebAssembly compilation; it does not allow dynamic JavaScript evaluation.

[provenance.json](provenance.json) records the upstream revision, source/artifact
hashes, compiler versions and configuration. The complete upstream archive and
small WebAssembly ABI patch accompany the binary under [source](source/). The
build includes the portable constant-rate float32 and float64 engines, variable
rate engine, every upstream IO format and the complete public libsoxr C API.
It does not apply the historical float32-only IO reduction. SIMD backends for
other processor architectures are naturally excluded by the portable WASM target.

[LICENCE](LICENCE) and [COPYING.LGPL](COPYING.LGPL) retain LGPL-2.1-or-later terms.
The TiPlay adapter/glue is GPL-3.0-only and the combined artifact is distributed
under [GPL-3.0-only](LICENSE.GPL-3.0). Keep the complete source, notices and
replacement build materials with distributions.

## Rebuild and replace

From the repository root on Linux x86_64, with Python 3.12+, Node 22 and `patch`:

```sh
python3 scripts/soxr/prepare-toolchain.py work/soxr-toolchain
python3 scripts/soxr/build.py \
  --sdk work/soxr-toolchain/wasi-sdk-34.0-x86_64-linux \
  --binaryen work/soxr-toolchain/package
sha256sum site/play/vendor/soxr/soxr.wasm
```

The bootstrap verifies archives before extraction; the build verifies upstream
source, applies `wasm.patch`, then compiles with clang/LTO and Binaryen. Its only
source modifications provide exact indirect-call signatures required by
WebAssembly; filter math, IO formats and phase clocks remain upstream code. A
fresh extracted-source rebuild reproduces the recorded SHA-256 exactly. There is
no fast-math, filter reduction, wasm2js conversion or runtime compiler dependency.

The library can be replaced independently by another compatible `soxr.wasm`.
Preserve the TiPlay `tiplay_*`, `malloc/free`, `memory` and `_initialize` exports
or update [streaming-resampler.js](../../streaming-resampler.js) with the replacement
ABI. Update provenance, the browser cache revision and Service Worker manifest
with the replacement. `source/tiplay.patch` remains solely for reproducing the
retained native/JNI library; the browser build uses `source/wasm.patch`.

## Runtime and timing contract

`loadSoxr()` fetches/compiles once, deduplicates concurrent requests and permits a
retry after failure. `prepareSoxr(module)` installs already compiled code in a
worker/worklet. `SoxrRuntime({ module, allowCalibration })` synchronously creates an
isolated instance and initializes it exactly once. Never fetch, compile or measure
filter delay in `AudioWorkletProcessor.process()`. Streams retain independent
filter state while sharing their runtime's heap. The public C API uses the WASM32
C ABI, including explicit return pointers for structure-valued functions.

Each stream/format epoch retains its filter state across packets; ratio changes
specify a slew in output samples. Only interruption, stream replacement or format
change resets the filter. Zero-length **non-null** input drains buffered output
without signalling EOF. Closed handles and invalid formats/buffer capacities are
rejected at the JavaScript boundary.

Upstream vr32's `vr_delay()` is incomplete. TiPlay measures impulse-energy centroid
per format away from rendering and accounts for that content offset in its
playout cursor. Filter content delay, input lookahead, queued output and device
latency are distinct; do not add filter delay again to a feedback timestamp that
already identifies emitted content.

The [engineering report](../../../../scripts/soxr/REPORT.md) and
[benchmark materials](../../../../tests/bench/soxr/README.md) describe current
waveform equivalence, full-library ABI checks, measured CPU improvements and
physical-device limits. Historical wasm2js evidence remains under tests/bench;
that engine is not shipped or used as a fallback.

The linked WASI libc/musl, LLVM compiler-rt and applicable C++ runtime notices
are retained in [wasm-runtime](../wasm-runtime/README.md), with exact SDK source
revisions and full license texts. Keep that shared notice directory with binary
distributions.
