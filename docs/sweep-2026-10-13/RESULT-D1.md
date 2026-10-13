# D1 — retired common URL-video remnants

## Evidence and changes

Followed STANDARDS.md rule 15 and registered all five exact paths in RETIRED-SCOPE.md before edits. These paths were already in the initial/integration scope; no additional upstream file was admitted. `git log --diff-filter=A` identifies the layout/diagnostics helpers as TiPlay additions in `6dbede08`.

- Removed the uncalled `AirPlayVideoSurfaceBridge.setVideoSize` API and its mutable source aspect/viewport cache. The incoming merge removed its only caller with Android Media3 URL-video decoding. Remaining bridge construction is for fixed 1280×720 still photos; `AirPlayPhotoFrames` already fits the bitmap inside that canvas. The existing full-canvas `glViewport` remains, and the redundant second identical viewport call is gone. EGL ownership, source timestamps, rendering and release callbacks are preserved.
- Deleted `AirPlayVideoLayout.kt` and `AirPlayVideoLayoutTest.kt`: no remaining production caller needs decoder aspect/pixel-ratio/rotation fitting. This supersedes the initial T2 viewport-cache optimization because the merged product no longer uses variable decoder geometry.
- Trimmed `AirPlayVideoDiagnostics` to the four actively emitted photo-encoder stages (`ENCODER_READY`, `PREPARE`, `ENCODER_CONFIG`, `ENCODED_FRAME`) and redacted failure reporting. Removed dead Media3 seek-origin, resource, audio format, decoder counters and numeric playback-error-code APIs. These had no live production callers after the incoming retirement.
- Updated diagnostics tests to use active stages and removed the one retired decoder-only test. Exception URL/message redaction and logger-failure containment assertions remain.

## Removed dedicated tests

- `AirPlayVideoLayoutTest.smallerLandscapeSourceUsesTheFullEncoderCanvas`
- `AirPlayVideoLayoutTest.portraitVideoIsCenteredAndPreservedWithoutCropping`
- `AirPlayVideoLayoutTest.nonSquarePixelsAndUnappliedRotationUseTheDisplayAspect`
- `AirPlayVideoLayoutTest.unknownOrInvalidVideoSizeCannotReplaceAValidDisplayAspect`
- `AirPlayVideoDiagnosticsTest.decoderEvidenceContainsOnlyDimensionsAndBufferCounters`

The four layout cases exclusively tested the retired decoder-size API, and the diagnostics case exclusively tested removed decoder counters. Current photo production scaling remains unchanged. Browser URL-video tests, current Bluetooth/media regressions, receiver settings, seek coalescing, launcher/UI entry and all R1/R2–R3 fixtures remain untouched. The existing redaction test is renamed from `recordsStagesAndCodesWithoutExceptionMessagesOrUrls` to `recordsStagesWithoutExceptionMessagesOrUrls` after removing the obsolete Media3 code argument.

## Other inspected remnants

The removed Media3 audio/data-source/clock/submission helpers and `PrivilegedUsbAutoConfirm` have no remaining non-documentation common implementation references. No resource was proven exclusively dependent on these retired paths, so none was removed. Upstream USB compatibility and current privileged permission behavior were retained. Shared files were read-only context and are owned by D2.

## Verification

- `git diff --check -- common/src`: passed.
- Whole-source reference scan: no remaining `AirPlayVideoLayout`, `setVideoSize` or diagnostics `SeekOrigin` references. Every retained diagnostics stage has a live production caller.
- Source inspection confirms the single remaining bridge construction uses 1280×720, so its previous fit result was exactly the full-canvas viewport.
- No Gradle invocation, per coordination. Full Android validation must be rerun centrally after all residue edits; retained `AirPlayVideoDiagnosticsTest` has two cases. Device EGL/codec behavior is not established by source inspection/JVM tests.

## Open decisions

No additional behavioral defect found or repaired in this pass. C1's separately recorded cross-thread playback-reference visibility issue remains outside retirement cleanup.
