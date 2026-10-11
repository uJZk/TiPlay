# Documentation sweep — 2026-10-11

- status: complete
- base-commit: `269852ef86f842612c7854d373affc4d3c665e37`
- Scope: first docs sweep; 90 tracked documentation files across six independent tasks. Generated output and this sweep’s records excluded from source scope.
- Initial working tree: clean. The original sweep patch is recorded in CHANGES.diff and DIFFSTAT.txt. The subsequent tie-up is authorized to commit and push; see [TIE-UP.md](TIE-UP.md). The final sweep baseline will be advanced to the documentation-fix commit during tie-up.
- Standard: project AGENTS.md and upstream-sync requirements; see [CHECKLIST.md](CHECKLIST.md).
- Tasks and per-document results: [TASKS.md](TASKS.md). Full scope/history: [SCOPE.md](SCOPE.md), HISTORY.txt.
- No application/configuration changes. The sweep itself made no commit or push; the user subsequently authorized tie-up delivery.

## Changes

Corrected current phone/browser profile versus retained head-unit guidance; settings names, reachable paths and reconnect consent; fresh-install 30 fps versus selectable 60 fps; hotspot address methods and validation limits; pairing credentials sent to the phone; wireless fallback Bluetooth ownership; and stale historical checkpoint claims. Fixed the standalone-test-build heading reference and marked implemented browser mode in the plan.

## Verification

- Required AGENTS.md Android command passed: `BUILD SUCCESSFUL in 14s`, 247 tasks (10 executed, 237 up-to-date). Existing passing unit reports: shared 1,205, common 992, Home 4; total 2,201, zero failures/errors/skips. Unit tasks reused up-to-date results because application/build inputs did not change. See [ANDROID-VALIDATION.txt](ANDROID-VALIDATION.txt) and ANDROID-TEST-SUMMARY.json.
- Browser suite passed 60/60; see [BROWSER-VALIDATION.txt](BROWSER-VALIDATION.txt). Initial restricted-sandbox run failed the site subprocess case; rerun with required subprocess/network capability passed. No source modification needed.
- Relative Markdown/HTML file and Markdown-heading links checked; the one active broken heading reference was fixed. Only six inherited links in preserved upstream README copies remain missing; see LINK-CHECK.json and [RESULT-notices.md](RESULT-notices.md).
- Scope, raw evidence, legal/vendor/upstream originals and diff whitespace checks passed. Public-tree check passed.
- Coordinator spot-checked profile, frame-rate load/config path, menu entry labels, pairing privacy, wireless fallback, view-area reconnect behavior, upstream merge profile and historical snapshot boundaries against source/evidence.

## Open findings

- AGENTS.md prescribes `uJZk/DiPlay` project destinations, while current repository and dated Pages deployment use `TiPlay`; code/static-site defaults still use `/DiPlay/`. Existing destinations and explicit policy were preserved; resolve the canonical-link policy before migrating them.
- Upstream README copies retain six broken relative links and inherited instructions. Original legal/vendor copies were not rewritten; the copied BYDMate notice’s nonadjacent license path is documented.
- Historical device reports, external/platform provenance and public release/live-host availability were not independently revalidated. The prior remote Android run’s later outcome remains unverified. This sweep ran local build/checks, not new vehicle/E2E/deployment acceptance.

All remaining qualifications are detailed in the task result files; no new behavioral guarantees were added.
