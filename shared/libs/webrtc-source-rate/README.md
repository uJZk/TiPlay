# TiPlay source-rate Android WebRTC

This local Ivy artifact is built from the pinned M150 source and TiPlay patches,
not the publisher Maven binary. It contains all four supported Android ABIs.
The adjacent provenance JSON identifies the source, patches, test and AAR hash;
the generated component notices are in `LICENSE.md` and are also included in the
APK assets. The build driver and patches are in `scripts/webrtc/`.

`python3 scripts/webrtc/verify_release_aar.py` checks the artifact hash, ABI
inventory and 64-bit ELF 16 KiB load alignment. Final APK verification must also
check its JNI inventory and zip alignment; an AAR check is not an APK check.
