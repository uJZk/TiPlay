# libav.js audio builds

Unmodified upstream libav.js 6.10.9, FFmpeg 9.0 and emfiberthreads 1.3, built with
Emscripten 4.0.7. Only AAC/ALAC decoders and audio resampling/format filters are
enabled; no encoders, network, asm.js fallback or WASM pthread target. Upstream's
emfiberthreads provides cooperative fibers without SharedArrayBuffer. Portable
uses `-O3`; SIMD adds `-msimd128` throughout compilation/linking. The low-level
factory checks actual SIMD support and owns separate runtime state per call.
Generated license headers retain FFmpeg LGPL 2.1+ and ISC/LGPL component notices.

Complete corresponding source archives are under `source/`, extracted from the
checksum-pinned npm distribution in `provenance.json`. No upstream DSP or codec
source changes were made. After activating Emscripten 4.0.7 and Node 22, with
make, patch, pkg-config and cmake on PATH, run:

```sh
python3 scripts/libav/build.py
```

The script verifies the source archive, runs upstream configuration/build tools,
and emits matching binaries, sources and hashes. `--output` permits an isolated
rebuild. Both variants and generated loaders have been independently reproduced
byte-for-byte. This Emscripten build is separate from the WASI helper.

`live-audio-software.js` and `airplay-libav-worker.js` decode realtime AAC-LC,
AAC-ELD and ALAC, and continuously convert non-48 kHz PCM, to PCM16/48 kHz before
NetEq L16. Opus enters NetEq directly. Workers are epoch-owned, bounded to four
software owners, and terminated on reset/cancellation. Source gaps reset the
filter run; EOF drains its finite tail. The AudioContext requests 48 kHz.

URL casting retains native decoding first and uses these modules on unsupported
AAC-LC/ALAC or native decoder errors. Network errors do not switch decoders;
midstream recovery preserves the previous PCM sample rate.

[Measured selection and limits](../../../../tests/bench/libav/README.md): supported
SIMD is selected for stereo AAC-LC and 16-bit ALAC 44.1→48 kHz. Realtime ELD
selects SIMD only for 48 kHz stereo/512. Other ELD/rate/layout/depth combinations
remain portable; direct 44.1 kHz ELD measurements do not establish gains after
resampling. `tests/bench/libav/eld-adapter.mjs` retains the direct source-rate
comparison adapter solely for benchmarking.

AAC-ELD's former zero-rate failures were caused by our omitted
`codec_type: AVMEDIA_TYPE_AUDIO`. `libavAudioParameters()` now supplies it and the
supported `channel_layoutmask`. All eight ELD profiles pass actual-WASM decoding
regression tests; independent native FFmpeg PCM16 references validate codec
output. FDK and browser libsoxr are removed. Android's separate native libsoxr
inputs remain under `scripts/soxr/vendor`. Physical vehicle acceptance is pending.
