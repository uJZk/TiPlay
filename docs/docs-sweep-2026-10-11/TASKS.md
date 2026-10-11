# Tasks

Sonnet/Opus are unavailable in the active agent model catalog. All tasks use inherited gpt-6.1-sol; technical checks require code/evidence review, mechanical checks require direct reference checks.

## entry

- Target: `AGENTS.md`, `CHANGELOG.md`, `CLAUDE.md`, `README.md`, `README.zh-CN.md`, `SECURITY.md`
- Model: gpt-6.1-sol (available substitute; technical accuracy and cross-document consistency)
- Status: completed
- Result: [RESULT-entry.md](RESULT-entry.md). Fixed current browser profile, address methods and car-button label; separated inherited/current Chinese UI guidance and corrected fresh-install FPS to 30 (60 selectable). Relative file links and scoped diff whitespace pass. Open issue: AGENTS uJZk/DiPlay link policy conflicts with TiPlay remote/deployment; preserved destinations. Coordinator handles execution checks.

## browser

- Target: `docs/BUILD.md`, `docs/INSTALL.md`, `docs/PRIVACY.md`, `docs/RELEASE-NOTES-NEXT.md`, `docs/TESLA_BROWSER.md`, `docs/TESTING.md`, `docs/todo.md`, `tests/web-e2e/README.md`, `tools/shell-address/README.md`
- Model: gpt-6.1-sol (available substitute; technical accuracy and cross-document consistency)
- Status: completed
- Result: [RESULT-browser.md](RESULT-browser.md); nine documents reconciled with browser profile, pairing/address behavior and E2E tooling; link-policy conflict and vehicle evidence limits flagged.

## connection

- Target: `docs/ANDROID9_WIFI_DIRECT.md`, `docs/CONNECTION_RELIABILITY.md`, `docs/CONNECTION_SETUP.md`, `docs/EXISTING_WIFI.md`, `docs/HOTSPOT_ADDRESS.md`, `docs/HOTSPOT_JOIN_VALIDATION.md`, `docs/LOCAL_HOTSPOT_TEST.md`, `docs/SMOOTH_WIRELESS.md`, `docs/WIRELESS_DIAGNOSTICS.md`, `docs/WIRELESS_HOTSPOT_JOIN.md`
- Model: gpt-6.1-sol (available substitute; technical accuracy and cross-document consistency)
- Status: completed (documentation checks; coordinator owns CI)
- Result: [RESULT-connection.md](RESULT-connection.md)

## vehicle

- Target: `docs/BUFFERED_AUDIO.md`, `docs/BYD_NAVIGATION.md`, `docs/COMPATIBILITY.md`, `docs/DILINK4_CLUSTER.md`, `docs/LAUNCHER_INTEGRATION.md`, `docs/SIDE_PANEL.md`, `docs/UPSTREAM_SYNC.md`, `docs/VIEW_AREAS.md`
- Model: gpt-6.1-sol (available substitute; technical accuracy and cross-document consistency)
- Status: completed
- Result: [RESULT-vehicle.md](RESULT-vehicle.md) — corrected browser-profile scope, retained settings paths/consent, map aspect and upstream references; flagged undated hardware evidence and deployment URL conflict.

## archive

