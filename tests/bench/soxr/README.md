# Historical libsoxr WebAssembly measurements

These reports compare the former browser libsoxr WASM and wasm2js engines.
Browser realtime audio now uses native RTP or libav/PCM-NetEq; URL playback uses
AVPlayer. Native Android SCO still uses libsoxr. The benchmark files and raw
results are retained as measurements, not current browser playback acceptance.

The [historical engineering report](https://github.com/uJZk/TiPlay/blob/6d4e5018/scripts/soxr/REPORT.md)
and [vendor notes](https://github.com/uJZk/TiPlay/blob/6d4e5018/site/play/vendor/soxr/README.md)
record the complete-source WASM reactor, signal parity, C API and toolchain.
[Wasm-current.json](Wasm-current.json) contains the 28-format static/slew comparison
and three alternating timing runs; “current” identifies that recorded experiment.

## Reproduce historical comparisons

The current source no longer contains `streaming-resampler.js` or the browser
libsoxr binary. Run the retained harness in a disposable checkout of its matching
historical source, rather than restoring removed runtime files into production:

```sh
git worktree add --detach /tmp/tiplay-soxr-history 6d4e5018
cd /tmp/tiplay-soxr-history
mkdir -p work
git show 5ea829adf39d87bb1d3fc4360528fe5f3c590d7a:site/play/vendor/soxr/soxr.asm.js > work/soxr-before.mjs
node --disallow-code-generation-from-strings tests/bench/soxr/Wasm-benchmark.mjs \
  work/soxr-before.mjs > work/soxr-comparison.json
```

The harness verifies the historical factory's SHA-256. A shallow clone may need
to fetch those commits. The timing matrix covers 8 kHz mono, 44.1 kHz stereo and
48 kHz stereo at 48 kHz output, with 500 warmup and 5,000 measured 128-frame blocks
per case/repetition. The signal matrix covers seven input rates, two output rates,
mono/stereo, irregular packets, static ratios and ±4.9% slew. Compared samples and
measured filter offsets must match exactly.

`initial/`, `final/` and the older review/probe files describe historical wasm2js
candidates. Their strict-CSP harness disabled WebAssembly deliberately; it does
not describe the current production CSP. See the [current media-clock check](../../web-e2e/README.md#media-clock-and-actual-browser-output)
for NetEq/audio-core AudioWorklet coverage. Desktop throughput cannot establish
vehicle sound, physical latency, thermal performance or a whole-worklet deadline.
