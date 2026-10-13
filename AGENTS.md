# AGENTS.md

Instructions for coding agents that work on TiPlay.

Browser resize, portal and discovery shutdown contracts are documented in `docs/TESLA_BROWSER.md`
under "Browser session lifecycle".

Phone settings, validated drafts, immediate apply/automatic reconnect and boot behavior follow
`docs/APP-MAIN-PAGE-DESIGN.md` and `docs/APP-MAIN-PAGE-IMPLEMENTATION.md`.

Build prerequisites, runtime identity, signing and APK update contracts are documented
in [docs/BUILD.md](docs/BUILD.md). Windows WSLC container supplements, including filesystem,
secret transfer and host ADB boundaries, are in [docs/WLSC.md](docs/WLSC.md).

## Current progress

See [docs/docs-sweep-2026-10-13/TIE-UP.md](docs/docs-sweep-2026-10-13/TIE-UP.md) for the recovered documentation sweep, user-confirmed destination/settings/endpoint policies and delivery handoff.

See `docs/sweep-2026-10-13/README.md` for single-Bonjour trial retirement, incremental
and post-merge code cleanup, and the requested tap-map/reverse-notification/audio-cancellation repairs.
`docs/sweep-2026-10-13/TIE-UP.md` records main integration, concurrency regressions,
final verification, commit/push/Pages delivery and remaining follow-up decisions.

See `docs/BROWSER-MEDIA-TIE-UP-2026-10-13.md` for authorized cleanup, main integration,
0.2.14-beta.2 delivery and Pages deployment status.

See `docs/BROWSER-MEDIA-2026-10-13.md` for compact settings, mandatory buffered music,
Video.js URL playback with authenticated resource proxying and direct iPhone resources,
removed URL-video timing code, and demand-switched car HFP/SCO audio and capture
with fixed navigation attenuation (no browser/software AEC).

Browser permission and retry-countdown verification evidence and the local delivery handoff are in ignored
`agent_docs/merge-all/HANDOFF.md`. Browser permission compatibility follows `docs/TESLA_BROWSER.md`.

See `docs/CARPLAY-CONNECTION-UX-2026-10-12.md` for continuous CarPlay recovery,
the 1/2/4/8/16-second Bluetooth arrival retry policy, USB-first All mode, independent
CarPlay opt-out, TiPlay mode copy, privileged USB attempts and Android 16 virtual validation.

See `docs/SETTINGS-IMMEDIATE-APPLY-2026-10-12.md` for immediate settings application,
default AirPlay startup, historical hotspot address handoff, verification and device follow-up.
Current hotspot address/port edits apply immediately on Android and NEVER proactively notify or migrate
the browser. The user selects Disconnect, edits Android address and selects Connect, or opens the
updated pairing link. Preserve the pairing code; do not update bookmarks automatically.

See `docs/BETA-RELEASE-2026-10-12.md` for the 0.2.14-beta.1 release inputs,
upstream CarPlay identity provenance, validation and publication status.

See `docs/docs-sweep-2026-10-12/README.md` for the incremental documentation sweep,
user-focused English/Chinese READMEs, checks and historically unresolved destination/label policies.
The user-confirmed TiPlay destinations and concise browser labels below supersede those open questions.
`docs/docs-sweep-2026-10-12/TIE-UP.md` records its integration and delivery progress.

See `docs/AIRPLAY.md` for the experimental ordinary AirPlay mirror/video receiver,
the pinned UxPlay reference, retained CarPlay display pause/resume contract and validation limits.
Remaining receiver compatibility, CarPlay audio continuity, browser audio timestamp scheduling and vehicle checks are in `docs/todo.md`.
Local device evidence and the next-session handoff are in ignored `agent_docs/adb-fixes/HANDOFF.md`; keep secrets and device captures out of commits.
Ordinary AirPlay video routing, app-specific device evidence and the next playback-architecture handoff are in ignored `agent_docs/airplay-route/HANDOFF.md`.
See `docs/AIRPLAY-TIE-UP-2026-10-12.md` for verification, integration and remaining device checks.
See `docs/todo.md` under "AirPlay 轻量信任设备机制" for the pending approval, remembered-device and takeover-protection work; it is not implemented yet.

See `docs/WEB-DEBUG-2026-10-12.md` for the dated four-field Debug overlay, browser theme delivery,
peer-initiated clock synchronization, Android lifecycle repairs and validation limits.
The browser page is hosted over HTTPS only; the APK does not bundle it and the phone has no local `/play/` route.
`docs/WEB-DEBUG-2026-10-11.md` retains the earlier implementation and playback-path history.
See `docs/sweep-2026-10-12/TIE-UP.md` for main integration, final verification and delivery progress.

