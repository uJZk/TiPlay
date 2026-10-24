# libsoxr WebAssembly measurements

The [engineering report](../../../scripts/soxr/REPORT.md) describes the current
complete-source WASM reactor, exact signal parity, public C API checks and measured
performance. [Wasm-current.json](Wasm-current.json) contains the current 28-format
static/slew comparison and three alternating timing runs.

Restore the checksummed preceding wasm2js engine into `work/` and compare using
exactly the same current JavaScript boundary adapter for both engines:

```sh
mkdir -p work
 git show 5ea829adf39d87bb1d3fc4360528fe5f3c590d7a:site/play/vendor/soxr/soxr.asm.js > work/soxr-before.mjs
node --disallow-code-generation-from-strings tests/bench/soxr/Wasm-benchmark.mjs \
  work/soxr-before.mjs > work/soxr-comparison.json
```

The benchmark verifies the historical factory's SHA-256 before loading it. A
shallow clone may need to fetch that commit. The old engine is a measurement
reference only; production loads `vendor/soxr/soxr.wasm`. To rebuild that library,
follow its [vendor README](../../../site/play/vendor/soxr/README.md).

The timing matrix covers 8 kHz mono, 44.1 kHz stereo and 48 kHz stereo at 48 kHz
output, with 500 warmup and 5,000 measured 128-frame blocks per case/repetition.
It records CPU, mean, p95, p99, maximum and deadline misses without discarding
outliers. The 28-format signal matrix covers all seven input rates, both output
rates, mono/stereo, irregular packets, static ratios and ±4.9% slew. All compared
samples and measured filter offsets must match exactly.

`initial/`, `final/` and the older probes/review files retain historical wasm2js
measurements. The old `prepare-bench.py`, `Benchmark.mjs`, `Dsp-probe.mjs` and
`Csp-worklet.mjs` reproduce those historical experiments using Git-restored
references. Their standalone CSP harness intentionally disabled WebAssembly and
does not validate the current WASM migration. These files are excluded from the
production build and browser cache.

For the current production CSP, actual AudioWorklet loading, clock and video
integration, run [media-clock.mjs](../../web-e2e/README.md#media-clock-and-actual-browser-output).
Desktop throughput does not establish vehicle sound, physical latency or thermal
performance, and isolated DSP timings do not certify a whole worklet deadline.
