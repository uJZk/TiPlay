# Browser audio resampler

TiPlay uses the SoX Resampler Library's stateful variable-rate engine for browser
audio. Each stream/format epoch retains its filter state across decoded packets;
rate adjustments specify a slew in output samples. This avoids packet boundaries
becoming periodic waveform changes. No external runtime download is used.

The exact upstream revision, archive checksums, binary checksum, compiler archive
and build configuration are authoritative in [provenance.json](provenance.json).
The original source and license notices are shipped as
[soxr-source.tar.gz](soxr-source.tar.gz), [LICENCE](LICENCE) and
[COPYING.LGPL](COPYING.LGPL). Libsoxr is LGPL-2.1-or-later; the TiPlay adapter and
build script use the project's GPL-3.0 license.

## Rebuild and replace

Use the Linux WASI SDK archive identified in `provenance.json`, verify its SHA-256
before extracting, and run from the repository root in a Linux container:

```sh
python3 scripts/soxr/build.py --sdk /absolute/path/to/the/extracted/wasi-sdk
```

The [build script](../../../../scripts/soxr/build.py) verifies the shipped source
archive and compiles it with the [C adapter](../../../../scripts/soxr/soxr-wrapper.c).
It writes `soxr.wasm` without incorporating the JavaScript application. The adapter
exports stream creation, processing, ratio slew and destruction; rebuilding the
same sources/toolchain reproduces the binary recorded in provenance. A changed
source or build must update provenance, checksum validation and acceptance together.

`soxr.wasm` remains a separate replaceable file, loaded through
`audio-resampler-loader.js` and instantiated in the AudioWorklet. A modified
compatible build can replace that file without relinking the TiPlay application.
For a hosted/offline copy, update the page cache identity and complete Service Worker
manifest so an older cached binary cannot mask the replacement. Keep complete
corresponding library source, adapter, build instructions and license notices with
distributed binaries; the ordinary source archive contains the rebuild materials.

## Timing contract

The pinned variable-rate backend's `vr_delay()` is an unimplemented constant.
It does not establish the content's actual filter delay. The wrapper measures an
impulse energy centroid for each format and the playout cursor accounts for that
content offset. Input lookahead, filter content delay, queued output and device
latency are separate quantities. In particular, do not add filter delay again to
an output feedback timestamp that already identifies the emitted content.

Only a real interruption, stream replacement or format change resets a stream's
filter state. Temporary lack of input never flushes the resampler as end-of-file.
The WASM loader requires the narrow `wasm-unsafe-eval` CSP permission; JavaScript
`unsafe-eval` remains disabled. Missing/invalid WASM reports an audio failure
instead of silently selecting a lower-quality timed playback implementation.
