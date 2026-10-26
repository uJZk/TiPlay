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
- [Settings](docs/Settings.md): shared phone page/window chrome, visible system bars, short receiver status titles, separate details, drafts, immediate apply, reconnect and boot.
- [Connection setup](docs/Connection-setup.md) and [hotspot address](docs/Hotspot-address.md).
- [AirPlay](docs/AirPlay.md): receiver/media contracts, native/software audio negotiation,
  AAC-ELD fallback and asynchronous URL startup. Physical audio/video checks remain in
  [Todo](docs/Todo.md#browser-and-carplay-audio) and [ordinary AirPlay acceptance](docs/Testing.md#ordinary-airplay-acceptance).
- [Diagnostics](docs/Diagnostics.md): opt-in unredacted capture sessions, browser decode/render and live-policy evidence, URL failure/cleanup and resource-transfer boundaries, persisted capture/restart dialog and clear behavior, Standard TXT/Zstandard-in-STORED-ZIP formats and Debug-only AirPlay proxy routing; [privacy](docs/Privacy.md).
  Status refresh, permission reminders, iPhone Bluetooth audio copy and USB lifecycle capture validation are recorded in [Testing](docs/Testing.md#debug-raw-capture-and-car-bluetooth-hints); remaining device checks are in [Todo](docs/Todo.md#connection-settings-and-browser).
- [Geolocation](docs/geolocation.md): implemented GPS fallback, datum detection/conversion, browser cache and iPhone forwarding. Verification is in [Testing](docs/Testing.md#location-and-notification-verification); physical follow-up is in [Todo](docs/Todo.md#location).
- [Build](docs/Build.md), including the [current beta release verification and limits](docs/Build.md#beta23-release), [WSLC](docs/Wlsc.md) and [testing](docs/Testing.md). Control-queue isolation and URL PCM continuity evidence are in [Diagnostics](docs/Diagnostics.md). Permission-checklist/browser-readiness verification is recorded in Testing; physical follow-up is in [Todo](docs/Todo.md#connection-settings-and-browser).
  Consolidated hints, explicit-operation feedback and their device checks are in [Testing](docs/Testing.md#phone-and-browser-acceptance).
  Receiver-status verification and remaining device checks are in [Testing](docs/Testing.md#receiver-status-and-browser-notices);
  provisioned-JDK proxy certificate setup is in [Build](docs/Build.md#managed-cloud-certificate-trust).
- [Upstream](docs/Upstream.md): merge policy, preserved identifiers, dependency provenance and the [integration review](docs/Upstream.md#integration-review).
- [Third-party notices](docs/Third-party-notices.md) and [remaining work](docs/Todo.md).
- [README presentation](docs/Readme-presentation.md): bilingual content decisions,
  screenshot provenance and documentation-only verification boundaries.
- [Latest documentation sweep](docs/docs-sweep-2026-10-15/README.md).

Resume CarPlay/AirPlay parameter work at the [parameter evidence checklist](docs/Todo.md#playback-parameter-evidence)
and [roadmap evidence table](docs/WebRTC-roadmap.md#参数核验与调优边界). Read
[Diagnostics](docs/Diagnostics.md) for attempted-versus-accepted fit noise, render quantum,
browser-render underruns, retained deadline triggers, capture overhead, resource stages
and sparse screen-loan ownership/data/close evidence. The
[AirPlay coexistence contract](docs/AirPlay.md#carplay-coexistence) covers ownership
confirmation and reentrant borrow/return; [Testing](docs/Testing.md#webrtc-integrated-acceptance) records software verification,
and [Build](docs/Build.md#current-browser-deployment) for the current webpage source and APK record. Keep
unrun boundaries, proved behavior and vehicle tuning separate; an observed software
timestamp does not establish speaker/panel timing.
Resume device-clock, buffered-flush and voice-preparation/recovery fixes with independent waveform checks at
[continuous-audio acceptance](docs/Testing.md#media-clock-and-continuous-audio-acceptance);
[Todo](docs/Todo.md#browser-and-carplay-audio) retains physical clicks and separate URL-audio follow-up.
The browser's [WASM boundary](docs/Browser-wasm.md) documents libav.js decoding/resampling,
NetEq, fixed-memory live-audio kernels and AVPlayer URL playback, with native-browser
and measured slower-case exceptions. Rebuild and byte-verify the binaries using
[Build](docs/Build.md#browser-wasm-build). Its [audio clock roles](docs/Browser-wasm.md#audio-clock-roles)
record frame-based live timing, causal output probes and natural URL completion;
[Testing](docs/Testing.md#browser-wasm-verification) records browser and Android
verification, including faulty-currentTime Chromium runs.
The historical beta.21/code63 release followed beta.20/code62 and is tracked in [Build](docs/Build.md#beta21-release). Its CarPlay
session/resource and single-initial-SETUP boundaries are documented in
[AirPlay](docs/AirPlay.md#carplay-coexistence); [Build](docs/Build.md#beta-release)
records its exact build commit, published artifacts, verification and signer/runtime/source provenance.
The independent
[Cloudflare Workers comparison](docs/Todo.md#cloudflare-workers-audio-comparison)
and vehicle uploads remain separate unfinished work; native WebRTC audio tracks
remain a separate non-URL alternative.

Resume CarPlay audio tuning from the browser v86
[release record](docs/Build.md#browser-v86-release).
It covers three-second trend/soft-limit SoundTouch catch-up, 5 ms overlap tails,
LIVI-compatible loan parameters, replay CPU limits and remaining device acceptance. Beta.17 retains its earlier signed CI evidence. Preserve the distinction between checked source and published artifacts.

Browser v87 retains v86's held catch-up and contiguous PCM/progress/braking exits;
[audio clock roles](docs/Browser-wasm.md#audio-clock-roles) describes them.
Beta.20 adds bounded Debug evidence without changing recovery policy. The user
explicitly skipped full CI; targeted checks and signed Release lint/build passed.

Resume Android diagnostic UI/compression work from [Diagnostics](docs/Diagnostics.md):
Debug switch/View logs dialogs, end-and-clear/minimize behavior, Zstandard level 3 and STORED ZIP
exports. Its targeted verification and remaining vehicle checks are recorded there.

Resume beta.20/code62 and browser v87 audio evidence work at
[Audio evidence](docs/Audio-evidence.md) and
[Build](docs/Build.md#beta-release). It records capture bounds,
raw frame-jump witnesses, pre/post waveform coverage, CPU attribution limits and
the user's explicit full-CI skip for this release. The APK/source/checksums are published, and public v87 bytes are verified.
The added manual browser-trace workflow was removed at the user's request.

Browser v89 audio work is documented in [Audio tempo](docs/Audio-tempo.md).
Realtime Opus decodes directly in official NetEq. AAC-LC/ELD/ALAC and non-48 kHz
PCM use libav.js Workers with continuous resampling to PCM16/48 kHz. No realtime
WebCodecs audio, FDK, libsoxr or live SoundTouch/PD remains. The AudioContext is
48 kHz; live audio and video are independent. That v89 URL implementation used native audio
first, libav fallback, manual tempo and video-frame PD; the AVPlayer migration replaces it. That rollout preserved Android beta.20/code62; beta.21 superseded this web-only restriction.

Resume from [Audio tempo](docs/Audio-tempo.md), the
[SIMD report](tests/bench/libav/README.md), and [Build](docs/Build.md#current-browser-deployment).
The earlier v89 tie-up skipped CI and APK compilation. The beta.21/code63 APK and v90 page were published with signed Release lint/build and independent artifact checks; that rollout skipped the full Android suite. Local web,
actual Chromium Worklet/decoder/URL, offline-cache, site assembly and native-source
consistency checks are used. Release commits may use `[skip ci]` to control ordering;
manually run Android checks before signing/publication, then deploy with the existing Pages workflow. Physical Tesla CPU, sound quality and simultaneous
stream acceptance remain unverified. Do not claim a measured clock or a codec
benchmark establishes speaker timing or eliminates every click.

Beta.23 AirPlay support adds classic SDP/UDP RAOP and AirPlay 2 transient
HAP/NTP realtime audio; [AirPlay](docs/AirPlay.md) records the unsupported RSA,
persistent HomeKit, buffered/PTP/multiroom paths and BLE/AWDL boundary. Audio-only
SETUP must not borrow the CarPlay display. Three-choice browser consent remembers
presented keys or stable sender-reported IDs; all senders see the same controls.
Published beta.23/code65 and browser v95 integrate that work with the beta.22 base;
URL playback retains AVPlayer's clocks and resource ownership. The earlier local
URL frame-witness adapter is superseded by that engine. Publication and public-byte
checks are recorded in [Build](docs/Build.md#beta23-release); physical iPhone/vehicle
interoperability remains pending.
Pure-audio now-playing uses the Video.js control shell with authenticated sender
metadata/artwork; it is retired while CarPlay is connected or owns the picture.
Its pause/resume acts on the receiver's live output, not the iPhone app. Previous/next
and ±10-second actions use the current sender's discovered DACP endpoint; progress
remains sender-authoritative and pending operations disable those four controls. There is
no independent floating casting-stop button. Screenshot fixtures are synthetic.

## Checks

The browser retains v90's bounded per-stream audio dispatch,
direct decoder-Worker-to-Worklet PCM ports, and original-codec RTP video consumed
by MediaStreamTrackProcessor directly into Canvas. No video element or second
video encoding is allowed. Live video has no DataChannel/WebCodecs fallback.
Source changes use video-only authenticated renegotiation and generation/ready
barriers; unsupported codec/profile, reordering and processor failure report a
video-only error. Touch-specific catch-up is disabled. The user also requires
original encoded audio over standard WebRTC whenever the source codec is
negotiated; no Android audio decode/reencode is allowed. The independent native
audio peer uses libdatachannel's official packetizers, not private libWebRTC ABI
hooks. Unsupported source formats retain DataChannel/libav/PCM-NetEq output.
Old Opus/PCMA/PCMU application decoder shortcuts may be removed. Keep supported
RTP tracks and fallback streams under the same browser mixing/ducking policy. See
[the media transport contract](docs/CarPlay-DataChannel.md) and
[audio thread boundaries](docs/Audio-tempo.md). Beta.21/code63 release progress is recorded in [Build](docs/Build.md#beta21-release). Targeted native JNI/RTP checks pass; browser RTP interoperability and vehicle acceptance remain unverified.
The v90 rollout explicitly skipped the full Android test suite. The current
beta.23 audit requires the source checks below, separate from device acceptance.

URL casting uses libmedia AVPlayer, which owns resource loading,
buffering, decoding, playback clocks, synchronization and Canvas rendering.
Keep only thin AirPlay session/proxy/authentication and controls adapters. Do not
retain the superseded custom URL player, serial request scheduler, decoded queues,
SoundTouch wrapper or their implementation-specific tests. Canvas is mandatory:
disable MSE/video-element paths and use local pinned runtime resources without
CDN requests. Verify the production CSP and operation without SharedArrayBuffer;
browser tests do not certify physical Tesla playback or subtitle-format parity.

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

Beta.21/code63 and browser v90 are published from `c2d51accf8e896975a7490891c18b79a23c5d35f`; [Build](docs/Build.md#beta21-release) records public hashes, signed/Pages runs and independent checks. No physical vehicle acceptance is implied.

Beta.22/code64 is published from `544127d3f4c5e342425613645f7bb89e09656aeb`.
[Build](docs/Build.md#beta22-release) records signed workflow 40303963168,
Pages 40303064954, downloaded attachment hashes and independent verification.
For that historical release, only the signing/publication workflow was authorized;
Android CI and the full suite stayed skipped. It retained browser v90. iPhone/vehicle acceptance
remains pending.

Resume beta.23/code65 and browser v95 at [AirPlay](docs/AirPlay.md#carplay-video-in-car-in-the-browser),
[current verification](docs/Testing.md#current-release-source) and [beta.23 release](docs/Build.md#beta23-release).
The user authorized a complete Video in Car/AirPlay review, owner-scoped display
borrow/return fixes, tie-up, signed beta APK publication and Pages deployment.
The release is published from `8191b9fcc45497d194f38f05174a8993be04c625`:
568 browser tests, 4,321 local Android tests, full CI 40340438194 (including WASM),
signed workflow 40340444194, independent public-asset checks and Pages 40344544258
all pass. All 216 public files match v95. Preserve the audio/trust/BLE/DACP and
owner-scoped return/retirement contracts; physical iPhone/vehicle retesting is next.

Resume browser v96's CarPlay startup repair at [Build](docs/Build.md#current-browser-deployment)
and [the transport contract](docs/CarPlay-DataChannel.md). The user's beta.23/v95
capture proves High4.2 source versus High3.1 SDP rejection, with active iPhone
video reception. Keep Android's strict codec admission and original compressed
frames. The bounded receive-level helper probes existing H264 mode-1 profiles,
changes only a profile confirmed by the browser API up to level 4.2 before authenticated signaling,
and retains the original offer when probing fails. The page also retains one
early decoded frame and exposes safe video errors. 598 web tests and the complete
required Android command pass; actual Chromium accepts the production helper's
local SDP, but managed zero-candidate ICE still blocks RTP/vehicle acceptance.
This web-only repair is published from `7a6129434fc138f9d2ac36b1f446bc1191cbf0a7`
by Pages 40353155061; all 217 public files (31,811,644 bytes) match. Beta.23/code65
signed artifacts stay unchanged. The next step is a fresh Tesla CarPlay reconnect
with page v96 and, if it still fails, the new video error code and capture.
