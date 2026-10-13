# Authorized single-Bonjour trial retirement

User clarification: “单入口指的是单Bonjour广播服务入口”. Final direction: “单 Bonjour 试验 清理代码”. This authorizes retirement of the optional single-Bonjour experiment, not removal of launcher/UI entry regression coverage.

## Intended result

Remove the default-off `tiplay_unified_airplay_trial` experiment flag, shared listener/advertisement leases, unified identity/TXT/dialect routing hooks and experiment-only tests. Keep the existing default standalone ordinary AirPlay receiver and CarPlay discovery/listener/identity paths. Previously opted-in devices return to these independent paths; no old setting needs to be read or reset. Preserve default media/session/retained-display/transport behavior. Do not change pairing formats, queue policies or unrelated lifecycle locks.

## Disjoint ownership

- T1: common/src/test trial-specific tests/support only, within SCOPE.md. Preserve BrowserMainEntryTest and UI single-launcher behavior.
- T2: common/src/main AirPlayReceiverService.kt and UnifiedAirPlayTrialSettings.kt within SCOPE.md.
- T3: shared production experiment classes/hooks and experiment-only shared tests within SCOPE.md. Keep upstream files/identifiers; remove only trial hook hunks. Also fix existing in-scope UDP release assertions with bounded real-bind retries, without weakening media or release assertions.
- Coordinator: docs/AIRPLAY.md current trial operating instructions and sweep records. AIRPLAY.md changed in this incremental history; it is explicitly added for consistency of the authorized retirement. Historical validation/change records remain historical.

## Validation

Search all active source/test/build references for UnifiedAirPlayTrial, UnifiedAirPlayEndpoint, UnifiedAirPlayWirelessLease and tiplay_unified_airplay_trial. Run full AGENTS Android CI tasks, all browser tests, native boundary and public-tree checks. Retain real standalone socket/receiver/session media regressions. Record removed tests/classes and default behavior evidence. No commit/push/deploy.
