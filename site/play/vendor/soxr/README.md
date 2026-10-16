# Browser audio resampler

TiPlay uses libsoxr's stateful variable-rate engine as a separately replaceable,
self-hosted JavaScript file: `soxr.asm.js`. It is Binaryen wasm2js typed JavaScript
(asm.js-like), **not validated legacy asm.js**. Playback needs no WebAssembly,
`eval`, Function constructor, CDN or external initializer. The production CSP
requires only `script-src 'self'` for scripts.

The exact revision, artifact/source hashes, compiler versions and configuration
are in [provenance.json](provenance.json). The complete pinned upstream source,
TiPlay float32 adapter, source patch and static packaging glue are under
[source](source/). [LICENCE](LICENCE) and [COPYING.LGPL](COPYING.LGPL) retain
libsoxr's LGPL-2.1-or-later terms. The TiPlay wrapper/build/glue is GPL-3.0-only;
the combined artifact is distributed under [GPL-3.0-only](LICENSE.GPL-3.0). Keep the complete source,
notices and replacement build materials with distributions.

## Rebuild and replace

From the repository root on Linux x86_64, with Python 3.12+, Node 22 and `patch`:

```sh
python3 scripts/soxr/prepare-toolchain.py work/soxr-toolchain
python3 scripts/soxr/build.py \
  --sdk work/soxr-toolchain/wasi-sdk-34.0-x86_64-linux \
  --binaryen work/soxr-toolchain/package
sha256sum site/play/vendor/soxr/soxr.asm.js
```

The bootstrap verifies toolchain archives before extraction. The build verifies
the source archive, applies the supplied patch, and compiles with clang/LTO and
Binaryen. WASM exists only as an intermediate offline compiler format; it is never
shipped or loaded by TiPlay. The final wasm2js optimization flag was selected by
measurement. A fresh build reproduced the recorded JavaScript SHA-256 exactly.

The synchronous ESM default export `createSoxr()` returns `{ exports }`, already
initialized. Its `memory.buffer`, `malloc/free` and `tiplay_*` ABI match
[streaming-resampler.js](../../streaming-resampler.js). Do not call `_initialize`
again. Each runtime has an isolated fixed 16 MiB heap; independent streams share
that heap and keep separate filter state. Only the exported interleaved float32
ABI is supported. Unreachable integer/float64 conversion and dither IO branches
were removed; vr32 filters, half-band stages, ratio-transition crossfades and the
64-bit phase clock remain intact. No fast-math or filter reduction is used.

A compatible modified library can replace `soxr.asm.js` without rebuilding the
application. Update its provenance, the page cache version and complete Service
Worker manifest together. The upstream archive and patch support rebuilding and
replacing the LGPL library independently of the application.

## Measurements

The [engineering report](../../../../scripts/soxr/REPORT.md) includes two independent
reviews, reproducibility, quality/continuity/drift tests, strict CSP AudioWorklet
execution and five rotating performance comparisons. Raw evidence and benchmark
preparation scripts are in [tests/bench/soxr](../../../../tests/bench/soxr/README.md).
Historical measurement references are restored into `work/` from checksummed Git
objects; no obsolete WASM binary or fallback is retained in production.

The final JS is 364,339 bytes, 28.6% smaller than the unpruned JS baseline. Measured
CPU gains vary by format; 44.1 kHz stereo improves, while 48 kHz stereo regresses
slightly against that JS baseline. Pure JS costs more CPU than the previous WASM.
Shared-host timing outliers remain in the report. These desktop measurements do
not establish sustained car-browser audio or video performance.

## Timing contract

Each stream/format epoch retains its filter state across packets; ratio changes
specify a slew in output samples. Only interruption, stream replacement or format
change resets the filter. Zero-length non-null input drains buffered output without
signalling EOF.

Upstream vr32's `vr_delay()` is incomplete. TiPlay measures impulse-energy centroid
per format and accounts for that content offset in its playout cursor. Filter
content delay, input lookahead, queued output and device latency are distinct;
filter delay must not be added again to a feedback timestamp that already
identifies emitted content. Existing playback caps and audio early/late windows
remain unchanged.