See `docs/RECONNECT-UX-2026-10-11.md` for the pre-rendered reconnect wallpaper,
portal integration, verification and delivery progress. Follow `docs/WEB-PAIRING-DESIGN.md`
and `docs/APP-MAIN-PAGE-DESIGN.md` for layout contracts.
See `docs/APP-MAIN-PAGE-IMPLEMENTATION.md` for draft/session behavior and upstream compatibility.
See `docs/UI-REDESIGN-2026-10-11.md` for the Liquid Glass web UI,
native Android controls, safe window bounds and shared pre-rendered wallpaper.

See `docs/BROWSER-RESIZE-2026-10-11.md` for retained-wireless display renegotiation,
ADB measurements, debug installation, verification and remaining vehicle/recovery validation.

See `docs/APK-RELEASE-2026-10-11.md` for the signed 0.2.13 APK, upstream runtime
identity provenance, test results, download delivery and pending Release attachment upload.
`docs/BUILD.md` includes extraction, verification and draft-upload procedures.

See `docs/SETTINGS-UX-2026-10-11.md` for the dated main-menu ordering, connection-mode
migration, automatic radio hints, codec defaults, shared branding, verification and delivery progress.
Its final section records the two-menu browser UI, editable `address:port`, the
stopped Termux probe, the corrected Pages URL and the latest signed installation.

See `docs/docs-sweep-2026-10-11/README.md` for the completed documentation sweep,
verification and remaining link-policy/vehicle-validation limits;
`docs/docs-sweep-2026-10-11/TIE-UP.md` records its commit and delivery progress.

See `docs/sweep-2026-10-10/FOLLOWUP-2026-10-11.md` for the completed queue/resource lifecycle fixes and verification;
`docs/sweep-2026-10-10/TIE-UP-2026-10-11.md` records commit, merge, push and Pages deployment progress.

See `docs/SETTINGS-VALIDATION-2026-10-10.md` for the dated browser settings profile,
device installation, verification results and remaining vehicle checks.
`docs/E2E-VALIDATION-2026-10-10.md` records the earlier local browser E2E results
and system-proxy fix.

## Checks

Run the CI command from `.github/workflows/android.yml` before you report a change as done:

```sh
./gradlew :shared:testDebugUnitTest :common:testDebugUnitTest :home:testDebugUnitTest \
  :mobile:lintDebug :home:lintDebug :maphost:lintDebug \
  :mobile:assembleDebug :home:assembleDebug :maphost:assembleDebug
```

Set `ANDROID_HOME` or `local.properties` if Gradle cannot find the SDK.

CI also runs the browser page tests with Node 22: `node --test tests/web/*.test.mjs`.

## Adding or moving a setting

The TiPlay browser product has only **Main settings** and **Advanced settings**.
`BrowserMainSettingsMenu` holds everyday connection controls; `BrowserAdvancedSettings`
and the host-owned advanced page hold frame rate (60 fps by default), HEVC,
vehicle controls and diagnostic reports. Manufacturer, model, OEM label and MFi
certificate controls are hidden. Keep the legacy category APIs below for upstream
compatibility; do not add their navigation entries back to the browser menu.

The Settings screen is grouped by driver goal, not by implementation.
`SettingsCategory`, `SettingsSection` and `SettingsInformationArchitecture` at the top of
`common/src/main/java/com/shilapi/xcertplay/DiPlayActivity.kt` define the groups.
`SettingsLayoutPolicyTest` fails when a section has no category or has more than one.

### Choose the category

Ask which goal the driver has when they look for the setting. Use the first row that fits.

| Category | Put a setting here when it controls… | Examples |
| --- | --- | --- |
| Connection | how the iPhone connects and how TiPlay starts | connection setup, connect on open, start with the car, USB permissions, car hotspot automation, iPhone choice, Android permissions, Tesla browser, the phone + browser run mode and the extra hotspot address |
| Display | how CarPlay looks on the head-unit screen | day/night mode, picture, size, resolution, frame rate, dock, system bars, multi-window resolution |
| Audio | what the driver hears | media and navigation streams, music buffer |
| Navigation | location and turn-by-turn guidance | location to iPhone, BYD HUD and cluster guidance |
| Vehicle | how CarPlay fits this car and its driver | driving side, wheel keys (Siri, BYD joystick and map zoom), car button, gestures that conflict with the head unit |
| Diagnostics | troubleshooting evidence | diagnostic reports |
| Advanced | experimental, firmware-specific or risky behavior | dashboard map, split screen, screen rotation, side panel, HEVC video, audio focus, audio channel mapping, buffered music, vehicle data |
| Overview | nothing new | see "Overview" below |

