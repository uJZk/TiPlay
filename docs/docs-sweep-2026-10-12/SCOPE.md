# Sweep scope

Previous completed sweep baseline: `92cc2efca3a27c87f064f3ea63303dc266226b89`. Reviewed HEAD: `5449de24d399f9e4e1ce1124e7066d906df98813`. Working tree initially clean. User additionally requested README.md contain only user-needed content; root guides may be restructured for that purpose. Scope uses full commit history as well as final diff; no baseline recovery needed.

Exclude all `docs/docs-sweep-*/` and prior code-sweep records, generated site HTML/icon assets, binaries and raw historical validation logs. Sweep records are new audit output. Code, configuration and generated files are read-only.

## entry

Changed entry guides plus product policy, release summary and upstream contracts affected by browser profile, menu and build changes.

- `AGENTS.md` — `4884b89c01ebb255cb88a0e8b86d588ae069d070` Refine browser settings, native UI and launcher lifecycle; `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28` Use native Android settings and simplify browser pairing; `7c807f713148a90893f9c24bf61ce3b102cf42c3` Add browser Debug overlay and remove MSE fallback; `ff3f3da4cdc9dec53d88b89755cf10ea2ff7bf67` Redesign browser glass UI and expressive phone settings; `04f7bb1625b68adee5f75f9a485a7bff3975a483` Implement unified phone browser main page and connection drafts; `1c2691c7fe7c2b45e53d683cedb04054e8e1dd87` Add pre-rendered browser reconnect surface and record layout designs; `d77eef49499f0ff2e8f69042c7a54e4a270da2e6` Retain wireless resources during browser display resize; `1ecea2adc444bb5a0af5372cb689b17b8dfdc763` Adapt browser CarPlay to window changes and shorten reconnect cleanup; `7413a20b8730f5750cf2436a6d7b183b5e6c1e61` Simplify browser settings and make the browser port editable; `6394cd583b6fdff941b695fc9043a382a5fa160b` Document signed APK build and draft release workflow; `3c231985a10211b12dc46488b77a540decb3c124` Improve browser settings UX and unify TiPlay icons
- `README.md` — `1ecea2adc444bb5a0af5372cb689b17b8dfdc763` Adapt browser CarPlay to window changes and shorten reconnect cleanup
- `README.zh-CN.md` — `1ecea2adc444bb5a0af5372cb689b17b8dfdc763` Adapt browser CarPlay to window changes and shorten reconnect cleanup; `3c231985a10211b12dc46488b77a540decb3c124` Improve browser settings UX and unify TiPlay icons
- `CHANGELOG.md` — Included by code-to-document mapping above; no direct changes since baseline.
- `docs/INSTALL.md` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28` Use native Android settings and simplify browser pairing; `1ecea2adc444bb5a0af5372cb689b17b8dfdc763` Adapt browser CarPlay to window changes and shorten reconnect cleanup; `3c231985a10211b12dc46488b77a540decb3c124` Improve browser settings UX and unify TiPlay icons
- `docs/RELEASE-NOTES-NEXT.md` — `3c231985a10211b12dc46488b77a540decb3c124` Improve browser settings UX and unify TiPlay icons
- `docs/todo.md` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28` Use native Android settings and simplify browser pairing; `3c231985a10211b12dc46488b77a540decb3c124` Improve browser settings UX and unify TiPlay icons
- `docs/UPSTREAM_SYNC.md` — Included by code-to-document mapping above; no direct changes since baseline.

## main

Changed design contracts; verify draft/apply, native menus, pairing and launcher behavior.

