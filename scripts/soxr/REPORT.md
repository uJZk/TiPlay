# TiPlay libsoxr WebAssembly engineering report

The browser uses genuine WebAssembly compiled from the complete pinned
chirlu/soxr source at `945b592b70470e29f917f4de89b4281fbbd540c0`. The shipped
reactor is **162,531 bytes**, SHA-256
`a0efdc6ef789ceb0c2057b575a066c8d4a933b2f89290aadd04769adec4e276f`.
Its wasm2js predecessor was 364,339 bytes. There is no generated JavaScript DSP
or production fallback. The browser delegates compilation to its native WASM
engine before audio rendering starts.

## Dependency and runtime design

The build retains upstream portable CR32, CR64 and VR32 engines, every upstream
sample IO format and the complete public libsoxr C API. It includes the complete
source archive and does not apply the earlier float32-only IO reduction. The
small `wasm.patch` gives VR processing and FFT32/FFT64 callbacks exact signatures
for WebAssembly indirect calls; it changes no filter coefficients, sample math,
phase clocks or quality parameters. Architecture-specific x86 SIMD backends are
not applicable to the portable WASM target. Clang uses `-O3 -flto`, Binaryen uses
`-O3`, and no fast-math is enabled.

`loadSoxr()` compiles once outside the audio callback. A compiled module is shared
with the AudioWorklet through `processorOptions`; synchronous instantiation creates
an isolated fixed 16 MiB memory before rendering. Calibration runs in its dedicated
worker, with a main-thread compatibility path that also awaits compilation.
Rendering does not fetch, compile or run calibration. Individual streams retain
independent libsoxr filter states in their runtime's heap. JavaScript boundaries
reject invalid formats, buffer lengths, ratio slews and closed handles.

The production CSP explicitly permits `'wasm-unsafe-eval'` without enabling dynamic
JavaScript evaluation. The loader uses streaming compilation for the correct WASM
MIME type and byte compilation otherwise; a failed load can be retried. A missing
or incompatible WASM engine is a startup failure rather than an implicit switch
to the slower wasm2js predecessor.

## Signal and ABI validation

[Wasm-current.json](../../tests/bench/soxr/Wasm-current.json) records 28 combinations:
8/16/24/32/44.1/48/96 kHz input, 44.1/48 kHz output and mono/stereo. Each combination
uses irregular 137-frame packets and a deterministic nonzero 997 Hz signal.
Both static ratios and a continuous ±4.9% drift/slew schedule produce **sample-exact
output** against the checksummed previous wasm2js engine. All samples are finite,
the silent stereo channel stays zero, and all measured impulse-energy-centroid
calibrations match exactly.

The browser tests additionally exercise:

- Full upstream constant-rate APIs with float32, float64, int32 and int16 IO,
  through both the CR32 and CR64 precision paths. These tests caught and required
  repairing FFT callback signatures; merely exporting those functions was not
  sufficient to establish they worked.
- Isolated runtime memories and filter state, fixed-memory growth rejection,
  invalid input bounds and idempotent disposal/closed-handle rejection.
- Real polyphase multitone preservation, arbitrary packet continuity,
  out-of-band alias suppression, drift, recovery and asynchronous calibration.

Run `node --test tests/web/soxr-wasm.test.mjs tests/web/continuous-audio.test.mjs
 tests/web/audio-calibration.test.mjs` for the focused checks, and the complete
browser/Android checks in [Testing](../../docs/Testing.md) for integration. The
Node fixture preloads the exact shipped WASM bytes; it does not substitute a DSP
stand-in. Current scoped checks pass. Broader integration results belong in the
project testing document.

## Measured performance

The current benchmark uses the identical production `StreamingResampler` adapter
for both engines, including WASM-boundary validation. It runs 128-frame render
quanta with drain-before-feed behavior, continuous 500 ppm drift and retained
filter state. Each case gets 500 warmup blocks and 5,000 measured blocks, repeated
three times with alternating engine order. The table is the median of the three
runs on Node 24.19.0 / V8 13.6.233.17, Linux x86_64. CPU excludes initialization;
wall timings include shared-host scheduling, wrapper and timer overhead.

| Input / channels; 48 kHz output | WASM CPU ms/audio second | Prior wasm2js CPU ms/audio second | CPU ratio |
| --- | ---: | ---: | ---: |
| 8 kHz / 1 | 1.51 | 11.10 | 7.35× |
| 44.1 kHz / 2 | 6.56 | 31.11 | 4.74× |
| 48 kHz / 2 | 5.23 | 26.36 | 5.04× |

Median per-block wall means are 0.0026/0.0174/0.0139 ms for WASM and
0.0238/0.0825/0.0702 ms for the previous engine in the same row order. The
one measured initial WASM compilation took 0.68 ms. These startup and throughput
numbers describe this host only; they are not predictions for a vehicle.

All supplied-feed blocks produce a complete quantum. Across the three repetitions
there was one WASM block over the 2.667 ms deadline in the 8 kHz case and one
wasm2js miss in each stereo case. Scheduling outliers remain in the raw evidence;
this is not hard real-time certification. Timeline/mixing/other worklet tasks and
physical speaker/panel timing are outside this isolated DSP benchmark.

Reproduce the comparison with the commands in the
[benchmark README](../../tests/bench/soxr/README.md). The checksummed previous
engine is restored under `work/` for measurement only, never to production vendor.

## Reproducibility and replacement

The pinned WASI SDK34 and Binaryen132 archives are verified before extraction.
`build.py` verifies the complete source archive, extracts into a fresh temporary
directory, applies the ABI-only patch and builds the reactor. A second fresh
build reproduced the shipped SHA-256 byte for byte. Use explicit stable Binaryen
feature flags: `--all-features` can enable experimental compact-import encoding
unsupported by current Node/Chromium engines.

The [vendor README](../../site/play/vendor/soxr/README.md), source archive,
compiler/bootstrap recipe, patch and LGPL/GPL notices accompany the artifact.
Users can rebuild and replace the library independently. There is no package
manager or compiler dependency at playback time.

## Android and historical evidence

Android SCO playback/capture still compiles its retained C/JNI engine directly
with the NDK. `prepare-native.py --check` confirms its existing float32-specialized
sources remain reproducible from `source/tiplay.patch`; the browser now uses the
separate `source/wasm.patch`. This browser migration does not silently change
Android SCO filter implementation or introduce a WASM runtime there.

The prior wasm2js engineering measurements and independent reviews remain under
`tests/bench/soxr/initial/`, `final/` and the existing review files as historical
evidence. Their CSP runs deliberately disabled WebAssembly and their performance
numbers describe the old implementation. They do not certify the current runtime.
Actual phone/vehicle sound, sustained thermal behavior and physical latency still
require the hardware acceptance recorded in [Todo](../../docs/Todo.md).
