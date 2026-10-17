# Native libsoxr

Generated from the same archive, commit `945b592b70470e29f917f4de89b4281fbbd540c0`,
float32 IO patch and vr32/HQ/64-bit phase configuration as the
[browser backend](../../../../../site/play/vendor/soxr/README.md).
Only the required C files and headers are retained. The historical
`vr_process_wasm` name in the shared ABI adapter does not introduce a WASM runtime.

Regenerate with `python3 scripts/soxr/prepare-native.py`; verify with `--check`.
The Android NDK builds these sources directly into `libtiplay_soxr.so` for each
configured ABI. No JS compiler, browser engine or WASM is used on Android.
`soxr_jni.c` has per-stream state/counts and never treats a temporary shortage as EOF.

Original libsoxr copyright and LGPL-2.1-or-later terms are retained in the source,
LICENCE and COPYING.LGPL. TiPlay's JNI/packet glue is GPL-3.0-only; see the project
third-party notices and browser source archive for the complete corresponding source.
