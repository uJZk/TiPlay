# TiPlay contributor instructions

TiPlay supports **Android phone + car browser only**. 本项目不考虑原生车机。
Keep inherited native files for upstream merging; do not add product navigation or acceptance
tests for native head units.

## Documentation

Start at [docs/README.md](docs/README.md). Keep each topic in one stable document;
remove obsolete descriptions instead of appending delivery diaries. Use filenames
starting with a capital and hyphens between words, with no dates except sweep folders.
Conventional README, AGENTS, CLAUDE, CHANGELOG, SECURITY and legal/vendor filenames
are exceptions. Keep only the latest sweep; historical records remain in Git.

Project AGENTS.md files and documents under docs/ must stay below 8,192 words each.
Split a topic only when needed, target 4,096 words, and update the index and references.

- [Browser](docs/Browser.md): pairing, receiver-aware waiting states, dismissible browser errors, resize, portal, media and shutdown.
- [CarPlay DataChannel contract](docs/CarPlay-DataChannel.md): reliable, ordered WebRTC transport, webpage decoding, independent timing, touch, routing and one-copy capture constraints; four-digit SRP-6a authenticated SDP binding and protocol bounds.
- [WebRTC roadmap](docs/WebRTC-roadmap.md): formal root deployment, four playback profiles, preserved beta.2/beta.3 playback and source-cadence evidence, and remaining physical acceptance.
- [Settings](docs/Settings.md): short receiver status titles, separate details, drafts, immediate apply, reconnect and boot.
- [Connection setup](docs/Connection-setup.md) and [hotspot address](docs/Hotspot-address.md).
- [AirPlay](docs/AirPlay.md): receiver/media contracts, native/software audio negotiation,
  AAC-ELD fallback and asynchronous URL startup. Physical audio/video checks remain in
  [Todo](docs/Todo.md#browser-and-carplay-audio) and [ordinary AirPlay acceptance](docs/Testing.md#ordinary-airplay-acceptance).
- [Diagnostics](docs/Diagnostics.md): opt-in unredacted capture sessions, browser decode/render evidence, process-default-off and clear behavior, Standard TXT/Debug ZIP formats and Debug-only AirPlay proxy routing; [privacy](docs/Privacy.md).
  Status refresh, permission reminders, iPhone Bluetooth audio copy and USB lifecycle capture validation are recorded in [Testing](docs/Testing.md#debug-raw-capture-and-car-bluetooth-hints); remaining device checks are in [Todo](docs/Todo.md#connection-settings-and-browser).
- [Geolocation](docs/geolocation.md): implemented GPS fallback, datum detection/conversion, browser cache and iPhone forwarding. Verification is in [Testing](docs/Testing.md#location-and-notification-verification); physical follow-up is in [Todo](docs/Todo.md#location).
- [Build](docs/Build.md), including the [0.2.20-beta.6 release verification and limits](docs/Build.md#beta-release), [WSLC](docs/Wlsc.md) and [testing](docs/Testing.md). Permission-checklist/browser-readiness verification is recorded in Testing; physical follow-up is in [Todo](docs/Todo.md#connection-settings-and-browser).
  Consolidated hints, explicit-operation feedback and their device checks are in [Testing](docs/Testing.md#phone-and-browser-acceptance).
  Receiver-status verification and remaining device checks are in [Testing](docs/Testing.md#receiver-status-and-browser-notices);
  provisioned-JDK proxy certificate setup is in [Build](docs/Build.md#managed-cloud-certificate-trust).
- [Upstream](docs/Upstream.md): merge policy, preserved identifiers, dependency provenance and the [integration review](docs/Upstream.md#integration-review).
- [Third-party notices](docs/Third-party-notices.md) and [remaining work](docs/Todo.md).
- [README presentation](docs/Readme-presentation.md): bilingual content decisions,
  screenshot provenance and documentation-only verification boundaries.
- [Latest documentation sweep](docs/docs-sweep-2026-10-15/README.md).

## Checks

Run the CI command from .github/workflows/android.yml before reporting a change as done:

```sh
./gradlew :shared:testDebugUnitTest :common:testDebugUnitTest :home:testDebugUnitTest \
  :mobile:lintDebug :home:lintDebug :maphost:lintDebug \
  :mobile:assembleDebug :home:assembleDebug :maphost:assembleDebug
```

Set ANDROID_HOME or local.properties if Gradle cannot find the SDK.
CI also runs `node --test tests/web/*.test.mjs` with Node 22. See [Testing](docs/Testing.md)
for the remaining source checks and device acceptance boundary.

## Adding or moving a setting

The TiPlay browser product has only **Main settings** and **Advanced settings**.
`BrowserMainSettingsMenu` holds everyday connection controls; `BrowserAdvancedSettings`
and the host-owned advanced page hold frame rate (60 fps by default),
vehicle controls and diagnostic reports. The browser reports decoder capabilities;
HEVC selection is automatic and has no manual switch. Manufacturer, model, OEM label and MFi
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

Browser AirPlay and VPN controls intentionally use concise titles without an experimental suffix.
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

Follow [docs/Upstream.md](docs/Upstream.md) for upstream maintenance rules, preserved identifiers, historical names and the one-way merge procedure.
