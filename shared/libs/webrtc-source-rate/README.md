# TiPlay source-rate Android WebRTC

This local Ivy artifact is built from the pinned M150 source and TiPlay patches,
not the publisher Maven binary. It contains all four supported Android ABIs.
The adjacent provenance JSON identifies the source, patches, test and AAR hash;
the generated component notices are in `LICENSE.md` and are also included in the
APK assets. The build driver and patches are in `scripts/webrtc/`.

`python3 scripts/webrtc/verify_release_aar.py` checks the artifact hash, ABI
inventory and 64-bit ELF 16 KiB load alignment. Final APK verification must also
check its JNI inventory and zip alignment; an AAR check is not an APK check.

## Rebuilding

Run the **Native source-rate WebRTC** workflow in GitHub Actions. It checks out
`webrtc-sdk/webrtc-build@06e3410d8f67d08202e26f55225705596b60778e` and reuses
the Android environment setup from its Dockerfile, common GN configuration and
three compatibility patches. TiPlay adds only the unchanged source-rate patch
and uses the upstream Android warning policy. The workflow builds an AAR only, retains the
fixed source/depot revisions and bounded build concurrency, and runs the focused
native tests before packaging.

Select `x86_64` for an emulator candidate or `all` for a release candidate. The
workflow uploads the AAR, licenses, checksums and provenance; it does not replace
the committed artifact or publish an APK. Validate the rebuilt candidate through
the [native probe](../../../tests/native/README.md), then verify all four ABIs,
licenses, ELF alignment and the final APK before adopting it.

The adjacent AAR and provenance still describe the previously verified producer.
`scripts/webrtc/publisher-compat.patch` preserves that artifact's combined
compatibility fingerprint. New builds take the three upstream patches directly
from the pinned producer and compile Java unchanged using its Android warning
policy. Provenance records the actual patches and GN arguments. The Java check
compares unchanged and legacy-patched class bytes; production native warnings
are also nonfatal, as in the upstream build. No Kotlin media behavior or native
source-rate policy changes as part of this build refactoring.
