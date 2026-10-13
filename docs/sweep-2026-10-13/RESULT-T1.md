# T1 — common tests

## Scope and changes

Reviewed the 43 common test/support files listed in SCOPE.md against STANDARDS.md, root AGENTS.md and docs/UPSTREAM_SYNC.md, focusing on test retirement and mechanical cleanup. No nested common AGENTS.md was found.

- `BrowserMainPageTest.kt`: removed two immediately repeated reconnect visibility assertions, an unused `RuntimeEnvironment` import and an unused `source` local left after connection-control ordering changed. The ordered-control assertions remain; `mainPageOffersOnlyPhoneHotspotAndExistingWifi` retains the explicit radio-choice coverage.
- Renamed `connectionFailureKeepsDisconnectAvailableWithoutAnApplyAction` to `connectionFailureKeepsReconnectAvailableWithoutAnApplyAction` to match its existing reconnect assertions. Its behavioral assertions remain.
- `BrowserMainHostTest.kt`: removed unused `TextView` import.

No runtime source changes, dependency changes or new tests within T1.

Following the explicit user request to retire the single-Bonjour experiment, deleted `UnifiedAirPlayTrialSettingsTest.kt`, whose only test was dedicated to the retired flag. Common production and shared protocol removals are owned by the other tasks.

## Retirement review

Removed one experiment-only test after the user explicitly authorized retirement of the complete single-Bonjour experiment. Completed implementation alone remains insufficient retirement evidence under STANDARDS.md rule 10.

- Removed `UnifiedAirPlayTrialSettingsTest.onlyExplicitOneEnablesTheTrial`: its default/invalid/explicit-enable assertions exclusively exercised the diagnostic flag now being retired. No replacement flag test is appropriate because the flag is no longer a supported contract. A full `common/src/test` reference scan found no other unified-trial helper or flag references. Existing `AirPlayReceiverSettingsTest`, `TeslaBrowserLinkTest` and `CarPlayBonjourDualStackTest` remain to cover receiver opt-out/service rejection, independent CarPlay/media lifecycle and normal Bonjour transport behavior.
- Retained all four `BrowserMainEntryTest` cases: they exercise live legacy-home redirection, restored state, About back navigation and launcher delivery to an existing activity. `BrowserMainPageTest.launcherGoesDirectlyToTheUnifiedHostPage` covers fresh launcher startup, not those lifecycle cases.
- Retained `TeslaBrowserPageLinksTest.theDefaultPhoneIsThePagesDefaultHost`: although it reads JavaScript source, it checks a current cross-language default-host contract needed when Android omits the endpoint. It is not a retired experiment.
- Retained shared session/phone-browser behavior and inherited native tests. No upstream test/file removal was attempted. The existing native acceptance scope is not broadened.

## Validation

- `git diff --check -- common/src/test`: passed.
- Read-only identifier occurrence scan confirms the two removed imports had no uses; reviewed the edited assertion blocks against the baseline-to-HEAD diff.
- Gradle was intentionally not started by this task, per coordinator instruction to avoid concurrent suites. Coordinator must run the required Android CI command before marking the sweep verified. Relevant changed suites: `com.shilapi.xcertplay.BrowserMainPageTest` and `com.shilapi.xcertplay.BrowserMainHostTest`, both included in `:common:testDebugUnitTest`.
- Post-retirement reference scan: no `UnifiedAirPlay`, `unified_airplay` or `Trial` references remain under `common/src/test`. General Bonjour tests and diagnostics are retained.
- No claim of performance improvement: changes are limited to tests.

## Open decisions

None introduced. The user explicitly authorized retiring the single-Bonjour experiment; launcher/UI entry behavior remains supported and covered.

## Coordinator final verification

Full required Android tasks passed after retirement: 1327 shared + 1093 common + 4 home = 2424 tests, zero failures/errors/skips; mobile/home/maphost lint and debug APK builds passed. Node suite 128/128 passed. Scope and final source review passed; see README.md, REVIEW.md and ANDROID-TEST-SUMMARY.json. No commit or push.
