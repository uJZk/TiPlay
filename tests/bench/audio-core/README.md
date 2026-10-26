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
