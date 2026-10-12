# Tooling documentation review — 2026-10-12

Reviewed baseline `92cc2efca3a27c87f064f3ea63303dc266226b89` through
`5449de24d399f9e4e1ce1124e7066d906df98813`, with source checks against the shared working tree.
Model: inherited GPT-6; requested Sonnet/Opus unavailable. Owned targets: `docs/BUILD.md`,
`docs/TESTING.md`, `tests/web-e2e/README.md`. No code/config edits, commits, pushes or device acceptance runs.

## Checklist results

| Checklist item | Result and source evidence |
| --- | --- |
| Current product naming; preserve historical DiPlay | Pass. Current guides use TiPlay. Kept upstream DiPlay download names, pinned experimental identity input, inherited internal identifiers and native compatibility terminology. `AGENTS.md` Naming and `mobile/build.gradle.kts` establish product/app identifiers. |
| Explicit project destinations; flag TiPlay conflicts | Fixed current `gh release create/view` examples to `uJZk/DiPlay`, following AGENTS.md. The prior BUILD example used `uJZk/TiPlay`; that destination conflicts with the explicit policy. No repository/Pages policy was invented and historical delivery evidence was not rewritten. Upstream download remains `shihabal3amri/DiPlay`. |
| Phone + car browser scope; native compatibility qualification | Fixed. BUILD labels sample/Automotive modules as retained upstream applications and distinguishes mandatory compatibility builds from product scope. TESTING now leads with current phone/browser checks and explicitly marks its original native matrix inactive upstream reference, with no new native acceptance gate. Source: AGENTS.md Product scope, `settings.gradle.kts`, Android workflow, `BrowserSettingsPolicy.kt`. |
| Preserve internal/legal/upstream contracts | Pass. No packages, classes, preference/resource/action/env names or legal notices changed. Existing runtime asset and signing key separation remains. Source: `mobile/build.gradle.kts`, `shared/build.gradle`, AGENTS.md and `docs/UPSTREAM_SYNC.md` policy as supplied by the checklist. |
| Current settings, native controls and reconnect consent | Fixed current TESTING checks. Main menu labels are **Save and reconnect** / **Connect phone**; advanced choices persist while **Return and apply** explicitly consents to reconnection. Current advanced page has FPS, HEVC, driving side, report and permission rows. Source: `BrowserMainSettingsMenu.kt`, `BrowserAdvancedPage.kt`, `BrowserAdvancedPageTest.kt`, `DiPlayActivity.kt` product-page dispatch, `CarPlayHostActivity.kt` APPLY handling and default strings XML. Native legacy Settings paths are preserved only inside the inactive reference. |
| Connection/browser/debug/resize/permissions/endpoint claims | Fixed. E2E README now lists existing top-of-window resize, active portal resume, reconnect Setting action, locked parameters and responsive blocking reconnect surface assertions. Explained that `phone-run.mjs` forces unsupported H.264 independently of installed codecs. Retained WebCodecs-only/LAN insecure-context policy and synthetic timing limits. Source: `run.mjs` checks near lines 267–352, `phone-run.mjs` unsupported worker injection near line 365, `site/play/app.js` active Connect/resume label, Node viewport/debug/portal tests, `CarPlayHostBrowserLinkTest.kt` retained display tests. TESTING records resize pending/recovery limits and actual Android permission refresh rather than claiming a device result. |
| Preserve/date historical raw results and limits | Pass. Existing historical identity/hash and restricted-environment notes remain dated October 11 examples; no raw evidence changed. Original native matrix body retained, with heading depth changed to place it under its compatibility scope. No past run was promoted to current hardware success. |
| Local links, duplicated instructions and guide consistency | Fixed broken Tesla-browser checklist anchor by linking the current guide and lifecycle heading. Updated reliability anchor to its current historical heading. BUILD now shows the full mandatory AGENTS/CI command plus Node/public-tree checks; TESTING links to it rather than maintaining a partial duplicate command. Scoped check: 13 local file/heading links passed. No Chinese counterparts in owned scope. |
| Owned docs only; no code/config changes or unsupported claims | Pass. Edited only the three owned guides plus this result and tooling TASKS entry. `git diff --check` for owned guides passes. Mandatory build/Node/public-tree execution is assigned to the coordinator and not claimed here. |

## Fixes

- BUILD: full CI verification commands, current product scope and retained sample/Automotive roles; explicit project release destination restored.
- TESTING: supported phone/browser checklist added; native matrix preserved as inactive compatibility reference; broken anchors repaired; exact current action labels and consent behavior documented.
- Browser E2E README: existing pairing/resize/reconnect assertions documented; active Connect button identified as the same button labeled **Return to CarPlay**; deterministic unsupported-H.264 injection and simulation limits clarified.

## Open findings and validation limits

- `uJZk/TiPlay` release/Pages references elsewhere conflict with AGENTS.md's `uJZk/DiPlay` destination. This task follows the explicit policy in current commands and leaves broader policy resolution to the coordinator/user; it does not claim deployment destination validity.
- The pinned upstream APK hash/provenance and October 11 Oracle/Temurin environment outcome were retained as historical inputs. No external APK download or independent historical reproduction was performed.
- Local E2E harnesses do not prove vehicle routing, actual iPhone display replacement/recovery, physical display latency or native head-unit acceptance. No new device results are claimed.
- The guide's GitHub upload authentication/connector limitation describes its recorded managed-environment procedure; no external upload or connector operation was attempted during this review.

## Verification

Source-only review of Gradle modules, workflow commands, tool versions, runtime-asset tasks, UI action/resource labels,
current Android tests, browser unit tests and E2E scripts completed. Scoped local link/anchor check passed (13 references).
Owned-guide whitespace check passed. Coordinator owns execution and consolidated validation results.
