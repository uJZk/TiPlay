# Post-merge retirement residue scope

User clarification on post-merge cleanup: “合并代码引入后退役的代码也纳入清理范围”. Expand the review from incoming diffs to TiPlay-owned support implementations, branches, resources and dedicated tests that became unused after imported retirements (browser-native URL video replacing Android Media3 URL transfer/timing; privileged USB confirmation removal; updated Bluetooth microphone/media route). This does not authorize removal of current browser/session/media behavior or inherited upstream compatibility files.

Owners: C1 common; C2 shared excluding all R2–R3 files/fixtures; C3 browser/tests excluding vendors/generated. Scan references read-only across the tree, then record exact additional paths with retirement/use evidence before editing. Existing initial SCOPE.md or INTEGRATION-SCOPE.md paths are already permitted. For outside-list files, append their exact paths and reason here before deletion/cleanup. Preserve meaningful current regression assertions; delete only dedicated coverage for retired contracts. Public/current docs may lose dead implementation links; preserve historical evidence. No speculative feature/policy changes, dependencies or upstream renames/deletions. Repairs remain separate owners.

## Additional paths and evidence

Pending owner review.

### D2 — shared support remnants

- `shared/src/main/java/com/shilapi/xcertplay/media/VideoTeeMediaSink.kt` and `shared/src/test/java/com/shilapi/xcertplay/media/VideoTeeMediaSinkTest.kt`: TiPlay-owned original SCOPE.md paths. Production caller retired in `9ac0048c`; repository reference search finds only the dedicated test and old RealPhone E2E fixture. Coordinator confirms the user's original obsolete-code/test cleanup includes this earlier remnant. Delete the adapter and its three retired primary-plus-tap tests after switching the fixture to the current adapter.
- `tests/web-e2e/RealPhone.java`: replace the sole remaining fixture use with `BrowserOnlyMediaSink(androidSink, tap)`, matching current production; retain clock/recovery/diagnostic handlers, frame/session isolation, bounded async logging and teardown. Remove only the retired adapter's error callback; preserve the logger overflow failure signal and its check.
- `tests/web-e2e/phone-run.mjs` and `tests/web-e2e/README.md`: update adapter-path descriptions only. Preserve all current media, restart, diagnostic and failure assertions. BrowserOnlyMediaSinkTest remains unchanged and covers current video/audio routing.
- `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverResourceRequests.kt`: comment-only cleanup of the retired Media3 consumer description. The helper remains active through ReceiverServer resource acquisition and the browser video proxy's iPhone resource callback, so its implementation and dedicated tests stay. Replace only the misleading claim that a current seek cancels a Media3 waiter.
- Retain `shared/src/main/java/com/shilapi/xcertplay/airplay/VideoMediaClockMapping.kt` and its tests: `NtpClock.mediaTimeNanos` calls `toMonotonic` in production; CarPlayMediaEngine and ReceiverMirrorStream install this clock for current CarPlay/mirroring streams. It is not an exclusively retired URL-video helper.

## D1 — common retired Android URL-video support

Exact paths (all already covered by initial/integration scope; listed here before retirement edits):

- `common/src/main/java/com/shilapi/xcertplay/AirPlayVideoSurfaceBridge.kt`: `setVideoSize` has no production caller after imported Media3 player deletion. Remaining caller is still-photo encoder with fixed 1280×720 geometry; `AirPlayPhotoFrames` draws aspect-preserved images into that canvas. Remove dead decoder-size setter and variable-aspect viewport state; retain full-canvas GL render, timestamps and release protocol.
- `common/src/main/java/com/shilapi/xcertplay/AirPlayVideoLayout.kt`: only production uses are the now-uncalled setter and its constant full-canvas viewport calculation. TiPlay-owned helper introduced for retired Android URL-video decoder dimensions; delete after bridge simplification.
- `common/src/test/java/com/shilapi/xcertplay/AirPlayVideoLayoutTest.kt`: dedicated decoder aspect/rotation/fit tests have no surviving production contract after helper retirement.
- `common/src/main/java/com/shilapi/xcertplay/AirPlayVideoDiagnostics.kt`: retain still-photo encoder stages and exception-class redaction; remove seek/audio/decoder/resource metadata APIs and enum constants with no production callers. The optional Media3 numeric error code has only a test caller after merge.
- `common/src/test/java/com/shilapi/xcertplay/AirPlayVideoDiagnosticsTest.kt`: retire decoder-only dimensions/counters case; keep redaction and unavailable-logger behavior assertions using active stages.

Read-only references scanned throughout common/shared source. No R1 files, shared source, upstream compatibility identifiers or current Bluetooth/browser-media regression files are part of these edits. PrivilegedUsbAutoConfirm and its old caller are already absent; no common-side implementation reference remains to retire.

## D3 browser residue paths and evidence

- `site/play/airplay-controls.js` and `tests/web/airplay-controls.test.mjs`: `timeLabel` was used only by the former custom seek-range/time labels (`37e810ee` lines 68–69). Incoming Video.js controls removed both production calls. Current non-vendor source search finds only the helper and its dedicated unit test. Remove the retired helper and only its test; retain `playbackState` validation and current player E2E.
- `site/play/video.js`: the `onPresentation` option and per-draw sample object exclusively fed the removed recording-time overlay. Incoming `app.js` and `decoder-worker.js` removed all producers/consumers; repository code/test search finds only the option/default and invocation. Remove this retired callback path, keeping current FPS/offset statistics, timing/drop policy and frame ownership.
- `tests/web/media-timing.test.mjs`: its test named “AirPlay video deadlines and decoded buffering fit the 500ms submission limit” actually uses generic `{}` configuration and exercises still-current fallback delay and queue behavior. Keep assertions; correct the obsolete feature-specific name to describe the remaining fallback contract.
- `site/play/sw.js`: advance v34 to v35 for the runtime asset removals. No asset file is deleted; ASSETS stays unchanged.

All paths already occur in the initial/integration scopes; this subsection records the now-explicit authorization to remove retired exported support APIs, superseding the earlier C3 decision to preserve them. No additional outside-list path is required.
