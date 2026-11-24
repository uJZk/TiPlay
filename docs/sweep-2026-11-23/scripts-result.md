# Scripts, workflows and build configuration

Status: done. Reviewed the changed build scripts and configuration listed in SCOPE.md, including the source-patch validation, native symbol tooling, WASM packaging and Android/native workflow changes. Preserved pinned dependency and release verification contracts; no behavior-preserving cleanup was sufficiently justified, so no source files were changed. Generated binaries, vendor patches and lockfiles were not edited.

Checks: `python3 -m compileall -q scripts` passed; `python3 -m unittest discover -s scripts/webrtc -p 'test_*.py'` passed (25 tests); `python3 -m unittest discover -s tests/native -p 'test_rtc_audio_source_patches.py'` passed (14 tests). The complete build and workflow execution remain for the coordinator's full verification.

Open decisions: none identified.