- Target: `docs/E2E-VALIDATION-2026-10-10.md`, `docs/ISSUE-AUDIT-2026-10-03.md`, `docs/PR158-INTEGRATION-2026-10-03.md`, `docs/PR3_REVIEW.md`, `docs/RELEASE-NOTES-0.2.10.md`, `docs/RELEASE-NOTES-0.2.11.md`, `docs/RELEASE-NOTES-0.2.12.md`, `docs/RELEASE-NOTES-0.2.13.md`, `docs/RELEASE-NOTES-0.2.9.md`, `docs/SAFETY-REVIEW-2026-10-03.md`, `docs/SETTINGS-VALIDATION-2026-10-10.md`, `docs/VALIDATION.md`, `docs/sweep-2026-10-10/ANDROID-INITIAL-BLOCKER.txt`, `docs/sweep-2026-10-10/ANDROID-VALIDATION.txt`, `docs/sweep-2026-10-10/BROWSER-VALIDATION.txt`, `docs/sweep-2026-10-10/DIFFSTAT.txt`, `docs/sweep-2026-10-10/E2E-VALIDATION.txt`, `docs/sweep-2026-10-10/ENVIRONMENT.md`, `docs/sweep-2026-10-10/FOLLOWUP-2026-10-11.md`, `docs/sweep-2026-10-10/FOLLOWUP-ANDROID-INITIAL-FAILURE.txt`, `docs/sweep-2026-10-10/FOLLOWUP-ANDROID-VALIDATION.txt`, `docs/sweep-2026-10-10/FOLLOWUP-BROWSER-VALIDATION.txt`, `docs/sweep-2026-10-10/FOLLOWUP-COMMON-FOCUSED-VALIDATION.txt`, `docs/sweep-2026-10-10/FOLLOWUP-FAKE-E2E-VALIDATION.txt`, `docs/sweep-2026-10-10/FOLLOWUP-REAL-E2E-VALIDATION.txt`, `docs/sweep-2026-10-10/FOLLOWUP-TOOLING-VALIDATION.txt`, `docs/sweep-2026-10-10/FOLLOWUP-browser.md`, `docs/sweep-2026-10-10/FOLLOWUP-common.md`, `docs/sweep-2026-10-10/FOLLOWUP-network.md`, `docs/sweep-2026-10-10/FOLLOWUP-shared-other.md`, `docs/sweep-2026-10-10/FOLLOWUP-tooling.md`, `docs/sweep-2026-10-10/FOLLOWUP-web.md`, `docs/sweep-2026-10-10/HISTORY.txt`, `docs/sweep-2026-10-10/README.md`, `docs/sweep-2026-10-10/RESULT-browser.md`, `docs/sweep-2026-10-10/RESULT-common.md`, `docs/sweep-2026-10-10/RESULT-network.md`, `docs/sweep-2026-10-10/RESULT-shared-other.md`, `docs/sweep-2026-10-10/RESULT-tooling.md`, `docs/sweep-2026-10-10/RESULT-web.md`, `docs/sweep-2026-10-10/SCOPE.md`, `docs/sweep-2026-10-10/SDK-VALIDATION.txt`, `docs/sweep-2026-10-10/STANDARDS.md`, `docs/sweep-2026-10-10/TASKS.md`, `docs/sweep-2026-10-10/TIE-UP-2026-10-11.md`
- Model: gpt-6.1-sol (available substitute; reference checks and preservation of historical/legal evidence)
- Status: completed
- Result: historical snapshot boundaries and follow-up/delivery references corrected; 41 relative links valid, all 14 raw text logs unchanged. See [RESULT-archive.md](RESULT-archive.md) for preserved evidence and unverified remote/history limits.

## notices

- Target: `docs/THIRD_PARTY_NOTICES.md`, `docs/UPSTREAM-README.md`, `docs/UPSTREAM-README.zh-CN.md`, `docs/licenses/DiAuto-AGPL-3.0.txt`, `docs/licenses/dependencies/Apache-2.0.txt`, `docs/licenses/dependencies/Bouncy-Castle-LICENSE.txt`, `docs/licenses/dependencies/SLF4J-LICENSE.txt`, `docs/licenses/dependencies/Shizuku-API-LICENSE.txt`, `shared/BYD_HUD_ICONS_NOTICE.md`, `shared/src/main/assets/byd-hud-icons/LICENSE-BYDMate.txt`, `shared/src/main/assets/byd-hud-icons/NOTICE.txt`, `shared/src/main/jni/speexdsp/README.md`
- Model: gpt-6.1-sol (available substitute; reference checks and preservation of historical/legal evidence)
- Status: completed (preserved originals; reference limitations recorded)
- Result: [RESULT-notices.md](RESULT-notices.md)
