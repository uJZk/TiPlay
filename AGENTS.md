# TiPlay contributor instructions

TiPlay supports **Android phone + car browser only**. 本项目不考虑原生车机。
Keep inherited native files for upstream merging; do not add product navigation,
settings or acceptance tests for native head units. Preserve shared session,
media, permission and connection contracts used by the phone/browser product.

## Documentation

Start at [docs/README.md](docs/README.md). Keep each topic in one stable document;
remove obsolete descriptions instead of appending delivery diaries. Use filenames
starting with a capital and hyphens between words, with no dates except sweep folders.
Conventional README, AGENTS, CLAUDE, CHANGELOG, SECURITY and legal/vendor filenames
are exceptions. Keep only the latest record for each sweep type; history remains in Git.
Project AGENTS.md files and documents under docs/ must stay below 8,192 words each.
Split a topic only when needed, target 4,096 words, and update the index and references.

- [Browser](docs/Browser.md), [connection setup](docs/Connection-setup.md),
  [hotspot address](docs/Hotspot-address.md) and [settings](docs/Settings.md): driver
  flow, browser/session ownership, immediate apply and continuous recovery.
- [Media transport](docs/CarPlay-DataChannel.md) and [roadmap](docs/WebRTC-roadmap.md):
  SRP-authenticated SDP, original-codec RTP, reliable ordered fallback records,
  independent timing and one-copy capture constraints.
- [AirPlay](docs/AirPlay.md): receiver, trust, screen borrowing, original media,
  RAOP/transient audio and URL session/resource contracts.
- [Audio tempo](docs/Audio-tempo.md), [Browser WASM](docs/Browser-wasm.md) and
  [audio evidence](docs/Audio-evidence.md): decoder/thread boundaries and evidence limits.
- [Diagnostics](docs/Diagnostics.md) and [privacy](docs/Privacy.md): opt-in persisted
  unredacted Debug capture, Standard TXT, Zstandard/STORED-ZIP exports and cleanup.
- [Geolocation](docs/Geolocation.md): GPS fallback, datum detection/conversion,
  browser-local cache and iPhone forwarding.
- [Build](docs/Build.md), [Windows containers](docs/Wlsc.md), [Testing](docs/Testing.md)
  and [Todo](docs/Todo.md): source checks, published provenance and physical acceptance.
- [Upstream](docs/Upstream.md), [third-party notices](docs/Third-party-notices.md)
  and [README presentation](docs/Readme-presentation.md): merge rules, licenses and artwork.
- [Latest code sweep](docs/sweep-2026-10-26/README.md) and
  [documentation sweep](docs/docs-sweep-2026-10-26/README.md): scope, resumable tasks,
  verification, open decisions and [delivery status](docs/sweep-2026-10-26/Delivery.md).

Resume current release work at [Build](docs/Build.md#current-browser-deployment)
and [beta.25](docs/Build.md#beta25-release). Keep source checks, published artifact
identity and vehicle evidence separate. Preserve strict source/profile/level/mode
admission, original compressed frames, bounded selection and per-instance callback
ownership. Beta.25 adds the original-video frame-dropper correction and the native
audio playout activation repair; its user-directed validation scope is recorded in Build.
Install the matching APK/page for physical acceptance and retain new codec diagnostics
if it fails. Historical beta-specific CI waivers do not waive checks for new work.
Software timestamps and codec benchmarks do not establish speaker/panel timing,
vehicle CPU, interoperability or elimination of every audible click.

## Checks

Live video uses original-codec WebRTC RTP through MediaStreamTrackProcessor directly
into Canvas. Do not add a video element, second encoding or DataChannel/WebCodecs
live-video fallback. Source changes use authenticated video-only renegotiation and
generation/ready barriers; unsupported codec/profile, reordering and processor failure
report video-only errors. Touch-specific catch-up is disabled.
Keep the initial video transceiver inactive across source replacement so its BUNDLE
DTLS/SCTP transport survives in-band video negotiation; retire old tracks and later
nonanchor transceivers. See [desktop RTP integration](docs/Testing.md#desktop-rtp-integration).

When the source audio codec is negotiated, forward original encoded audio over standard
WebRTC without Android decode/reencode. The independent audio peer uses libdatachannel's
official packetizers, not private libWebRTC ABI hooks. Unsupported formats retain the
DataChannel/libav/PCM-NetEq path. Keep RTP and fallback under the same mixing/ducking
policy, bounded per-stream dispatch and direct decoder-Worker-to-Worklet PCM ports.
Negotiated Opus uses native RTP. Libav.js Workers normalize supported fallback
formats to PCM16/48 kHz for PCM-NetEq. Keep live audio and video independent.
The native audio peer owns one detached, permanently muted, zero-volume audio
playout anchor to activate Chromium's receiver. Wait for fulfilled `play()` and
the exact Worklet binding before announcing slot readiness; retire the anchor
with its peer. All audible sound stays in the common Worklet mixing/ducking graph.
This activation must not add another audible output or a video element.

URL casting uses pinned libmedia AVPlayer for resource loading, buffering, decoding,
clocks, synchronization and Canvas rendering. Keep thin AirPlay session/proxy/authentication
and controls adapters. Do not restore the retired custom URL player, serial scheduler,
decoded queues, SoundTouch wrapper or implementation-specific tests. Disable MSE/video
element paths; use local runtime resources without CDN requests. Verify production CSP
and operation without SharedArrayBuffer. Subtitle parity and physical Tesla playback
remain separate acceptance.

Run the CI command from .github/workflows/android.yml before reporting a source change as done:

```sh
./gradlew :shared:testDebugUnitTest :common:testDebugUnitTest :home:testDebugUnitTest \
  :mobile:lintDebug :home:lintDebug :maphost:lintDebug \
  :mobile:assembleDebug :home:assembleDebug :maphost:assembleDebug
```

Set ANDROID_HOME or local.properties if Gradle cannot find the SDK.
CI also runs `node --test tests/web/*.test.mjs` with Node 22. See [Testing](docs/Testing.md)
for remaining source checks and device boundaries, [Build](docs/Build.md#browser-wasm-build)
for binary reproduction and [managed certificate trust](docs/Build.md#managed-cloud-certificate-trust)
for provisioned-JDK proxy setup. Do not commit machine-specific paths or proxy settings.

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
| Display | how CarPlay looks on the display | day/night mode, picture, size, resolution, frame rate, dock, system bars, multi-window resolution |
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

## Upstream

Follow [docs/Upstream.md](docs/Upstream.md) for preserved identifiers, dependency
provenance and the one-way merge procedure. Current project links use TiPlay;
numbered upstream references and historical names keep their original destinations.
