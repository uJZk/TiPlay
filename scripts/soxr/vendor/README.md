# Native Android libsoxr source inputs

Only Android SCO resampling uses libsoxr. The browser now uses libav.js continuous
resampling in its decoder Workers and a 48 kHz NetEq/Web Audio graph.

`source/soxr-source.tar.gz` is the complete upstream source at commit
`945b592b70470e29f917f4de89b4281fbbd540c0`, SHA-256
`ae970b44833c7dd2b088d5928b27c7f1796198ff5bc5386b90393aaf33e53d51`.
`source/tiplay.patch` retains the Android variable-rate/kernel modifications.
Upstream LGPL/BSD notices accompany the source; project changes retain GPL-3.0.

Run `python3 scripts/soxr/prepare-native.py --check` to verify the checked-in
Android source subset. No browser libsoxr loader or binary is shipped.
The old browser wrapper, source patch, WASM builder and runtime tests were removed.
