# Tasks

| Task | Scope / ownership | Rules | Model / reason | Status | Result |
|---|---|---|---|---|---|
| android-layout | BrowserMainSettingsMenu, BrowserSettingsPresentation, TiPlayNativeUi, corresponding tests; first Android UI/UX review including readiness | 1–9 + authorized repairs | gpt-6-astra: UI state and draft semantics | done | RESULT-android-layout.md; full Android CI passed; see README.md |
| android-lifecycle | CarPlayHostActivity, BrowserSettingsMenu, LocalHotspotAutofill, TeslaBrowserLinkCard, HotspotExtraAddressCard, relevant address state helpers, Android resources and corresponding tests; second Android UI/UX review | 1–9 + authorized repairs | gpt-6-astra: lifecycle and permissions | done | RESULT-android-lifecycle.md; full Android CI passed; see README.md |
| theme | BrowserAppearance, TeslaBrowserLink, NightModeController and shared controller theme path, corresponding tests; host hook coordinated through android-lifecycle | 1–9 + authorized repairs | gpt-6-astra: session and thread contracts | done | RESULT-theme.md; full Android CI passed; see README.md |
| web-debug | site/play JS/CSS/HTML, tests/web, tests/web-e2e; shared web timing and AirPlay timing source/tests as needed; debug stats and dead debug cleanup | 1–9 + authorized repairs | gpt-6-astra: synchronized timing and decoder behavior | done | RESULT-web-debug.md; Android CI, Node and both E2E suites passed |
| cleanup | remaining incremental Kotlin/build/tooling files excluding all agent ownership; review scope and remove proven unused TiPlay code | 1–9 | gpt-6.1-sol: narrow mechanical cleanup with escalation | done | RESULT-cleanup.md; full Android CI passed; see README.md |
| integration | sweep records, build verification and spot-check all edits | 1–9 | root: integration verification | done | README.md, ANDROID-TEST-SUMMARY.json and final validation logs |
