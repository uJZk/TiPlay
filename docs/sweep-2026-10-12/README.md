# Code sweep 2026-10-12

Status: complete — incremental cleanup and user-authorized repairs verified.

- Previous sweep: complete, docs/sweep-2026-10-10.
- Initial scope baseline: `0f90c0c00f01f9d201a4b49acfd7949a39b7a20b`.
- Initial HEAD and completed-sweep base-commit: `477801f5e2fde2b48d064bcd06dc2df71f312514`.
- base-commit: `477801f5e2fde2b48d064bcd06dc2df71f312514` (original sweep completion HEAD; later main imports and follow-up changes remain in the next sweep scope).
- Initial working tree: clean. At original sweep completion the source/test changes were uncommitted. The follow-up tie-up records later integration and delivery; include those changes and imported main commits in the next sweep.
- Scope and file/commit history: SCOPE.md, HISTORY.txt, DIFFSTAT.txt; user-authorized adjacent repairs: REPAIR-SCOPE.md.
- Standards: STANDARDS.md, AGENTS.md, docs/Upstream.md. Explicit repairs are distinguished from behavior-preserving cleanup.
- Resume/reference: TASKS.md and RESULT-*.md preserve disjoint ownership, reviewer/model choices, findings and checks. Both Android UI/UX reviews completed.
- Current product summary: ../WEB-DEBUG-2026-10-12.md. Verification tools/commands: ENVIRONMENT.md.

## Results

Browser theme changes use authenticated immediate reports, Boolean periodic reports and reconnect replay. Native delivery preserves main-thread ordering and reaches retained sessions while the activity is detached. Android spacing, address restoration, consistent lookup text, VPN authorization, hotspot-read feedback and truthful idle readiness were repaired. Debug contains four fields; sorting/copying is reused and the repeated theme command log was removed. Upstream identifiers, sources, compatibility APIs and persisted keys were retained; no new dependencies or broad upstream refactors.

## Final verification

- Full AGENTS.md Android task set: BUILD SUCCESSFUL in 8m 40s, 247 tasks, 14 executed / 233 up-to-date. Common ran in two independent test JVMs via a temporary init script; no tests were filtered out or skipped. Shared/home unchanged tests were up-to-date from passing runs. All three lint tasks and mobile/home/maphost debug APK builds passed.
- XML results: shared 1227, common 1027, home 4; total 2258, zero failures/errors/skips. ANDROID-TEST-SUMMARY.json records relevant regression suites.
- Node 22.23.3 final browser suite: 64/64 passed.
- Final fake-phone Chromium E2E passed, including four-field Debug, synthesized synchronized latency on all decode paths and actual Boolean theme reports during reconnect and periodic stats.
- Compiled app-server E2E passed twice consecutively (exit 0), including portal/fit actions, next-session first frame, retired-sink isolation, touch, stats, CORS and session recovery. This harness is not a physical phone test.
- Public-tree scan, 14 affected locale XML files and whitespace checks passed. All 15 browser assets in the mobile debug APK match site/play; removed playback fallbacks remain absent. Locale generation with the existing SITE_BASE_URL leaves generated HTML unchanged.
- Source diff spot-check confirms small upstream hooks, disjoint ownership, explicit repair scope and preserved diagnostics/resource/thread/session contracts. No end-to-end performance gain was measured; redundant per-snapshot sorts/copies dropped from four to two.

## Initial failures and corrections

Default sandbox blocked child processes/local listeners with EPERM; permitted executions ran the local verification tools. Initial new-shadow compilation failed because a public shadow exposed internal hotspot credentials; its class is now internal with JVM-visible methods. The full rerun then found one stale consent assertion: Robolectric records startActivityForResult in both result and general launch queues. The test now consumes both initial records and retains the no-auto-dialog-on-return assertion; production was unchanged. The final full task set passed.

The app-server harness had an old Java status constructor missing portalRevision and a stale assumption that #fit is visible during playback. It now uses the real BrowserPortalSignal and portal navigation without reducing mismatch/callback assertions. One subsequent next-session wait timed out without enough evidence to establish a production defect. Failure-only diagnostics were added; two consecutive full reruns passed. A contribution from concurrent Android test load is possible but unproven; no speculative runtime change was made.

## Remaining limits / open decisions

WebCodecs exposes a hardware acceleration preference rather than actual hardware/software decoder selection; after the user's follow-up, the banner omits hardware/software information and shows only the codec in its first field. A definite missing/zero timingPort synchronization path is fixed and UDP-tested, but the affected iPhone SETUP trace is unavailable. Latency remains synchronized iPhone frame time to canvas submission, not verified capture-to-physical-screen latency. Stale/future/invalid clock samples remain unavailable. VPN consent, OS-specific hotspot access and actual iPhone/vehicle rendering need device verification; restricted systems still require manual hotspot credentials. No policy-sensitive mDNS timeout or other unrelated feature was changed. No commit, push, signing, release or deployment was requested at the original sweep completion. The subsequent user-invoked tie-up authorizes commit, merge, normal push and the existing Pages deployment; see TIE-UP.md.

## User follow-up

See [FOLLOWUP-REMOVE-BUNDLED-PAGE.md](FOLLOWUP-REMOVE-BUNDLED-PAGE.md) for the requested codec-only Debug label and removal of the bundled browser page. The original validation logs above describe the state before that follow-up.

The tie-up integrated main through `5449de24`. Its incoming files were not a delegated sweep, so the base-commit remains at the initial completion HEAD; the next sweep must include those imports and follow-up changes.