A setting goes to Advanced when it is experimental, depends on specific firmware, or is an opt-in that can break sound, video or the connection on some head units.
A control that fixes a common problem and is safe at its default (for example the audio stream choice) stays in its category.
Exception: a gated control that only its own audience sees, and that completes an everyday goal, stays in that goal's category.
Example: auto car hotspot needs ADB but appears only for car-hotspot users, so it is in Connection.

Browser HEVC, AirPlay and VPN controls intentionally use concise titles without an experimental suffix.
Preserve existing experimental suffixes on retained upstream controls and their translated forms; do not
restore suffixes to these browser controls. Documentation may still explain experimental compatibility limits.

### Add the code

1. To extend an existing card, add the control inside the `filteredSection(...)` block of a card in the correct category.
2. For a new card, add a `SettingsSection` entry and map it to exactly one category in `SettingsInformationArchitecture.sectionsByCategory`.
3. Build the new card with `filteredSection(content, SettingsSection.X, …)` inside `allSettingsSections()`.
   A plain `section(...)` call there MUST NOT be used: it renders on every category page.
4. A setting MUST NOT appear in two categories.
   Overview quick settings are the only duplicates. They MUST use the same persistence as the full control. Overview SHOULD NOT have more than four quick settings.
5. Browser settings save and apply valid changes immediately. Changes requiring new negotiation MUST call
   `markReconnectNeeded()` after saving; in phone + browser mode it notifies the host to reconnect automatically
   while keeping the current settings page open. When CarPlay is enabled, valid idle edits MAY resume
   connection preparation and continuous recovery. Disabled CarPlay MUST block startup and retries.
   Do not add "Save and reconnect" or "Return and apply" actions to browser settings.
   Retained upstream native settings keep their existing explicit reconnect behavior.
6. Add each new string to `common/src/main/res/values/` and to every `values-xx` locale folder.
   New Settings copy SHOULD use the `settings_` prefix. `SettingsTranslationsTest` fails when a `settings_*` string has no translation.
7. A control that opens a choice uses `button()` with the text `"Title · Value"`.
   That form renders as a setting row with the value and a chevron, and Search indexes the title.
8. When you move a control between categories, update `AdaptiveSettingsUiTest.settingsLiveWhereDriversLookForThem`.

### Overview

Overview holds the connection status, links to the categories, quick settings, About and Language.
Do not add a new setting to Overview. Add it to its category. Then promote it to quick settings only if drivers change it often.

## Naming

The product is TiPlay. Use TiPlay in every name a user can see: strings in all locales, guides, the site and issue templates.
Keep DiPlay in `docs/RELEASE-NOTES-0.2.*.md`, past `CHANGELOG.md` entries, audit, review and validation records, upstream README copies and credits to the upstream project.
Keep these internal names unchanged, so that upstream changes still merge: Kotlin packages (`com.shilapi.xcertplay`), class and file names (`DiPlayActivity`), Android resource names, SharedPreferences names, log tags, thread names, intent actions (`com.shihab.diplay.action.EMBED_MAP`, `com.shihab.diplay.DISCONNECT`), `DIPLAY_AUTH_ASSETS_DIR` and `rootProject.name`.
Do not edit Kotlin comments or KDoc only to rename DiPlay.
The application ID is `com.ujzk.tiplay`; debug builds add `.hudtest`.
Link issues, releases and downloads to https://github.com/uJZk/TiPlay, and the official site to
https://ujzk.github.io/TiPlay/. Preserve dated historical destinations. Keep links to numbered upstream issues, pull requests and commits, and credits, on https://github.com/shihabal3amri/DiPlay.

## Product scope

TiPlay supports the Android phone + car browser flow only. 本项目不考虑原生车机。
Do not add or maintain native head-unit product navigation, settings or acceptance tests.
Upstream native files may remain solely to keep future upstream merges practical; their presence
is not a commitment to ship or validate a second product mode. Keep shared session, media,
permission and connection contracts that the phone + browser flow actually uses.

## Upstream

TiPlay merges upstream DiPlay and contributes nothing back: send no pull requests or patches to https://github.com/shihabal3amri/DiPlay.
在不影响复用上游后续代码更新可能的前提下，移除冗余代码。
Clean up TiPlay-owned duplicate or unused code while preserving the ability to reuse future upstream updates.
Retain upstream files, identifiers and compatibility paths; prefer small hooks into new product-specific files.

Put new features in new files. Give upstream files only small hook edits, and do not rename, move or delete upstream files or identifiers. Follow `docs/UPSTREAM_SYNC.md` to merge.
