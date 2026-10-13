# Final source review

All 31 changed/deleted tracked files are in SCOPE.md or authorized RETIREMENT-SCOPE.md.

## Removed experiment files

- `common/src/main/java/com/shilapi/xcertplay/UnifiedAirPlayTrialSettings.kt`.
- `common/src/test/java/com/shilapi/xcertplay/UnifiedAirPlayTrialSettingsTest.kt` — 1 dedicated test method.
- `shared/src/main/java/com/shilapi/xcertplay/network/UnifiedAirPlayEndpoint.kt`.
- `shared/src/main/java/com/shilapi/xcertplay/network/UnifiedAirPlayWirelessLease.kt`.
- `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverRequestConnection.kt`.
- `shared/src/main/java/com/shilapi/xcertplay/receiver/UnifiedAirPlayTrial.kt`.
- `shared/src/test/java/com/shilapi/xcertplay/airplay/UnifiedAirPlaySessionTest.kt` — 3 dedicated test methods.
- `shared/src/test/java/com/shilapi/xcertplay/network/UnifiedAirPlayEndpointTest.kt` — 3 dedicated test methods.
- `shared/src/test/java/com/shilapi/xcertplay/receiver/UnifiedAirPlayTrialTest.kt` — 6 dedicated test methods.

## Compatibility checks

- CarPlayBonjour.kt and CarPlayVpnService.kt exactly match the pre-trial baseline; verified by git diff against 477801f5e2fde2b48d064bcd06dc2df71f312514.
- Ordinary AirPlay service keeps its prior default separate receiver identity, listener and periodic standalone discovery.
- ReceiverInfoProtocol keeps normal configured identity/capability responses; only trial override parameters were removed.
- Launcher/UI entry tests remain; single Bonjour broadcast was the retirement target.
- Allocation reuse is confined to one reader/decoder/GL owner; frame bodies still independently owned.
- UDP tests require actual original-port bind within one second, retain media/control assertions and do not enable address reuse.
- Active source/test/build search contains no UnifiedAirPlay/flag/router references. Historical sweep/audit records are retained.
- Upstream files/identifiers remain; only TiPlay-added experimental hooks were removed.
- Full final Android validation passed (2424 tests, zero failures/errors/skips; all required lint/debug builds). Node 128 tests, native boundary and 9 release tests passed.

## Integrated post-merge/final review

Latest incoming code history is INTEGRATION-SCOPE.md; explicit risk repairs and retired remnants are REPAIR-SCOPE.md/RETIRED-SCOPE.md. Current diff covers 55 tracked files plus sweep records/AGENTS handoff. Initial 31-file review above remains historical. All source changes reviewed for owner/lock/queue protocol and imported Bluetooth/Video.js behavior. Final Android 2423 tests and all required lint/build tasks passed; Node 113 and all three final Chromium E2Es passed. Browser/E2E/current docs contain no executable retired single-Bonjour/VideoTee/layout/time-label references. Source mode/timing caps and vendor contents preserved.
