# Audio signal kernels

Run with Node 22 from the repository root:

```sh
node tests/bench/audio-core/run.mjs
node tests/bench/audio-core/signals.mjs
```

`run.mjs` compares the original per-frame JavaScript mixer with the WASM bulk
mixer, including interleaved input staging and planar output copies. Both paths
perform voice focus, mono/stereo mapping, final clipping and optional scalar
measurements. Five trials alternate execution order and report median microseconds
per block; each path warms independently. `result.jsonl` records one x86-64 Linux /
Node 22.23.3 run. Its 32 cases span 64/128/256/1024-frame quanta, 1/2/4/8 streams,
and Debug off/on; measured speedups are 2.16–3.57×. This is CPU evidence for these
kernels, not a device deadline, end-to-end latency or vehicle audio measurement.

`signals.mjs` compares crossfade and PCM16 conversion including boundary copies.
Small PCM16 conversions retain JavaScript below 256 samples: its copy overhead
outweighed the numeric loop at 64/128 samples. Bulk crossfades and larger conversions
benefit from WASM. No fast-math, resampler quality or timing policy change is used.

The real signal and lifecycle acceptance remains in `tests/web/audio-core.test.mjs`,
`audio-worklet-mixing.test.mjs`, `continuous-audio.test.mjs`,
`continuous-voice-preparation.test.mjs`, and the deadline/recovery suites. They check
PCM waveforms, retired-tail source age, focus transitions and independent source
identity using the production kernels and real libsoxr.

## URL speaker downmix boundary

```sh
python3 tests/bench/audio-core/build-downmix.py \
  --sdk work/soxr-toolchain/wasi-sdk-34.0-x86_64-linux
node tests/bench/audio-core/downmix.mjs > work/downmix-comparison.json
```

`downmix.mjs` compares the original speaker-mapping loop, the optimized JavaScript
fallback and separate-boundary scalar/SIMD WASM probes. It includes all planar
input staging, output copies and allocations, validates sample-exact output for
quad/5.1 layouts, and alternates five repetitions across 128–32,768-frame blocks.
`downmix-results.json` retains one Node 22.23.3 run with every trial. The optimized
JS binds channels and selects the layout once, improving the original loop by
1.15–2.75× in that run. For 128–1,024-frame blocks, a separate WASM boundary usually
costs more than the saved arithmetic; bulk results vary and SIMD has a clearer
advantage at 8,192 frames and above. Shared-host allocation/scheduling noise is
retained, so small timing differences do not establish a universal threshold.

These measurement-only probes are not browser assets. Production fuses planar
speaker downmix and stereo interleaving into the already loaded SoundTouch WASM
adapter, avoiding a second module and the intermediate stereo copies measured
here. The non-SIMD path retains the optimized JS fallback. The complete fused
adapter measurements belong with the [SoundTouch benchmarks](../../../site/play/vendor/soundtouch/README.md).
At ordinary 1× speed, the browser continues to perform its native speaker mapping.