- `docs/APP-MAIN-PAGE-DESIGN.md` — `5449de24d399f9e4e1ce1124e7066d906df98813` Show Android browser endpoint before hotspot probe completes; `4884b89c01ebb255cb88a0e8b86d588ae069d070` Refine browser settings, native UI and launcher lifecycle; `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28` Use native Android settings and simplify browser pairing; `ff3f3da4cdc9dec53d88b89755cf10ea2ff7bf67` Redesign browser glass UI and expressive phone settings; `04f7bb1625b68adee5f75f9a485a7bff3975a483` Implement unified phone browser main page and connection drafts; `1c2691c7fe7c2b45e53d683cedb04054e8e1dd87` Add pre-rendered browser reconnect surface and record layout designs
- `docs/APP-MAIN-PAGE-IMPLEMENTATION.md` — `4884b89c01ebb255cb88a0e8b86d588ae069d070` Refine browser settings, native UI and launcher lifecycle; `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28` Use native Android settings and simplify browser pairing; `60b0c60785df96a25434b450da65ec10bd1c9355` Record app main page delivery and deployment verification limits; `04f7bb1625b68adee5f75f9a485a7bff3975a483` Implement unified phone browser main page and connection drafts
- `docs/WEB-PAIRING-DESIGN.md` — `4884b89c01ebb255cb88a0e8b86d588ae069d070` Refine browser settings, native UI and launcher lifecycle; `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28` Use native Android settings and simplify browser pairing; `d78923999fb39ae64ad69b2a8e7e19dbfb5cb00a` Restyle Debug as a Liquid Glass settings switch; `7c807f713148a90893f9c24bf61ce3b102cf42c3` Add browser Debug overlay and remove MSE fallback; `ff3f3da4cdc9dec53d88b89755cf10ea2ff7bf67` Redesign browser glass UI and expressive phone settings; `1c2691c7fe7c2b45e53d683cedb04054e8e1dd87` Add pre-rendered browser reconnect surface and record layout designs

## connection

Changed connection guides plus existing Wi-Fi, radio ownership, retained-wireless recovery and hotspot documentation affected by changed network/controller/UI code.

- `docs/ANDROID9_WIFI_DIRECT.md` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28` Use native Android settings and simplify browser pairing
- `docs/CONNECTION_SETUP.md` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28` Use native Android settings and simplify browser pairing
- `docs/EXISTING_WIFI.md` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28` Use native Android settings and simplify browser pairing
- `docs/HOTSPOT_ADDRESS.md` — `3c231985a10211b12dc46488b77a540decb3c124` Improve browser settings UX and unify TiPlay icons
- `docs/CONNECTION_RELIABILITY.md` — Included by code-to-document mapping above; no direct changes since baseline.
- `docs/SMOOTH_WIRELESS.md` — Included by code-to-document mapping above; no direct changes since baseline.
- `docs/WIRELESS_DIAGNOSTICS.md` — Included by code-to-document mapping above; no direct changes since baseline.
- `docs/WIRELESS_HOTSPOT_JOIN.md` — Included by code-to-document mapping above; no direct changes since baseline.
- `docs/HOTSPOT_JOIN_VALIDATION.md` — Included by code-to-document mapping above; no direct changes since baseline.
- `docs/LOCAL_HOTSPOT_TEST.md` — Included by code-to-document mapping above; no direct changes since baseline.

## browser

Changed browser/privacy guides plus audio, view-area and side-panel documentation affected by removal of phone video rendering, MSE fallback and new resize behavior.

- `docs/TESLA_BROWSER.md` — `4884b89c01ebb255cb88a0e8b86d588ae069d070` Refine browser settings, native UI and launcher lifecycle; `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28` Use native Android settings and simplify browser pairing; `7c807f713148a90893f9c24bf61ce3b102cf42c3` Add browser Debug overlay and remove MSE fallback; `d77eef49499f0ff2e8f69042c7a54e4a270da2e6` Retain wireless resources during browser display resize; `1ecea2adc444bb5a0af5372cb689b17b8dfdc763` Adapt browser CarPlay to window changes and shorten reconnect cleanup; `3c231985a10211b12dc46488b77a540decb3c124` Improve browser settings UX and unify TiPlay icons
- `docs/PRIVACY.md` — `d77eef49499f0ff2e8f69042c7a54e4a270da2e6` Retain wireless resources during browser display resize
- `docs/BUFFERED_AUDIO.md` — Included by code-to-document mapping above; no direct changes since baseline.
- `docs/VIEW_AREAS.md` — Included by code-to-document mapping above; no direct changes since baseline.
- `docs/SIDE_PANEL.md` — Included by code-to-document mapping above; no direct changes since baseline.

## records

Changed dated implementation and delivery records; preserve historical evidence and distinguish superseded behavior.

- `docs/APK-RELEASE-2026-10-11.md` — `6394cd583b6fdff941b695fc9043a382a5fa160b` Document signed APK build and draft release workflow
- `docs/BROWSER-RESIZE-2026-10-11.md` — `763ae3041e69857824092991e2eaf12e0115bf4f` Record browser resize deployment verification; `d77eef49499f0ff2e8f69042c7a54e4a270da2e6` Retain wireless resources during browser display resize
- `docs/RECONNECT-UX-2026-10-11.md` — `1c2691c7fe7c2b45e53d683cedb04054e8e1dd87` Add pre-rendered browser reconnect surface and record layout designs
- `docs/SETTINGS-UX-2026-10-11.md` — `7413a20b8730f5750cf2436a6d7b183b5e6c1e61` Simplify browser settings and make the browser port editable; `83ec0700243973f5426e3bd4b6dcda42c7ac2791` Record settings UX delivery and Pages deployment; `3c231985a10211b12dc46488b77a540decb3c124` Improve browser settings UX and unify TiPlay icons
- `docs/UI-REDESIGN-2026-10-11.md` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28` Use native Android settings and simplify browser pairing; `65f8a9c823ce516e07a26e4be0071059c03fef1b` Record UI redesign verification and Pages delivery; `ff3f3da4cdc9dec53d88b89755cf10ea2ff7bf67` Redesign browser glass UI and expressive phone settings
- `docs/WEB-DEBUG-2026-10-11.md` — `146565d6eefc6631a8a77548d366e79b07991db0` Record Liquid Glass switch verification and deployment; `d78923999fb39ae64ad69b2a8e7e19dbfb5cb00a` Restyle Debug as a Liquid Glass settings switch; `e5f769a8ade8d202ec10fd5addf94c7b65537bdf` Record browser Debug verification and deployment; `7c807f713148a90893f9c24bf61ce3b102cf42c3` Add browser Debug overlay and remove MSE fallback

