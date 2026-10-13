# T3 — shared media cleanup and single-Bonjour trial retirement

## Final result

Under the user's explicit retirement authorization in `RETIREMENT-SCOPE.md` and STANDARDS rule 12, the optional single-Bonjour experiment has been removed. Ordinary AirPlay and CarPlay now always use their existing independent announcement, listener and identity paths. A previously saved `tiplay_unified_airplay_trial=1` is no longer read. The three allocation cleanups and bounded UDP-release test correction are retained. Source and tests are frozen for coordinator verification.

## Retirement changes

- Deleted four TiPlay-owned production files: `receiver/UnifiedAirPlayTrial.kt`, `network/UnifiedAirPlayEndpoint.kt`, `network/UnifiedAirPlayWirelessLease.kt`, and `receiver/ReceiverRequestConnection.kt`.
- Restored `CarPlayBonjour.kt` and `CarPlayVpnService.kt` byte-for-byte to their pre-trial baseline versions: normal CarPlay TXT/name, its own advertisement/listener, transport lifecycle and display reconnect path. CarPlay control discovery remains intact.
- Removed only trial hooks from inherited `AirPlaySession.kt`: ordinary-router interception, shared protocol-selection callback/state, shared-info overrides and conditional media teardown. The remaining baseline diff contains the unrelated clock diagnostics/mapping/timing and existing video diagnostics changes, all preserved.
- Removed `ReceiverServer.openConnection()`, trial stage reporting, trial-only identity/features overrides and the now-unused `enableReverse()` helper. Its ordinary socket reader, reverse-channel registration, dispatch, error handling and media ownership/cleanup remain.
- Removed the shared publisher's dynamic configuration/TXT providers from `ReceiverBonjour`; ordinary physical-interface discovery and cleanup remain. Removed unused identity/features override parameters from `ReceiverInfoProtocol` while retaining ordinary TXT, BLE-style query and plist behavior.
- Updated `ReceiverInfoProtocolTest` to verify the ordinary receiver's configured identity instead of the retired shared wireless alias. Feature-word and plist qualifier assertions remain.

## Removed tests and retained coverage

Deleted three TiPlay-owned experiment-only test classes, **12 tests total**, because their shared-entry contracts are explicitly retired:

- `UnifiedAirPlayTrialTest` (6): `disabledAndMissingBackendKeepRoutingSafe`, `registryRequiresMatchingKeysAndAcceptsTheWirelessDeviceAlias`, `oldServiceCannotRemoveReplacementBackend`, `legacyHandshakesSelectOneOrdinaryBackendAndCloseItOnce`, `carPlayHandshakeNeverSwitchesToLegacyAndDoesNotCreateOrdinaryState`, `sharedInfoPreservesCarPlayAudioAndDisplayContracts`.
- `UnifiedAirPlaySessionTest` (3): `ordinaryRequestsUseSharedIdentityWithoutCarPlayMediaOrActiveCallbacks`, `disabledTrialKeepsCarBluetoothInfoAndDoesNotRouteLegacyPairing`, `authSetupLocksCarPlayDialectAgainstLaterLegacyPairingOnTheSameSocket`.
- `UnifiedAirPlayEndpointTest` (3): `ordinarySocketsSurviveCarPlayAttachAndDetachOnTheSameEntry`, `disablingOrdinaryPreservesCarPlayAndReenableUsesTheReplacementBackend`, `inFlightCarPlayAcquisitionKeepsThePortWhenTheLastOrdinaryLeaseReleases`.

The former disabled-trial case's CarPlay Bluetooth `/info` contract remains covered by `CarBluetoothAudioSessionTest` and `AirPlayInfoPlistTest`; only its experiment fixture/routing assertions were removed. Ordinary receiver sockets, pairing, encrypted mirror packets, stream teardown, playback controls and resource requests remain covered by `ReceiverServerTest`, `ReceiverPairingTest`, `ReceiverInfoProtocolTest` and related receiver suites. CarPlay media isolation, buffered session ownership, transport/Bonjour, browser queues/display ownership and phone-browser behavior tests remain. No inherited tests or unrelated UI/launcher tests were removed.

## Allocation cleanup

