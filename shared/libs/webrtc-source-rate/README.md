# TiPlay source-rate Android WebRTC

This local Ivy artifact is built from pinned M150 sources and TiPlay patches.
It contains all four supported Android ABIs. The adjacent provenance JSON binds
the exact source, patches, focused tests, AAR and matching private symbol archive;
component notices are generated in `LICENSE.md` and also packaged in APK assets.
The build driver and patches are in `scripts/webrtc/`.

`python3 scripts/webrtc/verify_release_aar.py` checks the artifact hash, ABI
inventory and 64-bit ELF 16 KiB load alignment. Final APK verification also checks
the actual JNI payload, source patch/provenance and ZIP alignment.

## Producer and rebuilding

The adopted AAR was produced by [run 41382204134](https://github.com/uJZk/TiPlay/actions/runs/41382204134)
at source commit `aef6c97a2402f4f5ef4a821a876a11941116d180`. Its eleven focused
native tests include a configured encoder receiving late sending-state updates
after Stop. Four matching unstripped libraries and their Build ID index were
verified against the AAR and retained in the authenticated symbol draft identified
by provenance. Those symbols apply only to these new Build IDs.

Run the **Native source-rate WebRTC** workflow. It reuses
`webrtc-sdk/webrtc-build@06e3410d8f67d08202e26f55225705596b60778e`, its Android
environment, common GN configuration and three compatibility patches. TiPlay adds
the source-rate patch, including the post-stop guard, and retains upstream warning
policy. The Java check compares unchanged and legacy-patched class bytes. The
workflow fixes source/depot revisions, bounds concurrency and runs focused tests
before packaging. `publisher-compat.patch` is only the historical equivalence
reference; new builds apply the three pinned upstream patches directly.

Select `x86_64` for an emulator candidate or `all` for a release candidate. The
workflow uploads AAR, licenses, checksums, provenance and symbols, then retains
symbols in an authenticated draft. It does not replace the committed AAR or
publish an APK. Validate candidates with the [native probe](../../../tests/native/README.md),
all-ABI checks and final APK verification before adoption. Native/source tests do
not establish picture correctness, physical performance or vehicle stability.