## tooling

Changed build/test guides affected by native UI tests, bundled web modules and browser E2E changes.

- `docs/BUILD.md` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28` Use native Android settings and simplify browser pairing; `6394cd583b6fdff941b695fc9043a382a5fa160b` Document signed APK build and draft release workflow
- `docs/TESTING.md` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28` Use native Android settings and simplify browser pairing
- `tests/web-e2e/README.md` — `7c807f713148a90893f9c24bf61ce3b102cf42c3` Add browser Debug overlay and remove MSE fallback

## Code and configuration history

The following non-document paths were touched in the full history. Generated paths and removed files remain listed as evidence, not editing targets.

- `.gitattributes` — `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `assets/branding/logo_centered.svg` — `3c231985a10211b12dc46488b77a540decb3c124`
- `common/build.gradle.kts` — `04f7bb1625b68adee5f75f9a485a7bff3975a483`
- `common/src/main/java/com/shilapi/xcertplay/AirPlayPersistence.kt` — `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/java/com/shilapi/xcertplay/BootReceiver.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/java/com/shilapi/xcertplay/BrowserAboutPage.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/main/java/com/shilapi/xcertplay/BrowserAdvancedPage.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/main/java/com/shilapi/xcertplay/BrowserAdvancedSettings.kt` — `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/java/com/shilapi/xcertplay/BrowserBatteryOptimizationSettings.kt` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/java/com/shilapi/xcertplay/BrowserBootConnectionSettings.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/main/java/com/shilapi/xcertplay/BrowserConnectionDraft.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`
- `common/src/main/java/com/shilapi/xcertplay/BrowserDiagnosticResultUi.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/main/java/com/shilapi/xcertplay/BrowserDisplayReconnectHost.kt` — `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`
- `common/src/main/java/com/shilapi/xcertplay/BrowserEndpointSettings.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/java/com/shilapi/xcertplay/BrowserExistingWifiSettings.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/main/java/com/shilapi/xcertplay/BrowserMainSettingsMenu.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `ff3f3da4cdc9dec53d88b89755cf10ea2ff7bf67`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/java/com/shilapi/xcertplay/BrowserNativeSettingsUi.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/main/java/com/shilapi/xcertplay/BrowserPermissionsPage.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/main/java/com/shilapi/xcertplay/BrowserSettingsMenu.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `ff3f3da4cdc9dec53d88b89755cf10ea2ff7bf67`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/java/com/shilapi/xcertplay/BrowserSettingsPolicy.kt` — `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/java/com/shilapi/xcertplay/BrowserSettingsPresentation.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `ff3f3da4cdc9dec53d88b89755cf10ea2ff7bf67`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/java/com/shilapi/xcertplay/CarButtonDefaults.kt` — `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/java/com/shilapi/xcertplay/CarPlayHostActivity.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`, `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`, `9ac0048ce1c996660a50bc50ec69c2bcb344d67e`, `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/java/com/shilapi/xcertplay/CarPlaySettingsNavigation.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/java/com/shilapi/xcertplay/CarPlaySettingsPermissions.kt` — `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/java/com/shilapi/xcertplay/DiPlayActivity.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `ff3f3da4cdc9dec53d88b89755cf10ea2ff7bf67`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/java/com/shilapi/xcertplay/DiagnosticExportStore.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/main/java/com/shilapi/xcertplay/HotspotExtraAddressCard.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/java/com/shilapi/xcertplay/LocalHotspotAutofill.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/java/com/shilapi/xcertplay/PhoneBrowserReceiverUi.kt` — `9ac0048ce1c996660a50bc50ec69c2bcb344d67e`
- `common/src/main/java/com/shilapi/xcertplay/TeslaBrowserLink.kt` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`, `9ac0048ce1c996660a50bc50ec69c2bcb344d67e`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/java/com/shilapi/xcertplay/TeslaBrowserLinkCard.kt` — `5449de24d399f9e4e1ce1124e7066d906df98813`, `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/java/com/shilapi/xcertplay/TeslaBrowserPageLinks.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/java/com/shilapi/xcertplay/TiPlayExpressiveUi.kt` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `ff3f3da4cdc9dec53d88b89755cf10ea2ff7bf67`
- `common/src/main/java/com/shilapi/xcertplay/TiPlayNativeUi.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/res/drawable/ic_carplay.png` — `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/raw/ic_car_home.png` — `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-ar/strings.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`
- `common/src/main/res/values-ar/strings_battery_optimization.xml` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/res/values-ar/strings_browser_menus.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/res/values-ar/strings_browser_revision.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/main/res/values-ar/strings_carplay_settings.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-ar/strings_hotspot_address.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-ar/strings_settings_layout.xml` — `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/res/values-ar/strings_tesla.xml` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-ar/strings_tesla_link.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/res/values-es/strings.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`
- `common/src/main/res/values-es/strings_battery_optimization.xml` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/res/values-es/strings_browser_menus.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/res/values-es/strings_browser_revision.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/main/res/values-es/strings_carplay_settings.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-es/strings_hotspot_address.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-es/strings_settings_layout.xml` — `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/res/values-es/strings_tesla.xml` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-es/strings_tesla_link.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/res/values-night/tiplay_native_theme.xml` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/res/values-ru/strings.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`
- `common/src/main/res/values-ru/strings_battery_optimization.xml` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/res/values-ru/strings_browser_menus.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/res/values-ru/strings_browser_revision.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/main/res/values-ru/strings_carplay_settings.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-ru/strings_hotspot_address.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-ru/strings_settings_layout.xml` — `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/res/values-ru/strings_tesla.xml` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-ru/strings_tesla_link.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/res/values-uk/strings.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`
- `common/src/main/res/values-uk/strings_battery_optimization.xml` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/res/values-uk/strings_browser_menus.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/res/values-uk/strings_browser_revision.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/main/res/values-uk/strings_carplay_settings.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-uk/strings_hotspot_address.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-uk/strings_settings_layout.xml` — `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/res/values-uk/strings_tesla.xml` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-uk/strings_tesla_link.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/res/values-zh-rCN/strings.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`
- `common/src/main/res/values-zh-rCN/strings_battery_optimization.xml` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/res/values-zh-rCN/strings_browser_menus.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/res/values-zh-rCN/strings_browser_revision.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/main/res/values-zh-rCN/strings_carplay_settings.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-zh-rCN/strings_hotspot_address.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-zh-rCN/strings_settings_layout.xml` — `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/res/values-zh-rCN/strings_tesla.xml` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-zh-rCN/strings_tesla_link.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/res/values-zh-rTW/strings.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`
- `common/src/main/res/values-zh-rTW/strings_battery_optimization.xml` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/res/values-zh-rTW/strings_browser_menus.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/res/values-zh-rTW/strings_browser_revision.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/main/res/values-zh-rTW/strings_carplay_settings.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-zh-rTW/strings_hotspot_address.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-zh-rTW/strings_settings_layout.xml` — `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/res/values-zh-rTW/strings_tesla.xml` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values-zh-rTW/strings_tesla_link.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/res/values/strings.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/res/values/strings_battery_optimization.xml` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/res/values/strings_browser_menus.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/main/res/values/strings_browser_revision.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/main/res/values/strings_carplay_settings.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values/strings_hotspot_address.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values/strings_tesla.xml` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/main/res/values/strings_tesla_link.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/main/res/values/tiplay_native_theme.xml` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/test/java/com/shilapi/xcertplay/AdaptiveSettingsUiTest.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/test/java/com/shilapi/xcertplay/BrowserAdvancedPageTest.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/test/java/com/shilapi/xcertplay/BrowserBatteryOptimizationSettingsTest.kt` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/test/java/com/shilapi/xcertplay/BrowserEndpointSettingsTest.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/test/java/com/shilapi/xcertplay/BrowserMainEntryTest.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/test/java/com/shilapi/xcertplay/BrowserMainHostTest.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`
- `common/src/test/java/com/shilapi/xcertplay/BrowserMainPageTest.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`
- `common/src/test/java/com/shilapi/xcertplay/BrowserSettingsPolicyTest.kt` — `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/test/java/com/shilapi/xcertplay/CarButtonDefaultsTest.kt` — `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/test/java/com/shilapi/xcertplay/CarButtonImagePickerTest.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/test/java/com/shilapi/xcertplay/CarPlayHostBrowserLinkTest.kt` — `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`, `9ac0048ce1c996660a50bc50ec69c2bcb344d67e`, `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `common/src/test/java/com/shilapi/xcertplay/CarPlayHostResolutionTest.kt` — `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/test/java/com/shilapi/xcertplay/CarPlayHostSettingsTest.kt` — `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/test/java/com/shilapi/xcertplay/CarPlayHostVideoSurfaceTest.kt` — `9ac0048ce1c996660a50bc50ec69c2bcb344d67e`
- `common/src/test/java/com/shilapi/xcertplay/CarPlaySettingsNavigationTest.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/test/java/com/shilapi/xcertplay/DefaultConnectionModeTest.kt` — `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/test/java/com/shilapi/xcertplay/DiagnosticExportFallbackTest.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/test/java/com/shilapi/xcertplay/DiagnosticExportUiTest.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/test/java/com/shilapi/xcertplay/ExistingWifiManagerTest.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `common/src/test/java/com/shilapi/xcertplay/ExistingWifiSettingsTest.kt` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/test/java/com/shilapi/xcertplay/HotspotExtraAddressSettingsTest.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/test/java/com/shilapi/xcertplay/PhoneBrowserModeSettingsTest.kt` — `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/test/java/com/shilapi/xcertplay/PhoneBrowserReceiverUiTest.kt` — `9ac0048ce1c996660a50bc50ec69c2bcb344d67e`
- `common/src/test/java/com/shilapi/xcertplay/StartupDiagnosticSnapshotTest.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `common/src/test/java/com/shilapi/xcertplay/TeslaBrowserLinkSettingsTest.kt` — `5449de24d399f9e4e1ce1124e7066d906df98813`, `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`, `3c231985a10211b12dc46488b77a540decb3c124`
- `common/src/test/java/com/shilapi/xcertplay/TeslaBrowserLinkTest.kt` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `9ac0048ce1c996660a50bc50ec69c2bcb344d67e`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/test/java/com/shilapi/xcertplay/TeslaBrowserPageLinksTest.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7413a20b8730f5750cf2436a6d7b183b5e6c1e61`
- `common/src/test/java/com/shilapi/xcertplay/TiPlayExpressiveUiTest.kt` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `ff3f3da4cdc9dec53d88b89755cf10ea2ff7bf67`
- `common/src/test/java/com/shilapi/xcertplay/TiPlayNativeUiTest.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `gradle/tiplay-product-tests.gradle.kts` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `04f7bb1625b68adee5f75f9a485a7bff3975a483`
- `mobile/src/main/AndroidManifest.xml` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `3c231985a10211b12dc46488b77a540decb3c124`
- `scripts/generate_app_icons.py` — `3c231985a10211b12dc46488b77a540decb3c124`
- `scripts/measure_browser_resize.mjs` — `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`
- `shared/src/main/ic_launcher-playstore.png` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/java/com/shilapi/xcertplay/airplay/AirPlaySession.kt` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `shared/src/main/java/com/shilapi/xcertplay/airplay/CarPlayMediaEngine.kt` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `shared/src/main/java/com/shilapi/xcertplay/airplay/NtpClock.kt` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `shared/src/main/java/com/shilapi/xcertplay/media/BrowserOnlyMediaSink.kt` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`, `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`, `9ac0048ce1c996660a50bc50ec69c2bcb344d67e`
- `shared/src/main/java/com/shilapi/xcertplay/media/VideoTeeMediaSink.kt` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `shared/src/main/java/com/shilapi/xcertplay/network/BonjourMdnsCleanup.kt` — `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `shared/src/main/java/com/shilapi/xcertplay/network/CarPlayBonjour.kt` — `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `shared/src/main/java/com/shilapi/xcertplay/network/CarPlayVpnService.kt` — `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`
- `shared/src/main/java/com/shilapi/xcertplay/network/ExistingWifiManager.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `shared/src/main/java/com/shilapi/xcertplay/network/ExistingWifiSecurity.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `shared/src/main/java/com/shilapi/xcertplay/orchestration/BrowserDisplayReconnect.kt` — `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`
- `shared/src/main/java/com/shilapi/xcertplay/orchestration/CarPlayController.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`, `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `shared/src/main/java/com/shilapi/xcertplay/orchestration/CarPlayRuntimeConfig.kt` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`
- `shared/src/main/java/com/shilapi/xcertplay/orchestration/RetainedBluetoothBootstrap.kt` — `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`
- `shared/src/main/java/com/shilapi/xcertplay/web/BrowserLinkServer.kt` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`, `1c2691c7fe7c2b45e53d683cedb04054e8e1dd87`, `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `shared/src/main/java/com/shilapi/xcertplay/web/BrowserLinkStatus.kt` — `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `shared/src/main/java/com/shilapi/xcertplay/web/BrowserPortalSignal.kt` — `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `shared/src/main/java/com/shilapi/xcertplay/web/WebDebugTiming.kt` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `shared/src/main/java/com/shilapi/xcertplay/web/WebMediaSink.kt` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`, `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`
- `shared/src/main/java/com/shilapi/xcertplay/web/WebVideoHub.kt` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `shared/src/main/java/com/shilapi/xcertplay/web/WebVideoRecords.kt` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `shared/src/main/res/mipmap-hdpi/ic_launcher.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-hdpi/ic_launcher_background.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-hdpi/ic_launcher_foreground.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-hdpi/ic_launcher_monochrome.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-hdpi/ic_launcher_round.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-mdpi/ic_launcher.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-mdpi/ic_launcher_background.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-mdpi/ic_launcher_foreground.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-mdpi/ic_launcher_monochrome.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-mdpi/ic_launcher_round.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-xhdpi/ic_launcher.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-xhdpi/ic_launcher_background.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-xhdpi/ic_launcher_foreground.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-xhdpi/ic_launcher_monochrome.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-xhdpi/ic_launcher_round.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-xxhdpi/ic_launcher.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-xxhdpi/ic_launcher_background.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-xxhdpi/ic_launcher_monochrome.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-xxhdpi/ic_launcher_round.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-xxxhdpi/ic_launcher.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-xxxhdpi/ic_launcher_background.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-xxxhdpi/ic_launcher_monochrome.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/main/res/mipmap-xxxhdpi/ic_launcher_round.webp` — `3c231985a10211b12dc46488b77a540decb3c124`
- `shared/src/test/java/com/shilapi/xcertplay/airplay/MediaClockMappingTest.kt` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `shared/src/test/java/com/shilapi/xcertplay/media/BrowserOnlyMediaSinkTest.kt` — `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`, `9ac0048ce1c996660a50bc50ec69c2bcb344d67e`
- `shared/src/test/java/com/shilapi/xcertplay/network/BonjourMdnsCleanupTest.kt` — `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `shared/src/test/java/com/shilapi/xcertplay/network/BrowserDisplayReconnectTest.kt` — `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`
- `shared/src/test/java/com/shilapi/xcertplay/orchestration/BrowserDisplayReconnectStateTest.kt` — `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`
- `shared/src/test/java/com/shilapi/xcertplay/orchestration/CarPlayControllerHeadUnitIntegrationsTest.kt` — `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `shared/src/test/java/com/shilapi/xcertplay/orchestration/CarPlayControllerWirelessCloseTest.kt` — `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`
- `shared/src/test/java/com/shilapi/xcertplay/orchestration/RetainedBluetoothBootstrapTest.kt` — `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`
- `shared/src/test/java/com/shilapi/xcertplay/web/BrowserLinkPageTest.kt` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7c807f713148a90893f9c24bf61ce3b102cf42c3`, `1c2691c7fe7c2b45e53d683cedb04054e8e1dd87`
- `shared/src/test/java/com/shilapi/xcertplay/web/BrowserLinkServerTest.kt` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7c807f713148a90893f9c24bf61ce3b102cf42c3`, `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `shared/src/test/java/com/shilapi/xcertplay/web/BrowserPairingGateTest.kt` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `shared/src/test/java/com/shilapi/xcertplay/web/WebDebugTimingTest.kt` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `shared/src/test/java/com/shilapi/xcertplay/web/WebJsonTest.kt` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `shared/src/test/java/com/shilapi/xcertplay/web/WebMediaSinkTest.kt` — `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`
- `site/ar/index.html` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `site/assets/icon.png` — `3c231985a10211b12dc46488b77a540decb3c124`
- `site/content.json` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `site/es/index.html` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `site/index.html` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `site/play/app.js` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7c807f713148a90893f9c24bf61ce3b102cf42c3`, `ff3f3da4cdc9dec53d88b89755cf10ea2ff7bf67`, `1c2691c7fe7c2b45e53d683cedb04054e8e1dd87`, `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`, `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `site/play/clock-sync.js` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `site/play/decoder-worker.js` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `site/play/fmp4.js` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `site/play/fps-window.js` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `site/play/icon.svg` — `3c231985a10211b12dc46488b77a540decb3c124`
- `site/play/index.html` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `d78923999fb39ae64ad69b2a8e7e19dbfb5cb00a`, `7c807f713148a90893f9c24bf61ce3b102cf42c3`, `ff3f3da4cdc9dec53d88b89755cf10ea2ff7bf67`, `1c2691c7fe7c2b45e53d683cedb04054e8e1dd87`, `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `site/play/link.js` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `site/play/mse.js` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `site/play/reconnect-wallpaper-blurred.png` — `1c2691c7fe7c2b45e53d683cedb04054e8e1dd87`
- `site/play/reconnect.css` — `ff3f3da4cdc9dec53d88b89755cf10ea2ff7bf67`, `1c2691c7fe7c2b45e53d683cedb04054e8e1dd87`
- `site/play/reconnect.js` — `1c2691c7fe7c2b45e53d683cedb04054e8e1dd87`
- `site/play/settings.js` — `1c2691c7fe7c2b45e53d683cedb04054e8e1dd87`
- `site/play/style.css` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `d78923999fb39ae64ad69b2a8e7e19dbfb5cb00a`, `7c807f713148a90893f9c24bf61ce3b102cf42c3`, `ff3f3da4cdc9dec53d88b89755cf10ea2ff7bf67`, `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `site/play/sw.js` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `d78923999fb39ae64ad69b2a8e7e19dbfb5cb00a`, `7c807f713148a90893f9c24bf61ce3b102cf42c3`, `ff3f3da4cdc9dec53d88b89755cf10ea2ff7bf67`, `1c2691c7fe7c2b45e53d683cedb04054e8e1dd87`, `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`, `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `site/play/transport.js` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `site/play/video.js` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `site/ru/index.html` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `site/uk/index.html` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `site/zh-Hans/index.html` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `site/zh-Hant/index.html` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `tests/web-e2e/RealPhone.java` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `tests/web-e2e/fake-phone.mjs` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`, `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `tests/web-e2e/phone-run.mjs` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7c807f713148a90893f9c24bf61ce3b102cf42c3`, `1c2691c7fe7c2b45e53d683cedb04054e8e1dd87`
- `tests/web-e2e/resources.test.mjs` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `tests/web-e2e/run.mjs` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7c807f713148a90893f9c24bf61ce3b102cf42c3`, `1c2691c7fe7c2b45e53d683cedb04054e8e1dd87`, `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `tests/web/debug-window.test.mjs` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `tests/web/fmp4.test.mjs` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `tests/web/link.test.mjs` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`, `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `tests/web/mse.test.mjs` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `tests/web/page.test.mjs` — `4884b89c01ebb255cb88a0e8b86d588ae069d070`, `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `tests/web/portal.test.mjs` — `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`, `1ecea2adc444bb5a0af5372cb689b17b8dfdc763`
- `tests/web/records-v1.test.mjs` — `7c807f713148a90893f9c24bf61ce3b102cf42c3`
- `tests/web/site.test.mjs` — `1d8a5dd23940e6f258c35a13c3daa7e4315b8c28`
- `tests/web/viewport.test.mjs` — `d77eef49499f0ff2e8f69042c7a54e4a270da2e6`
