# Documentation/manual endpoint tie-up — 2026-10-13

- status: complete — committed, merged, pushed and Pages deployed
- Authorization: user invoked tie-up again after the prior delivery attempt stopped on integrated Android failures. Commit, merge to main, normal push and existing Pages deployment remain authorized.
- Recovery source: `1db90a7c3bc4cf7faf07bf9718a40ba54c61d345`, clean branch `work`. Environment startup reset the checkout; the former local commits, unpushed documentation and raw logs were absent. They could not be recovered from Git objects. Six original workers restored the authorized 38-document review from their session evidence against current source. Old conversation-reported checks are historical; fresh logs below are required for this delivery.
- Preserved newer source: Bonjour trial retirement and media/concurrency cleanup from 91430639/1db90a7c.
- Recovered decisions: canonical `uJZk/TiPlay` and `https://ujzk.github.io/TiPlay/`; concise browser HEVC/AirPlay/VPN labels; enabled valid settings may resume idle connection preparation; disabled CarPlay blocks startup/retry. No old policy-conflict warnings remain in current guides.
- Recovered endpoint implementation: removed BrowserEndpointChanges, delayed announcement state, status property/JSON field and browser migrateEndpoint. Address sync/listener restart apply immediately. Browser users Disconnect → update Android address → Connect, or open the copied updated link; pairing code retained. Seven endpoint-hint locales now require manual update. Final cache v37 advances beyond the already deployed remote v36 while retaining airplay-canvas.js. RealPhone Java fixture constructor updated to the smaller status API.
- Cleanup: no previous owned background processes existed in the restarted environment. Recovered only session changes; no credentials/APKs are committed. No signed release or APK publication requested.

## Verification

- Fresh focused recheck of AndroidMediaSinkCodecDetachTest, MediaClockDiagnosticsTest, BrowserLinkServerTest and SmoothVideoHostLifecycleTest passed, BUILD SUCCESSFUL in 2m 53s. These include the former failures; no assertions/deadlines were weakened. See RECOVERY-FOCUSED-ANDROID.txt.
- Fresh Node 22 browser suite passed 113/113; see RECOVERY-BROWSER.txt.
- Integrated browser checks passed 116/116 (TIE-UP-BROWSER.txt); release-tool checks passed 9/9; seven language pages regenerated and Pages staging assembled. Public-tree, changed-document local targets, documentation size limits and whitespace checks passed. RealPhone.java compiled against rebuilt shared classes and Kotlin stdlib. Full Android checks passed: shared 1,352 + common 1,067 + home 4 = 2,423, with zero failures, errors or skipped tests. Required mobile/home/maphost lint and debug assembly passed; BUILD SUCCESSFUL in 10m 38s (TIE-UP-ANDROID.txt). Pages delivery succeeded as recorded below.

## Outstanding acceptance

Actual iPhone/car media, HFP/SCO acoustic/route behavior, AirPlay direct/proxied resources, manual endpoint connectivity, OEM background and Windows-specific behavior remain device/platform acceptance work. Historical delivery URLs/hashes/test counts retained. Deployment will be claimed only from a successful current Publish site workflow.

Fetched main advanced to ad94410c (upstream/doc consolidation, Canvas URL presentation and delivery record). Cancelled the superseded pre-integration full run before its completion. Preserve replacement docs/Upstream.md and consolidated APP-MAIN-PAGE-IMPLEMENTATION; old UPSTREAM_SYNC and DESIGN files must not be resurrected. Merge 08a1c079 incorporates recovered commit a2df771b into main ad94410c; integrated verification passed.

## Integration and delivery

- Verified source: `08a1c079`; recovered changes `a2df771b` merged into origin main `ad94410c`, retaining Canvas and consolidated documentation. Fresh fetch still reports `ad94410c`; no newer remote source to integrate.
- Original findings 1–3 are resolved by the user-confirmed behavior. Proactive endpoint notification, delayed handoff and browser migration are removed. No unresolved source/documentation policy finding blocks delivery. Device acceptance above remains separate.
- Cleanup: remove owned temporary Pages staging/Java compiler output and stop the owned Gradle daemon. The fully merged `work` branch is deleted before push; no extra worktree exists.

- Normal push delivered main `ce3a705002717864a080f4d39fe4cd611c500fa0`; no force push, tag or APK release. Working tree was clean and only main remained.
- [Publish site run 38435442241](https://github.com/uJZk/TiPlay/actions/runs/38435442241) completed successfully for that SHA, including generation, assembly, upload and deploy-pages. Existing Pages configuration reports `https://ujzk.github.io/TiPlay/`; deployed code uses cache v37. No live vehicle test is claimed.
- [Remote Android checks](https://github.com/uJZk/TiPlay/actions/runs/38435442309) started for the same SHA; its result is separate from the successful local required checks above and was still running at this handoff. This final record is a documentation-only follow-up; it does not change the validated/deployed code tree.
