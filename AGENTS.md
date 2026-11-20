# TiPlay contributor instructions

TiPlay supports **Android phone + car browser only**. 本项目不考虑原生车机。
Audio output should prefer the selected car Bluetooth route and keep trying usable
output routes when that identity cannot be matched. A Bluetooth/SCO or microphone
failure must not suppress all downlink playback. Keep microphone capture independent;
this output preference does not authorize switching capture to the handset microphone.
During microphone/call demand, telephone downlink stays on Android and remains
suppressed in the browser until demand ends and the owned Android route is released.
Once an Android voice channel exists, the same ownership includes Siri and permitted
guidance; if no channel can be created, non-call speech keeps its browser path.
Preserve ordinary browser music and Siri/guidance outside that demand.
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

Published [beta.58/code100/browser v130](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.58)
from source `fec67c3530c8ba9237acf6acdb07afb7ebff1e08` adds APK-selectable AirPlay
comparison modes: A/current behavior by default, B/ordinary H.264 only,
C/ordinary BLE off, D/legacy-pairing declaration without forced pairing. Android
Advanced settings keeps them mutually exclusive. Mode changes rebuild ordinary
AirPlay with stable identity/trust and old-generation fencing; CarPlay/audio stay
independent. No early screen loan or keyframe is added.
[AirPlay](docs/AirPlay.md#mirror-startup-experiments) defines controlled trials and
cache/order limits; physical first-attempt benefits remain unverified.

Fresh shared270/29 suites and common143/19 total413 cases/48 suites with zero XML
failures/errors/skips, bound by 64/17 selected compiled classes. Two existing main
Socket-closed headers qualify the shared assertion pass, independently nonblocking;
ordinary/common have no uncaught headers. Browser62/Python27/RTC/cache/public-tree
checks pass. [Testing](docs/Testing.md#beta58-source-preparation) retains exact scope.
Full CI remains waived.

Release `452217328` was published **2026-11-20 11:24:25 (UTC+8)**. Manual signed run
`44664150597` attempt 1 passes all three jobs. Actual APK/source/attempt,
MIC24/speech33/receiver41/mode29 plus 80 localized resource values, native/notices,
original-certificate v2/API36/CRC/16KiB acceptance and independent review pass.
Three full-byte public assets and two anonymous APIs pass first request/zero
retries. Same-source Pages `44667649812` attempt 1 succeeds and all 226 site files
finally match bytes/hash/MIME, with 227 file requests: one vendor caption README
HTTP503→200 retry. All twenty routes pass first request; eight languages/21 MIME
classes pass. Combined strict first-request acceptance remains false, one retry;
the original exit1/report are retained. [Build](docs/Build.md#beta58-release) retains exact
hashes and JNI coverage; keep source/delivery acceptance separate from the A/B/C/D
vehicle comparison.

Published beta.57/code99/browser v129 remains a
[frozen historical reference](https://github.com/uJZk/TiPlay/blob/8e9791c868ea513eedf572175aefb7175f775433/docs/Build.md#beta57-release):
source `179a4953972f1138cef953a9b7f9d975f21b6884`, 233 cases/24 suites and 52 compiled
classes, qualified by four uncaught shutdown headers; release `450887195`, signed
run `44459111940` and Pages `44461225290` pass scoped delivery checks. Its physical
first-attempt failure persists despite remembered approval and retry frames.
Those beta.57 counts, runtime qualification and hashes are not beta.58 evidence.

The latest user capture `1795084719353` actually runs **beta.57/code99/browser
v129**: 2,373 continuous complete raw records over 17.807 seconds,
10:38:21.513–10:38:39.320 UTC. Connection c2 receives a 77-byte initial SETUP
reply, issues bodyless GET /info on that same connection (1,075-byte reply), then
RECORD200 and NTP7/7, but sends no type110 before client TEARDOWN after 6.290
seconds. Retry c3 follows the same fallback, then sends type110 about 11 ms after
RECORD, reaches remembered-hit and has 247 mirror frames logged. The beta.57
intervention executes and the iPhone supports fallback; it does not fix the
first-attempt symptom. An old APK/page or a still-combined initial SETUP cannot
explain this capture. Actual outgoing GET /info bodies are absent; equal logged
lengths do not establish equal content.

The same process's earlier c1 remains without type110 for 388.093 seconds with
NTP388/388, over seven minutes after the last viewport/audio inputs. Per-instance accept counters
c1→c2→c3 and lifecycle source support one continuing ReceiverServer; viewport
config copies and BLE/Bonjour refresh do not restart it. A globally unique runtime
object token is absent. This rules out a simple receiver warmup/more-wait account.
All thirteen retained ordinary accepts follow last reported CarPlay Controller
ownership. On 2026-11-20 the user reports that independent AirPlay without
CarPlay succeeds on its first attempt; no matched standalone wire capture is
available. This narrows the context without proving screen-resource causation.
The current pre-type110 control path does not gate on CarPlay screen ownership;
borrowing controls local display after the media request arrives. An absent
permission prompt is downstream of absent type110, not proof of an ownership
cause. The proposed earlier screen loan was withdrawn without a build or
release. Preserve audio/identity and require causal evidence for a new fix.

The user also reports pre-WebRTC first-attempt success with CarPlay H.265/AirPlay
H.264, without a known beta. Compare both beta.6 DataChannel and beta.21 native-RTP
boundaries. Six external control replays and four independent legacy-crypto cases
pass; they do not reproduce active-CarPlay iOS selection. UxPlay clears legacy
bit27 by default at runtime, so its header macro is not evidence to restore that
declaration. [AirPlay](docs/AirPlay.md#mirror-startup-evidence) retains the effective
capability and discovery evidence limits; no new product fix is established.

The beta.57 adjustment only omits optional nested `info` from a successful,
unpaired legacy-FairPlay initial control SETUP with valid encrypted key/IV,
no pairing of any kind, explicit mirror intent and the `streams` key absent.
Normal bodyless `GET /info` on the same transport can
fetch the full profile. UxPlay's normal ports-only response and Doubletake's
optional-info fallback support this compatibility choice; they do not prove the
iPhone's first-attempt cause. Paired legacy, AirPlay 2, encrypted NTP, audio,
other intent and every streams-present path retain combined-info behavior.
Keep the NTP/event transport, one FairPlay key decryption, typed media consent,
screen ownership and existing endpoint handoff. Do not borrow the screen early,
send an early keyframe request or change audio or identity. Baseline capabilities
remain unchanged; only the user-selected comparison modes may vary the declared
codec/pairing capabilities or ordinary BLE hint.
Required real-TCP regressions follow FairPlay → minimal control SETUP →
GET /info → RECORD → type 110, preserve the NTP port/probes and deliver an actual
encrypted frame. Fresh assertions pass, qualified by four uncaught shutdown
exception headers in two suites; independent/control review treats them as
nonblocking for this response-only patch. [Testing](docs/Testing.md#beta57-source-preparation)
retains the qualification and separate cleanup task.

Published [beta.56/code98/browser v128](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.56)
comes from `94a983186935c84c3d4c2faf2b81df01c74ee3b7`, published
**2026-11-18 19:06:09 (UTC+8)** as release `449857203`. Its
[frozen publication record](https://github.com/uJZk/TiPlay/blob/86cbff4cc6f55e33789ae6a1ac99ef5ef3587f90/docs/Build.md#beta56-release) and
[frozen verification record](https://github.com/uJZk/TiPlay/blob/86cbff4cc6f55e33789ae6a1ac99ef5ef3587f90/docs/Testing.md#beta56-source-preparation)
retain 227 JVM/Robolectric cases/24 suites, 62 browser/27 Python cases,
signed run `44289047781` attempt 1, original-certificate/artifact review and
same-source Pages `44291624092` attempt 1. All 226 site files/twenty routes pass
first request; three public assets match signed bytes. One anonymous GitHub API
503→200 retry qualifies delivery while combined strict first-request acceptance
fails (one retry; retained validator exit1). This historical hosting exception
does not predict beta.57 delivery or diagnose mirroring.

Beta.56 transfers the complete classified legacy connection to the ordinary
receiver, preserving original peer/socket, pre-read/pipelined bytes, twelve-slot
admission and exact owner lifetime. MFi/CarPlay and active audio retain their paths.
The earlier beta.55 capture had two empty-success FairPlay replies on CarPlay7000
before EOF; neither reached ordinary SETUP or consent. Its info-only bridge was
a source design defect. Beta.56 and the latest beta.57 flow reach the correct handler;
the earlier preceding BT-info/cache transition remains unobserved.

SETUP `deviceID` remains an unauthenticated convenience claim. Verified pairing
keys and existing Client-ID UUIDs retain priority; invalid explicit headers cannot
fall back, changed claims cannot inherit authorization, and body claims are cached
only after valid successful initial SETUP. Never use IP, name, interface
`macAddress` or session UUID as persistent sender identity. The conditional
permanent-allow control and working audio contracts remain intact.

The previous beta.55 release came from
`6db3fa9d2bf444ce034c15ec2ca9fd410b852352`. Its
[frozen publication record](https://github.com/uJZk/TiPlay/blob/0233d5128e6e610e9f59004152abfe3457174d5b/docs/Build.md#beta55-release) and
[verification record](https://github.com/uJZk/TiPlay/blob/0233d5128e6e610e9f59004152abfe3457174d5b/docs/Testing.md#beta55-source-preparation)
retain 184 focused JVM/Robolectric, 62 browser/27 Python passes, signed run
`44220793369`, same-source Pages `44223600106` and first-request public success.
Those checks did not establish endpoint protocol continuity; later physical feedback
and both captured FairPlay failures expose the regression. Earlier beta.54 provenance
remains in [Build](docs/Build.md#beta54-release).

The previous beta.54/code96/browser v126 came from
`dbd2b61dabd18c5daa1b6825fb283e0b4f59b5ac`. Its
[frozen publication record](https://github.com/uJZk/TiPlay/blob/9d37aada3b1229573d414a3201528a8acae893b9/docs/Build.md#beta54-release) and
[verification record](https://github.com/uJZk/TiPlay/blob/9d37aada3b1229573d414a3201528a8acae893b9/docs/Testing.md#beta54-source-preparation)
retain 186 focused JVM/Robolectric, 88 browser and 27 Python passes, signed run
`44061134348`, same-source Pages `44065088740` and strict first-request public
verification with zero retries. These are beta.54 results, not fresh beta.55 checks.

The user's current “only mirroring remains” report supports qualitative recovery
of MIC and MIC-period Siri/navigation output on this phone/car combination. It does
not certify all devices, telephone overlap, recognition fidelity, echo or sustained
acoustic behavior. Preserve the shipped output/capture contracts above, typed car
input proof, zero-read warmup/fresh recorder, Android speech-channel ownership and
browser telephone suppression. Do not restore early foreground-wait preparation
or change the working audio, codec/RTP, gain or native paths for this mirror issue.
[Robustness](docs/Robustness.md#microphone-and-call-period-output) retains the scoped
beta.53 sample/send evidence and beta.54 output correction.

The [frozen beta.52 publication record](https://github.com/uJZk/TiPlay/blob/be09f17e52840fbf41a7cc6f22a459c41dcbde89/docs/Build.md#beta52-release)
retains its earlier qualified 503→404 route history and strict first-request failure;
those observations belong to beta.52, while beta.53 passes all first requests.

The [frozen beta.51 publication record](https://github.com/uJZk/TiPlay/blob/68ba158f0b4d0dc7995b36ffaf1e6feac781e07f/docs/Build.md#beta51-release)
retains its earlier source/delivery identities. The native-audio preference still
uses the actual main selected-pair local IPv4 hint for a later generation, with
same-address-revision ANY fallback and old callback fencing. Hint changes do not
restart active audio. Three single-IPv4 field answers are consistent with binding,
without direct mode/address evidence; fallback remains unobserved. Nine retained
failure groups belong to the old beta.50 process, not beta.51 or beta.52.

The user confirms the call-audio setting exists, Android media reaches car Bluetooth
speakers, and an ordinary Bluetooth call's remote party hears the car MIC on this
phone/car pair. This establishes baseline capability, not the exact switch state,
TiPlay's SCO port or TiPlay/Siri audibility. The beta.51 capture ends during active
MIC demand, without evidence of a cleanup leak. A source-picture gap recovers and
may reflect a static screen; ordinary mirroring remains untested in that capture.
The earlier beta.51 observations do not establish current physical input identity.
`hasSession`/`isOwner`, best-effort output and browser call suppression remain
unchanged; no global voice-recognition workaround is used.

The [frozen beta.50 publication record](https://github.com/uJZk/TiPlay/blob/7b5cfb9364412317fa4bb97ee3faf5e5615e6366/docs/Build.md#beta50-release)
retains its full signed/public evidence. Its pinned IPv4LL producer
`43578453616`, adoption and earlier explicit emulator proof remain scoped in
[Robustness](docs/Robustness.md#ipv4-link-local-ice); none established the vehicle
cause or physical audio/MIC/mirror acceptance.

The [beta.49/code91/v121 reference](docs/Build.md#beta49-release) comes from
`95850493cb6bab562992862087cde87fc94b2e0e`. Signed run `43570628422`,
Pages `43571756114`, twelve artifact checks, all 51 native identities and
anonymous release/site bytes pass. The immutable Build/Testing records retain
its hashes and source checks; these do not establish later Android or vehicle
acceptance. Beta.49 preserves bounded failure evidence and fixes false
`released=true` after this app's mode-client cancellation throws. Failed cleanup
retains ownership and retries at most three times, one second apart, without
re-clearing an already withdrawn device request or losing transient-focus recovery.
Android call output prefers selected-car Bluetooth, then another usable Bluetooth
or system AudioTrack route. MIC failures do not stop playback; capture retains
its verified identity. The user explicitly requires browser telephone downlink to
remain suppressed throughout call/MIC demand, including Android output failure.
Restore it only after demand ends and owned output cleanup completes. This
supersedes old blanket selected-only output/no-speaker rules; input permission
and non-interference with another app's call remain independent requirements.
The user authorized beta publication and waived full CI; keep focused checks,
previous complete validation and artifact identity separate. Those beta.49 checks
did not establish the vehicle ICE cause, mirror picture or physical output/capture. The later MIC evidence above has its own scope.
Resource checks do not certify media decoding.
Resume audit remediation at [Robustness](docs/Robustness.md); keep its source
verification and remaining hardware evidence separate from the published release.
Beta.49 preserves browser failure generations through immediate bounded reporting,
Standard/Debug text admission and complete native split records. Its source
checks pass 164 distinct focused Android cases, 721 browser cases and 31 Python
cases, including five actual TXT/ZIP fixture roundtrips. Focused hosted
proof [43569629973](https://github.com/uJZk/TiPlay/actions/runs/43569629973) passes
normal Chromium/native Worklet output across 17 owners, a separate 220-frame
byte/timestamp-exact receive tap, and both ICE failure controls. Full CI remains waived.
UDP-blackhole and wrong-password controls produce identical native diagnostics
and browser failure observations except sample age; do not promise unique attribution or request another
field test merely to verify local logging. See the diagnostic-sufficiency section
in Robustness for the evidence boundary. Actual Chromium 151 SDP admission and
2,560 byte/timestamp-exact native C-API packets across BUNDLE/prflx controls pass;
the captured vehicle browser is Chromium 148. These are not vehicle playback proof.
Previously, beta.38/code80 with browser/cache v113 was published from
`ab629363e6af9d7ea914fd8808baf84ab5f391fb`. Build records signed packaging,
independent public bytes and 28 matching symbol pairs across the app-JNI and
WebRTC producer archives. The rebuilt four-ABI AAR comes from native producer
`aef6c97a2402f4f5ef4a821a876a11941116d180`,
[run 41382204134](https://github.com/uJZk/TiPlay/actions/runs/41382204134).
All 11 focused native cases, the fixed-AAR permanent-stop JNI probe and required
Android command pass (4,535 JUnit report cases, with unchanged modules cached).
Signed release, Pages and independent public-artifact checks pass;
[Testing](docs/Testing.md#current-release-source) separates these results from
physical acceptance.
The matched November 2 tombstone identifies a high-confidence post-stop
source-rate encoder defect; see [the evidence boundary](docs/Robustness.md#matched-post-stop-native-crash).
Earlier unmatched SIGSEGV reports and historical symbol gaps remain open.
Use [native-crash evidence](docs/Diagnostics.md#native-crash-traces) and
[wireless startup timing](docs/Diagnostics.md#reading-wireless-startup-evidence)
for the remaining physical acceptance; source checks do not establish it.
Keep source checks, published artifact
identity and vehicle evidence separate. Preserve strict source/profile/level/mode
admission, original compressed frames, bounded selection and per-instance callback
ownership. Beta.27 follows the beta.26 vehicle report and actual Android AAR
reproduction: serialize original-AU capture by input completion, set a bounded
128 Mbps video ceiling, a 16 Mbps minimum and a one-time 32 Mbps BWE startup prior
(updated at the user's request; beta.27's recorded native tests used 24 Mbps).
Keep real congestion feedback and overload guards; never reset the estimate on
each IDR/source replacement. Completion follows the encoder callback or published
input-loss state, not final buffer release. Wait outside native/send locks; old
wait cancellation must not fail a replacement or block audio/control. See the
[native replay](tests/native/README.md); its counting decoder does not establish
picture correctness, vehicle throughput or physical continuity. Native-audio
activation remains as verified in beta.25; validation scope is recorded in Build.
Beta.29 retries key-frame recovery from the existing idle poll while the bridge
is active and waiting. Keep the Hub's 500 ms limiter and both six-second startup
deadlines. Sparse High-profile startup must recover from a lost initial IDR after
the source becomes static; do not depend on more source frames to trigger retry.
The actual AAR before/after probe must retain High SDP/profile admission, not
manually relabel or force an incompatible encoder.
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
Before adding the first video transceiver, set an unpublished data-only local
offer, then update that pending offer with video before authentication/signaling.
The application m-line must own BUNDLE's permanent DTLS/SCTP transport. Stop every
retired video track/transceiver; an inactive video transport anchor can starve
packet feedback after replacement and collapse BWE to 30 kbps. Keep TWCC, REMB,
real congestion guards and the one-time 32 Mbps prior. Do not reorder generated
SDP or signal the intermediate offer. See [desktop RTP integration](docs/Testing.md#desktop-rtp-integration).

When the browser owns a negotiated audio stream, forward original encoded audio
over standard WebRTC without Android decode/reencode. The independent audio peer uses libdatachannel's
official packetizers, not private libWebRTC ABI hooks. Unsupported formats retain the
DataChannel/libav/PCM-NetEq path. Keep RTP and fallback under the same mixing/ducking
policy, bounded per-stream dispatch and direct decoder-Worker-to-Worklet PCM ports.
Negotiated Opus uses native RTP. Libav.js Workers normalize supported fallback
formats to PCM16/48 kHz for PCM-NetEq. Keep live audio and video independent.
The native audio peer owns one detached, permanently muted, zero-volume audio
playout anchor to activate Chromium's receiver. Wait for fulfilled `play()` and
the exact Worklet binding before announcing slot readiness; retire the anchor
with its peer. All audible browser sound stays in the common Worklet mixing/ducking graph.
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

Minimize changes to third-party source and reuse maintained upstream build
configuration, scripts and Actions. For WebRTC, preserve the current source-rate
video behavior while reducing local build patches; follow
[WebRTC build maintenance](docs/Upstream.md#webrtc-build-maintenance). Require a
concrete product need for each remaining native patch and prefer existing APIs.

Follow [docs/Upstream.md](docs/Upstream.md) for preserved identifiers, dependency
provenance and the one-way merge procedure. Current project links use TiPlay;
numbered upstream references and historical names keep their original destinations.
