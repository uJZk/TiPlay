# Shared-other sweep result

Historical record of the initial 2026-10-10 cleanup and its coordinator verification. The open queue/lifecycle decisions and E2E failure below were superseded by the [2026-10-11 follow-up](FOLLOWUP-2026-10-11.md); later commit, push and deployment results are in the [tie-up record](TIE-UP-2026-10-11.md).

## Scope and outcome

Reviewed all 21 files assigned to `shared-other` in `SCOPE.md`, using `git diff e837efa HEAD` to restrict inherited files to TiPlay hunks. Read `STANDARDS.md`, `AGENTS.md`, and `docs/UPSTREAM_SYNC.md`. No source changes were justified by the behavior-preserving cleanup standard. Original upstream implementation remains untouched.

Coverage: the shared manifest; AirPlayAudioDiagnostics, AirPlayConfig, AirPlayInfoPlist, AirPlaySession and ScreenStream; BydNavigationOutputs, BydStandaloneHudOutput and BydStarterBridge; AndroidMediaSink and VideoTeeMediaSink; CarPlayController and CarPlayRuntimeConfig; and all eight assigned test files.

## Performance and ownership review

- VideoTeeMediaSink passes the same immutable-by-contract frame array to primary and tap, in that order. Its private inline callback helper adds no retained per-frame closure or extra frame copy. Audio and microphone calls delegate only to the primary. It owns no queues, threads or native resources requiring independent release.
- ScreenStream's fork hook retains only the most recent configuration body, suppresses consecutive duplicate diagnostic messages, and preserves codec/config callback order. Configuration parsing and record copying happen on configuration messages, not each video frame. The existing upstream marker scan and frame conversion are excluded from cleanup. Reusing the config record would require verifying downstream ownership; no cache was introduced.
- AirPlay audio route gates run at declaration/setup boundaries. The diagnostic formatter emits whitelisted labels and format metadata, without stream contents. It does not add work to audio packet delivery.
- The controller and HUD gates preserve recovery of existing journals while preventing head-unit integrations from starting in phone/browser mode. Their fork hunks introduce no new threads, blocking I/O, or collections. AndroidMediaSink changes only expose existing geometry properties; decoder/audio resource implementation is upstream and excluded.
- Manifest additions and runtime config fields required no structural cleanup. Existing assigned tests preserve ordering, reference identity, diagnostic redaction, audio suppression and head-unit gate assertions.

## Open decisions

`AirPlaySession.audioSetups` retains one label per audio SETUP for the session lifetime in a `CopyOnWriteArrayList` (declaration at line 84; writes at lines 703 and 712). Repeated SETUP requests grow the collection without a bound and copy its backing array on every append, although ordinary sessions have few setup events. The close diagnostic needs only a total count and distinct labels in first-seen order. A synchronized count plus ordered distinct labels could bound storage for the fixed stream types and whitelist, but would change locking and concurrent-close snapshot semantics. Leave this for a separately tested decision under standard 3; no retention limit or accounting behavior was changed. No measured performance improvement is claimed.

## Validation

Attempted `./gradlew :shared:testDebugUnitTest` with filters for AirPlayAudioDiagnosticsTest, AirPlayInfoPlistTest, CarBluetoothAudioSessionTest, ScreenCodecTest, BydOptionalOutputSettingsTest, DiLink3ClusterRecoveryTest, VideoTeeMediaSinkTest and CarPlayControllerHeadUnitIntegrationsTest. The wrapper failed before any tests ran: it could not create the lock file beneath `/home/agent/.gradle/wrapper/dists/gradle-9.5.0-bin/`. Coordinator owns the required full Android CI/lint run and consolidated infrastructure result. No source changes or new tests require additional local validation.

## Coordinator verification follow-up

The earlier local infrastructure blockers above are historical. JDK/SDK setup is now fixed, and the full required Android test/lint/build command passed (2,177 tests, zero failures/errors/skips). Full browser unit suite passed 50/50; RealPhone.java compilation passed. Optional fake-phone E2E still fails the stats-event assertion, recorded separately in README.md. See README.md and ENVIRONMENT.md for final results and repeatable setup.
