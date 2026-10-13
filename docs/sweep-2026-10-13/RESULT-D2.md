# D2 — shared retirement residue review

Reviewed shared support code and tests beyond the incoming diff under STANDARDS.md rule 15. Exact extra scope/use evidence was recorded in RETIRED-SCOPE.md before editing. R2–R3 source/test files and fixtures were not edited.

## Change

- `ReceiverResourceRequests.kt`: replaced the obsolete Media3 seek-waiter comment with its current bounded FCUP request-sharing contract. Implementation is still used by ReceiverServer and the browser video proxy; no behavior or tests changed.
- Removed TiPlay-owned `VideoTeeMediaSink.kt` and `VideoTeeMediaSinkTest.kt` after confirming no production caller and moving the sole E2E fixture caller to current `BrowserOnlyMediaSink(androidSink, tap)`. Updated only path descriptions in phone-run.mjs and its README. RealPhone still installs clock/recovery/diagnostic handlers, exercises late retired-session callbacks, uses bounded async logging and closes resources on failure/shutdown. The old adapter error callback is removed; the logger's overflow `tap-error` signal and runner assertion remain.

## Active paths retained

- `VideoMediaClockMapping.toMonotonic` has a production caller in `NtpClock.mediaTimeNanos`. CarPlayMediaEngine installs the session media clock, and ReceiverMirrorStream installs the mirror clock. Keep VideoMediaClockMappingTest, MediaClockMappingTest, MediaClockDiagnosticsTest, PeerInitiatedTimingTest and OrdinaryAirPlayTimingTest: they verify current CarPlay/mirroring behavior, not retired Android URL-video transfer.
- BrowserMicrophone now packetizes AndroidBluetoothVoiceChannel capture. Its encrypted RTP ordering/nonce continuity tests remain current despite the historical class name.
- ReceiverResourceRequestsTest still protects exchange reuse, fixed deadlines, bounded pending requests, peer/session isolation and stale replies for active iPhone resource loading.
- VideoSurfaceHandoff defines SurfaceDetachRequest/detachAction used by AndroidMediaSink; its filename alone is not evidence of dead URL-video code. Preserve inherited compatibility and teardown coverage.
- WebMediaSink/WebVideoHub/WebVideoRecords still carry mapped timestamps for CarPlay and AirPlay mirroring. Removing URL-video scheduling does not retire those transport fields or regression tests.
- Imported changes already removed PrivilegedUsbPermission, its IphoneUsbHost invocation, RootShell's accessibility setup helper and its dedicated test. No remaining shared production/test references to those symbols were found. Imported browser microphone handlers and AIRPLAY_VIDEO mode were already removed; their active replacement routing remains.

## Retired test evidence

VideoTeeMediaSink was introduced by TiPlay and its production caller retired in `9ac0048c` (browser-only phone rendering). Both files already appear in original SCOPE.md. Coordinator confirmed the user's original obsolete-code/test cleanup includes this earlier remnant. Removed its three dedicated tests: `videoGoesToThePrimaryThenTheTapWithTheSameArray`, `audioMicrophoneAndIapGoToThePrimaryOnly`, and `aFailingTapIsReportedAndNeverStopsThePrimary`. These assert the retired dual-video/primary-audio/failure-isolation contract. Retained BrowserOnlyMediaSinkTest's `compressedVideoBypassesAndroidWithoutCopyingOrLosingTimestamps` and `audioAndMicrophoneReachOnlyTheBrowser`, plus all current phone E2E assertions, as coverage of the current routing contract.

## Verification

Reference searches and retirement history review completed. No executable source/test references to VideoTeeMediaSink remain; historical sweep records are retained. Targeted `git diff --check` and `node --check tests/web-e2e/phone-run.mjs` passed. No Gradle, commit, push or network actions were run. Coordinator owns the full Android and phone E2E rerun. D2 files are frozen for validation.

## Coordinator phone-fixture correction

The final compiled-phone E2E found three pre-existing stale Java constructor calls after importing current Kotlin interfaces. The coordinator supplied BrowserLinkStatus.endpoint=null, a normal WebAudioHub for BrowserLinkServer, and explicit CARPLAY source/mode for WebMediaSink. Production code and compiled Android outputs are unchanged; rerun the phone E2E without weakening its runtime assertions. TIE-UP-PHONE-INITIAL-CONSTRUCTORS.txt preserves the compile evidence.

The next phone E2E exposed an outdated test static-host restriction that rejected every nested asset, including newly imported Video.js vendor files required by service-worker precache. The host now allows nested regular files only within its configured root, retaining outside-root rejection. The service-worker assertion remains and gains failure-only response/error detail; no production or runtime assertion was weakened. Initial failure: TIE-UP-PHONE-INITIAL-VENDOR.txt.

Failure-only stats evidence showed all synthetic frames were correctly expired (`scheduledExpiredFrames=120`, `presentationOffsetSamples=0`): the old fixture placed every CarPlay timestamp 50 ms in the past, incompatible with the current explicitly configured zero raw deadline. The fixture now models scheduled future presentation 250 ms ahead of arrival, within the existing timing-record validity bound; production deadlines are unchanged. Added a positive actual-draw assertion before the unchanged all-session-log-fields assertion. Timing availability was not faked or made optional. TIE-UP-PHONE-STATS-EVIDENCE.txt retains the evidence.

The updated normal WebAudioHub enables the current authenticated `/audio` stream after user interaction. The old video-only pairing-query assertion was retired: it now allows the code only on authenticated `/video` or `/audio`, retains foreign-origin rejection and every no-Referer/CSP/session-isolation assertion, and rejects code leakage to all other paths. This matches the actual current protocol, rather than disabling audio merely to satisfy the old fixture. TIE-UP-PHONE-INITIAL-AUDIO-CONTRACT.txt retains the failure.

Restart failure-only evidence identified a deterministic fixture race: the new-session first-frame diagnostic can arrive before its first periodic stats sample, so `decodedAfterRestart` was undefined and every `decoded > undefined + 20` comparison was false (NaN), despite the final snapshot showing 660 decoded frames and ~30 fps. The fixture now waits for a finite new-session decode counter before requiring 20 further decoded frames; timeout and progress threshold are unchanged. This strengthens the actual progress check rather than relaxing it. TIE-UP-PHONE-RESTART-EVIDENCE.txt preserves the evidence.

## Final integrated coordinator checks

The final source commit 91430639 passed the complete Android task set: 1352 shared + 1067 common + 4 home = 2423 tests, zero failures/errors/skips, and all three lint/debug-build tasks. Final Node suite 113/113; fake-phone, compiled-phone and real Video.js MP4 Chromium E2Es all passed. Changed fixture constructors/root serving/synthetic schedule/restart-counter and current audio privacy contract are documented in D2/TIE-UP reports without production changes or relaxed thresholds. Source committed, merged and normally pushed; Pages deployment succeeded. See TIE-UP.md for delivery and remaining new static findings.