- `ReceiverMirrorStream.kt`: reuse a reader-local 128-byte packet header and little-endian `ByteBuffer`. The header is fully read before use and never escapes; absolute `getInt(0)` preserves repeated packet parsing. Frame bodies remain independently owned.
- `ReceiverMirrorCodec.kt`: reuse a private four-byte Annex-B start code instead of allocating it per NAL. `ByteArrayOutputStream.write` copies these bytes and callers cannot mutate the constant.
- `BrowserAudioMediaSink.kt`: reuse one `MediaCodec.BufferInfo` per decoder worker across drains. Dequeue updates it before processing each valid output index. No other thread receives it and output buffer release stays in `finally`.

These remove identified scratch allocations without changing payload ownership, ordering, queue policy, locks or timeout values. No performance improvement was measured or claimed.

## Performance/lifecycle review and remaining decisions

Video hubs retain immutable frame arrays; frame count, bytes, age and configuration budgets are bounded. Key-frame work is coalesced. Browser video serialization already uses a writer-local reusable buffer. Audio decoder and subscription queues are bounded, and buffered music intentionally applies backpressure. RTP/PCM copies preserve queued/codec buffer ownership. Browser server socket admission bounds worker submissions; ordinary receiver slots, pending resource requests and photo storage have limits. Fixed touch slots preserve ordered ownership/release callbacks. No generated/native/vendor payloads were changed.

Two unrelated findings remain decisions, not fixes:

1. `ReceiverServer.finishPlayback()` holds `ownership` while `playbackEvent("stopped")` reaches the synchronous reverse-socket write/flush. A stalled peer can delay control/ownership work. Moving it requires explicit session-generation, ordering and cancellation/write-timeout policy.
2. `BrowserAudioMediaSink.Decoder.send()` holds its monitor while buffered publication may wait up to one second for capacity; `close()` needs that monitor. Moving publication requires retirement/generation guarantees against stale delivery or reordered resets. Existing backpressure and locking remain.

The previous question whether to retain the single-Bonjour experiment is resolved by the user's explicit retirement direction. Diagnostic stage logs, shared lease machinery and their tests were removed together; no rename or partial hidden mode remains.

## UDP release test correction

The coordinator's initial full shared run had one failure among 1,339 tests: `ReceiverServerTest.combinedAudioAndMirrorSetupHasRealUdpPortsAndAudioTeardownKeepsThePicture`, an immediate IPv6 wildcard rebind throwing `BindException` at line 194. Its XML recorded 27 ms duration. Type-96 teardown synchronously calls `ReceiverAudioDrain.close()`, which closes both sockets and explicitly does not join receive workers. Control responses do not establish that receive-thread/JDK descriptor release has completed. This was consistent with a brief shutdown scheduling window, not evidence of a persistent leak.

With coordinator authorization, `ReceiverServerTest` and `ReceiverAudioDrainTest` now share a test-only helper in `ReceiverAudioDrainTest.kt`. Each original IPv6 wildcard UDP port must actually bind, using a fresh closed-after-attempt socket, a one-second `System.nanoTime()` deadline and 5 ms retries for `BindException` only; deadline expiry rethrows the caught bind exception. Local-port equality, pre-teardown bound-port checks, subsequent video/control behavior and close-idempotence assertions remain. No production join, socket address reuse or alternate port was introduced.

## Verification

- Passed: `git diff --check -- shared` and report/task whitespace checks.
- Passed: all 19 changed/deleted shared paths belong to `SCOPE.md`; no scope expansion needed.
- Passed: `CarPlayBonjour.kt` and `CarPlayVpnService.kt` match baseline `477801f5e2fde2b48d064bcd06dc2df71f312514` byte-for-byte.
- Passed: active `shared/src` search finds no `UnifiedAirPlay*`, `tiplay_unified_airplay_trial`, `sharedWireless`, trial request interface, protocol-selection callback or shared identity/features override reference.
- Coordinator is rerunning the full required Android tasks after the retirement and UDP test correction. No competing Gradle invocation was started by T3. Hardware MediaCodec behavior and real-device multicast/performance were not measured.

## Coordinator final verification

Full required Android tasks passed after retirement: 1327 shared + 1093 common + 4 home = 2424 tests, zero failures/errors/skips; mobile/home/maphost lint and debug APK builds passed. Node suite 128/128 passed. Scope and final source review passed; see README.md, REVIEW.md and ANDROID-TEST-SUMMARY.json. No commit or push.
