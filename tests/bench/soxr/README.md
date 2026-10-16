# libsoxr JavaScript measurements

The final [engineering report](../../../scripts/soxr/REPORT.md) describes the test
scope, raw results, two independent reviews and limits. `final/` contains the
selected artifact's full matrix and five rotating comparisons. `initial/` retains
the earlier candidate/flag comparison as measurement evidence. These files do not
participate in the production build or browser cache.

Restore the exact historical WASM and JS measurement references into a temporary
`work/` directory, verifying checksums and using the pinned Binaryen 132 toolchain:

```sh
python3 tests/bench/soxr/prepare-bench.py --repo . \
  --binaryen work/soxr-toolchain/package --output work/soxr-bench
node --disallow-code-generation-from-strings work/soxr-bench/Benchmark.mjs \
  "$PWD/site/play/vendor/soxr/soxr.asm.js" 4000 500
node --disallow-code-generation-from-strings work/soxr-bench/Benchmark.mjs wasm 4000 500
node --disallow-code-generation-from-strings work/soxr-bench/Benchmark.mjs \
  "$PWD/work/soxr-bench/baseline.mjs" 4000 500
node --disallow-code-generation-from-strings work/soxr-bench/Dsp-probe.mjs \
  "$PWD/site/play/vendor/soxr/soxr.asm.js"
```

`prepare-bench.py` takes the reference engine and adapter from TiPlay commit
`16c8c32fa920822d3faf3090f3b80d616a8b09c3`. A shallow checkout may require fetching
that commit first. The baseline is exclusively a measurement reference; TiPlay
loads only the final JavaScript engine. Do not copy the reference into vendor.

To reproduce the standalone strict CSP worklet check, install `playwright-core`
outside the repository and set `NODE_PATH` plus `CHROMIUM` as for browser E2E:

```sh
cp site/play/vendor/soxr/soxr.asm.js work/soxr-bench/final.mjs
node work/soxr-bench/Csp-worklet.mjs "$PWD/work/soxr-bench/final.mjs"
```

The archived CSP probes document the independent review's standalone harness. For
current production integration and video pacing, run
[`media-clock.mjs`](../../web-e2e/README.md#media-clock-and-actual-browser-output),
which uses the exact current CSP, AudioWorklet and browser decoder code.
