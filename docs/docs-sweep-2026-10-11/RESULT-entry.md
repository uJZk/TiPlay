# Entry documentation review — 2026-10-11

Reviewed `AGENTS.md`, `CHANGELOG.md`, `CLAUDE.md`, `README.md`, `README.zh-CN.md` and `SECURITY.md` against the sweep checklist. Only documentation was edited.

## Fixes

- Both READMEs now describe BYD receiver functionality as inherited code and state that the current TiPlay entry points use the browser profile and hide BYD settings. The inherited installation/features remain available as historical context.
- Both READMEs replace the obsolete root-only requirement with the available root, experimental VPN and Shizuku address methods, linking to the requirements and validation limits in `docs/HOTSPOT_ADDRESS.md`.
- The unreleased CHANGELOG reflects the fixed browser/Bluetooth profile, removes the nonexistent head-unit selector and audio toggle instructions, and corrects the default CarPlay car-button label from Tesla to TiPlay.
- The Chinese README separates the current TiPlay browser settings description from the inherited DiPlay 0.2.13 UI changes. It corrects the fresh-install frame-rate default to 30 FPS, keeps selectable 60 FPS and save/reconnect instructions, and preserves the locale support statement.
- Historical CHANGELOG entries, credits, internal names, licensing and security guidance were preserved. `AGENTS.md`, `CLAUDE.md` and `SECURITY.md` required no edits.

## Evidence and verification

- `common/src/main/java/com/shilapi/xcertplay/BrowserSettingsPolicy.kt:9` forces PHONE_BROWSER, Bluetooth audio ON, SYSTEM appearance, location off and split-screen handling on; its hidden section set explains the unavailable local/BYD controls.
- `DiPlayActivity.kt:282` applies this policy at normal entry and host settings entry; `CarPlayHostActivity.kt:583` applies it on host creation.
- `AirPlayPersistence.kt:536` loads FPS with a 30 fallback; `CarPlayHostActivity.kt:687` loads that saved value and the browser config passes it through. `BrowserSettingsPolicy.activate` does not override FPS. The canvas helper’s 60 FPS default does not replace the persistence fallback.
- `CarButtonDefaults.kt:19` defines the browser default car-button label as TiPlay and preserves custom values.
- `HotspotAddressMethod.kt` defines NORMAL, ROOT, VPN and SHIZUKU; this review does not claim vehicle success for the experimental methods.
- `shared/src/main/java/com/shilapi/xcertplay/airplay/AirPlayInfoPlist.kt:54` and `AirPlayConfig.kt:87` support the audio format omission and declined audio stream claims.
- The diagnostic export route was checked against `CarPlaySettingsNavigation.addPage`, host menu DIAGNOSTICS navigation, and `strings_carplay_settings.xml`. The existing “CarPlay settings → More Diagnostics settings” instructions are correct and were preserved.
- All relative Markdown file links in the six assigned files exist. `git diff --check` passes for these files. Android and browser execution checks are delegated to the coordinator.

## Open issues

- Link policy conflict: `AGENTS.md` explicitly requires current issue/release/download/site links to `https://github.com/uJZk/DiPlay`; `.git/config` identifies `https://github.com/uJZk/TiPlay.git` as the current remote, `.github/workflows/pages.yml` records a `/TiPlay/` deployment with a configurable SITE_BASE_URL and a `/DiPlay/` fallback, and both READMEs already instruct users to open `https://ujzk.github.io/TiPlay/`. This review preserves the policy and existing destinations instead of guessing a new canonical project URL. The coordinator/user should resolve the policy before a link migration.
- Public release availability and current live hosting were not queried; “no TiPlay release yet” and historical vehicle probe results remain attributed existing statements, not newly verified current guarantees. Vehicle audio/CarPlay end-to-end acceptance is still unverified as stated in the docs.
