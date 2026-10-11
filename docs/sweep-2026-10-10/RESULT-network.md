# Network sweep result

Historical record of the initial 2026-10-10 cleanup and its coordinator verification. The open queue/lifecycle decisions and E2E failure below were superseded by the [2026-10-11 follow-up](FOLLOWUP-2026-10-11.md); later commit, push and deployment results are in the [tie-up record](TIE-UP-2026-10-11.md).

Reviewed all 21 network files in SCOPE.md under STANDARDS.md rules 1–9. Inherited files were reviewed only at the TiPlay hunks against `e837efa`; original upstream code was not cleaned up. No production or test changes were justified without changing behavior. Only this result record was added.

## Coverage and performance review

- `HotspotAddressBackend.kt`, `ShizukuHotspotAddress.kt`, `RootShell.kt`: reviewed backend fallbacks, script validation, exception classification, blocking calls, listener/parcel ownership, bounded output, timeout and reader handling. Backend calls remain on the keeper worker; the main-thread root guard remains. Exception traversal is bounded to eight causes and root output to 16,384 characters. Reflection occurs only when adding a missing address or reading settings; caching it would be disproportionate here and could change failure/retry behavior.
- `HotspotExtraAddressKeeper.kt`: reviewed session replacement, worker serialization, lock boundaries, broadcast lifecycle, polling, backoff, cancellation, shutdown cleanup and root refusal persistence. One finder is retained per session and closed on session end; cancelled scheduled polls are removed. No media per-frame work occurs here. The two follow-up decisions below are outside behavior-preserving cleanup.
- `HotspotAddressVpn.kt`, `HotspotAddressVpnService.kt`: reviewed consent/conflict order, stop/revoke behavior, repeated start guards and descriptor replacement/closure. The new tunnel replaces the old one before the old descriptor closes. Changing service dispatch or binder thread affinity is outside this sweep.
- `HotspotAddresses.kt`, `HotspotExtraAddress.kt`, `HotspotConfigurationAccess.kt`: reviewed parsing, address filters/order, alias validation and scoped resource use. Enumeration and short address-list transforms run at setup or polling frequency; no speculative allocation rewrite was applied.
- Inherited `LocalOnlyHotspotManager.kt`, `ManualHotspotManager.kt`, `WifiP2pGroupManager.kt`: reviewed only product-name replacements and the manual-hotspot address-filter hook. Kept the inherited implementations intact.
- Tests: reviewed the added `HotspotAddressBackendTest`, `HotspotAddressVpnTest`, `HotspotExtraAddressKeeperTest`, `HotspotExtraAddressLoopTest`, `HotspotExtraAddressTest`, `NetworkManagementCallTest`, `RootShellTest`, and only fork hunks of `CarPlayBonjourTest` / `WirelessHostAddressTest`. Existing assertions exercise protocol values, address ordering, backend classification, root denial, backoff, consent, tunnel closure and session teardown; retained them.

## Checks

- `git diff --check -- shared/src/main/java/com/shilapi/xcertplay/network shared/src/test/java/com/shilapi/xcertplay/network` passed.
- Attempted `./gradlew :shared:testDebugUnitTest --tests 'com.shilapi.xcertplay.network.*' --offline`: wrapper could not create its lock under `/home/agent/.gradle` in the filesystem sandbox.
- Retried with writable `GRADLE_USER_HOME=/tmp/tiplay-sweep-gradle`: Gradle 9.5.0 was not cached; the wrapper attempted its download before Gradle could process `--offline` and failed with `java.net.SocketException: Operation not permitted`. No Kotlin tests or Android lint executed in this worker. Coordinator owns the full CI attempt and infrastructure follow-up.
- No performance measurements or performance gains are claimed.

## Open decisions

1. **Refresh queue policy:** `HotspotExtraAddressKeeper.Session.refresh` (line 208) posts one task for every event through `worker.execute` (line 248). `ScheduledThreadPoolExecutor` has an unbounded queue. An event burst while a root/backend operation blocks can accumulate refresh work; cancellation only removes the pending scheduled poll. Coalescing events or bounding the queue would change event ordering and how explicit retry requests are preserved, so leave this for a separate behavioral decision and stress test. No event-burst impact was measured.
2. **Timed-out shell reader lifecycle:** `RootShell.execute` lines 76–79 forcibly destroys the direct process and interrupts the reader, then returns immediately without the normal-path join/stream close. A descendant retaining stdout can keep a blocking stream read alive despite interruption. The existing hanging-shell test checks prompt timeout return, not reader termination. Define descendant/stream ownership and a bounded cleanup policy before changing this path; an unconditional close or join can itself delay the timeout return. This is a code-inspection concern, not a reproduced Android leak.

## Coordinator verification follow-up

The earlier local infrastructure blockers above are historical. JDK/SDK setup is now fixed, and the full required Android test/lint/build command passed (2,177 tests, zero failures/errors/skips). Full browser unit suite passed 50/50; RealPhone.java compilation passed. Optional fake-phone E2E still fails the stats-event assertion, recorded separately in README.md. See README.md and ENVIRONMENT.md for final results and repeatable setup.
