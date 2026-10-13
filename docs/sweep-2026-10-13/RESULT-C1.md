# C1 — post-merge common cleanup

## Scope and evidence

Applied STANDARDS.md rule 14 to incoming common files in INTEGRATION-SCOPE.md, with the initial cleanup and single-Bonjour retirement retained. Reviewed incoming media, microphone/foreground-service, endpoint/settings and associated regression changes. Scope contains 18 live Kotlin files after excluding R1-owned TeslaBrowserLink.kt/TeslaBrowserLinkTest.kt, plus 26 resource XML files. Removed files are integration history only and were not restored. No R1 file or fixture was edited.

## Changes

- `AirPlayCastPlayer.kt`: replaced private nullable `EncodedVideo.configRecord` state with a non-null local in the sole output-format branch. Reference search found no other reader or writer; `ReceiverAvc.record` returns non-null `ByteArray`. Codec notification order, synchronization, buffer ownership and teardown remain unchanged. The retained field was unnecessary after incoming browser URL-video playback replaced Android decoding.
- `AirPlayReceiverService.kt`: removed obsolete Media3 `@OptIn(UnstableApi::class)` and its imports. The service and its new cast-player API no longer use Media3 APIs.

No feature change, public-interface change, timeout change or new dependency. No performance measurement or speed claim.

## Review findings and retained coverage

- Incoming `AirPlayCastPlayer` delegates URL media to browser playback; still photos retain the encoder, GL owner thread and bounded teardown. The existing viewport cache remains. Per-frame encoded buffers are handed to downstream sinks, so no shared buffer reuse was introduced.
- Bluetooth microphone permission checks, phone-browser buffered-audio defaults, foreground-service microphone gating and explicit audio opt-out are retained. Existing `CarPlayHostBrowserLinkTest`, `DiPlaySessionServiceTest`, `BrowserMainHostTest` and `BrowserAdvancedPageTest` regressions remain intact.
- Endpoint compact display and repair-mode settings retain their callbacks, probe lifecycle and permission behavior. Existing `BrowserEndpointSettingsTest` and settings regressions remain.
- Incoming deletions of Media3 cast audio/data-source/frame-clock helpers and dedicated tests remain deleted. No additional whole tests were removed: no surviving in-scope test was proven to cover a retired experiment exclusively. Single-Bonjour retirement and launcher/UI-entry regressions remain intact.
- No edit to inherited `CarPlayHostActivity` beyond incoming/session changes: a whole-file unused-import scan found `TextUtils`, but its import was outside incoming hunks, so it was left alone.

## Checks

- `git diff --check -- common/src/main`: passed.
- Parsed all 26 incoming common resource XML files; no duplicate resource names within each file. No resource changes were needed.
- Read-only Kotlin import/reference scan and source review confirmed the local-only config-record use and obsolete Media3 marker.
- No Gradle task started, as requested. Coordinator owns the complete Android test/lint/build verification; `:common:testDebugUnitTest` includes the retained receiver, browser settings, host and foreground-service regressions. Device codec/GL and car Bluetooth validation remain separate from JVM evidence.

## Open decisions

Incoming `AirPlayCastPlayer.browserVideo` is written on Android main but read via `player.state` from `AirPlayReceiverService.Listener.playback()` on receiver threads. The `AirPlayVideoPlayback.playback` value is volatile, but its enclosing `browserVideo` reference is not; the old player exposed a volatile state snapshot. This is a potential cross-thread visibility gap requiring a separate behavioral repair/review, not a mechanical cleanup. It was reported to the coordinator and left unchanged under rule 14.

## Final integrated coordinator checks

The final source commit 91430639 passed the complete Android task set: 1352 shared + 1067 common + 4 home = 2423 tests, zero failures/errors/skips, and all three lint/debug-build tasks. Final Node suite 113/113; fake-phone, compiled-phone and real Video.js MP4 Chromium E2Es all passed. Changed fixture constructors/root serving/synthetic schedule/restart-counter and current audio privacy contract are documented in D2/TIE-UP reports without production changes or relaxed thresholds. Source committed, merged and normally pushed; Pages deployment succeeded. See TIE-UP.md for delivery and remaining new static findings.
