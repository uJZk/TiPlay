# Documentation sweep — 2026-10-12

- status: complete
- base-commit: `5449de24d399f9e4e1ce1124e7066d906df98813`
- Previous sweep baseline: `92cc2efca3a27c87f064f3ea63303dc266226b89`
- Reviewed HEAD: `5449de24d399f9e4e1ce1124e7066d906df98813`
- Scope: 35 documents across six independent tasks, selected using commit history since the completed 2026-10-11 sweep and mappings from changed code. 34 source documents changed; AGENTS.md reviewed unchanged.
- Initial working tree: clean. The docs sweep changed no application/configuration and made no commits, pushes or deployment. The original final base-commit is the reviewed HEAD; the user subsequently authorized delivery via tie-up. See [TIE-UP.md](TIE-UP.md) for integration and commit/push progress.
- Standard and user requirement: [CHECKLIST.md](CHECKLIST.md). The user explicitly requested README.md contain only user-needed content; English and Chinese entry guides were aligned.
- Scope/history: [SCOPE.md](SCOPE.md), HISTORY.txt and DIFFSTAT.txt. Tasks/results: [TASKS.md](TASKS.md). Validation: [VERIFICATION.md](VERIFICATION.md).
- Model: skill-requested Sonnet/Opus are unavailable; six independent agents used the inherited available GPT-6 model, recorded with task reasons.

## Changes

Root READMEs now cover purpose, status/requirements, installation/connection, use/settings, limitations/help and essential credits. Developer implementation, internal IDs, private delivery records, release packaging and native feature catalogs were removed from the entry guides. Android and browser Connect actions are distinguished.

Reconciled current two-menu native settings, 60 fps fresh-install default with saved choices preserved, Advanced explicit apply/reconnect, boot connection preference, configurable browser endpoint, pending hotspot fallback, None/无 method label, per-method address/port limits and Existing Wi-Fi security choices. Clarified active browser resume and disabled fields, WebCodecs-only playback, browser-only video routing, Debug statistics and privacy boundaries.

Dated implementation/delivery records identify superseded behavior while preserving original hashes, measurements, test counts and workflow references. Retained native head-unit guidance is marked as historical upstream compatibility, with no new native acceptance requirements. Build/test guides now show required CI commands and current manual checks; broken local heading links repaired.

## Integration during tie-up

Fetched main advanced to `cbe7cff6` after the original review. The integration preserves its hosted-only page, four-field Debug and lifecycle changes while retaining this sweep’s documentation improvements; see [INTEGRATION.md](INTEGRATION.md). Original results below describe the original reviewed HEAD; final integration checks and delivery are in [TIE-UP.md](TIE-UP.md).

## Verification

All six reviews are complete. Scoped local file/heading links, whitespace, editing boundaries and public-tree checks pass. Browser Node tests pass 63/63. Full required Android checks passed (BUILD SUCCESSFUL in 5m 57s): 2264 unit tests, zero failures/errors/skips, required Lint and three debug assemblies. See [VERIFICATION.md](VERIFICATION.md), ANDROID-VALIDATION.txt, ANDROID-TEST-SUMMARY.json and BROWSER-VALIDATION.txt.

Coordinator spot-checks covered English/Chinese user setup, current labels/defaults, Advanced consent, phone boot intent, endpoint editing and migration caveats, single browser-session behavior, WebCodecs/Debug and historical/current claim boundaries. No physical device, browser E2E, remote release/hosting or deployment acceptance was performed.

## Open findings

- Explicit AGENTS.md policy points project issues/releases/downloads/site to `uJZk/DiPlay`; current repository/runtime Pages defaults and dated deployment records use TiPlay. Current instructions follow the explicit policy, preserve historical destinations and flag the conflict; no canonical destination was inferred.
- Current reachable HEVC title is `HEVC (H.265)` and VPN chooser is `VPN`, while experimental implementations and AGENTS.md call for the locale-specific experimental suffix. This documentation sweep records the source/UI policy mismatch without changing application strings.
- Historical device reports, private artifact availability and remote Release/Pages outcomes were not independently revalidated. Complete vehicle CarPlay/audio, WPA3/Open network hardware, hotspot address reachability and resize recovery still require the documented device validation. Source and unit checks do not establish those outcomes.

Per-task results preserve additional qualifications. No new behavioral guarantees were added.
