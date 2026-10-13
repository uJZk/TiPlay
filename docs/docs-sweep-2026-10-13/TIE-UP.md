# Documentation/manual endpoint tie-up — 2026-10-13

- status: verification in progress
- Authorization: user invoked tie-up again after the prior delivery attempt stopped on integrated Android failures. Commit, merge to main, normal push and existing Pages deployment remain authorized.
- Recovery source: `1db90a7c3bc4cf7faf07bf9718a40ba54c61d345`, clean branch `work`. Environment startup reset the checkout; the former local commits, unpushed documentation and raw logs were absent. They could not be recovered from Git objects. Six original workers restored the authorized 38-document review from their session evidence against current source. Old conversation-reported checks are historical; fresh logs below are required for this delivery.
- Preserved newer source: Bonjour trial retirement and media/concurrency cleanup from 91430639/1db90a7c.
- Recovered decisions: canonical `uJZk/TiPlay` and `https://ujzk.github.io/TiPlay/`; concise browser HEVC/AirPlay/VPN labels; enabled valid settings may resume idle connection preparation; disabled CarPlay blocks startup/retry. No old policy-conflict warnings remain in current guides.
- Recovered endpoint implementation: removed BrowserEndpointChanges, delayed announcement state, status property/JSON field and browser migrateEndpoint. Address sync/listener restart apply immediately. Browser users Disconnect → update Android address → Connect, or open the copied updated link; pairing code retained. Seven endpoint-hint locales now require manual update. Cache bumped from source v35 to v36. RealPhone Java fixture constructor updated to the smaller status API.
- Cleanup: no previous owned background processes existed in the restarted environment. Recovered only session changes; no credentials/APKs are committed. No signed release or APK publication requested.

## Verification

- Fresh focused recheck of AndroidMediaSinkCodecDetachTest, MediaClockDiagnosticsTest, BrowserLinkServerTest and SmoothVideoHostLifecycleTest passed, BUILD SUCCESSFUL in 2m 53s. These include the former failures; no assertions/deadlines were weakened. See RECOVERY-FOCUSED-ANDROID.txt.
- Fresh Node 22 browser suite passed 113/113; see RECOVERY-BROWSER.txt.
- Full required Android command, final local references/public-tree/whitespace, current main integration and Pages verification are pending below.

## Outstanding acceptance

Actual iPhone/car media, HFP/SCO acoustic/route behavior, AirPlay direct/proxied resources, manual endpoint connectivity, OEM background and Windows-specific behavior remain device/platform acceptance work. Historical delivery URLs/hashes/test counts retained. Deployment will be claimed only from a successful current Publish site workflow.

Fetched main advanced to ad94410c (upstream/doc consolidation, Canvas URL presentation and delivery record). Cancelled the superseded pre-integration full run before its completion. Preserve replacement docs/Upstream.md and consolidated APP-MAIN-PAGE-IMPLEMENTATION; old UPSTREAM_SYNC and DESIGN files must not be resurrected. Final integrated verification required.
