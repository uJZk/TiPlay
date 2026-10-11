# Common module sweep result

Historical record of the initial 2026-10-10 cleanup and its coordinator verification. The open queue/lifecycle decisions and E2E failure below were superseded by the [2026-10-11 follow-up](FOLLOWUP-2026-10-11.md); later commit, push and deployment results are in the [tie-up record](TIE-UP-2026-10-11.md).

## Scope and review

Reviewed the 133 files assigned to `common` against standards 1–9. For inherited files, review and edits were limited to TiPlay hunks relative to `e837efa`; new files were fully eligible. The review covered browser settings/navigation, session hooks, local permissions, hotspot configuration and address cards, browser canvas/link lifecycle, phone locks, associated tests, Gradle asset bundling, manifest additions and localized resources.

## Changes

- `LocalHotspotSettings.kt`: keep the immutable hotspot-dump regex on the singleton instead of compiling it for every `fromDump` call. The pattern, match operation, credentials validation and redaction are unchanged.
- `CarPlaySettingsNavigation.kt`: filter directly into the ordered result set instead of first allocating a second set for subtraction. Selection rules and iteration order are unchanged.
- `DiPlayActivity.kt`: remove the unused fork-added `CarPlayRunMode` import; remove a stale Bluetooth-setting comment above unrelated audio controls; correct the fork comment describing the neutral car icon.
- `AdaptiveSettingsUiTest.kt`: remove two unused fork-added dialog imports.
- `PhoneBrowserModeSettingsTest.kt` and `HotspotExtraAddressSettingsTest.kt`: remove unused private helpers for locating the removed run-mode switch; remove the resulting unused `Switch` import in the hotspot test. Active assertions are retained.

## Performance findings

The regex and intermediate-set changes remove concrete repeated work/allocations; no measured latency or throughput improvement is claimed. Hotspot interface enumeration, root checks, Shizuku permission work and ADB autofill already run off the UI thread. Browser server binding/retries use a single worker, canceled scheduled retries are removed, stats formatting is rate limited, and view listeners are removed on detach. Wake/Wi-Fi locks retain their existing service stop/release paths.

## Verification

- Passed `git diff --check -- common`.
- Parsed all 63 in-scope XML files and checked for duplicate named elements within each file; none found.
- Checked fork-added imports and private helper references across common scope; removed the confirmed unused items above.
- Attempted `./gradlew :common:testDebugUnitTest --tests com.shilapi.xcertplay.LocalHotspotSettingsTest --tests com.shilapi.xcertplay.CarPlaySettingsNavigationTest --tests com.shilapi.xcertplay.AdaptiveSettingsUiTest`. Wrapper startup failed because `/home/agent/.gradle` is not writable.
- Retried using `GRADLE_USER_HOME=/tmp/tiplay-common-sweep-gradle`, also selecting `PhoneBrowserModeSettingsTest` and `HotspotExtraAddressSettingsTest`. Wrapper download failed with `java.net.SocketException: Operation not permitted`; no Android tests executed. Coordinator owns the full Android CI command and shared checks.

## Open decisions

- `HotspotExtraAddressCard.probe` and `TeslaBrowserLinkCard.probe` create a new thread for each trigger. Generation checks reject stale results but do not cap concurrent probes, and both visible cards may enumerate the same interfaces. Consider profiling bursts of state changes/renders, then deciding whether to coalesce or bound probes. Left unchanged because cancellation, callback timing and request freshness are observable behavior; no existing performance regression has been measured.

No feature additions, persisted-key changes, protocol changes, upstream identifier changes, commits or pushes.

## Coordinator verification follow-up

The earlier local infrastructure blockers above are historical. JDK/SDK setup is now fixed, and the full required Android test/lint/build command passed (2,177 tests, zero failures/errors/skips). Full browser unit suite passed 50/50; RealPhone.java compilation passed. Optional fake-phone E2E still fails the stats-event assertion, recorded separately in README.md. See README.md and ENVIRONMENT.md for final results and repeatable setup.
