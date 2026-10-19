# Changelog

Release availability and APKs: [TiPlay releases](https://github.com/uJZk/TiPlay/releases).
Current behavior is described in the [documentation](docs/README.md); older implementation
and delivery records remain in Git history.

## 0.2.21-beta.1

- Carry source-compressed video, audio and immediate controls over reliable ordered WebRTC DataChannels with bounded fragmentation, receiver credit and explicit overload recovery.
- Preserve four-digit manual pairing for Tesla browsers without clipboard support. SRP-6a mutual proofs and a session-key SDP binding authenticate the DTLS peer; the code is not sent through HTTP signaling.
- Apply independent CarPlay +300 ms sender-relative video/audio policies where timing is available. Touch smoothly catches up decoded video without changing the audio timeline; source-timed guidance preserves its start with bounded startup reserve.
- Keep one original video capture with downstream byte-range references, and expose integrity boundaries after storage failures.
- Deliver an isolated `webrtc/` beta webpage alongside the existing root client. Native WebRTC includes four Android ABIs and bundled binary license notices.

Validation and remaining vehicle acceptance are recorded in [Build](docs/Build.md) and [Testing](docs/Testing.md). This beta does not establish physical latency or actual hardware decoder use from software events.

## 0.2.20-beta.5

- Keep live audio resamplers intact when only the output-device clock measurement is refitted. Preserve recovery for actual context suspension and missing render quanta.
- Sample clocks after native output-timestamp reads. Reject bad new pairs while allowing a recent validated anchor to bridge brief measurement noise, with explicit growing uncertainty and the existing age, extrapolation and A/V limits.
- Preserve decoded sample timestamps for mirror audio so presentation-clock refinements do not create artificial PCM gaps; retain real missing-sample boundaries.
- Retry transient AirPlay resource 502/504 responses once, as with 503, within the original request deadline and cancellation scope.
- Preserve complete audio clock fields in bounded metadata lines, including native sampling duration and held-anchor age. Original video capture remains input-only.

Verification: 399 browser tests; 2,135 shared, 1,746 common and 6 home unit tests; Android CI lint/debug builds; isolated Chromium audio, media-clock and MP4/HLS checks. Physical phone/vehicle acceptance remains pending.

## 0.2.20-beta.4

- Fit the audio device/context rate independently from Android/browser and source clocks. Apply the same conversion to resampling, playback targets and audible video references; preserve the existing CarPlay deadline and audio 45 ms early / 125 ms late limits.
- Measure real resampler filter delay in a bounded Worker, forbid cold measurement in AudioWorklet, and prepare new nodes before connecting output. Isolate concurrent installation, cold-format queues, cancellation, retired Worker callbacks and replacement connections.
- Retain separate bounded readers for interleaved AirPlay audio/video sources that ignore Range, preventing repeated prefix downloads and stalled YouTube seeking. Keep actual reads and FCUP exchanges serialized, with reader, byte, idle and cancellation bounds.
- Record independent device-rate/phase corrections in ppm, native output timestamp pairs and explicit output-reference rejection reasons. Preserve feedback age/distance across control samples, report actual per-stream render context boundaries and prevent clock offset from making fresh render reports appear stale.
- Remove AirPlay picture double-click/double-tap seeking; retain the slider and ±10-second buttons. Make the Android phone host and icon cropper honor system rotation preferences.
- Increment the shared Android/browser version to 0.2.20-beta.4 (code 43), with browser cache/diagnostic revision v63. Debug still captures original video once on input.

Verification: 2,133 shared, 1,745 common and 6 home unit tests; 387 browser tests;
required Android lint/debug builds; Chromium browser/compiled-phone, isolated
media-clock and MP4/HLS controls/recovery checks. Mouse and touch double-taps
leave playback unchanged. The merged phone manifest uses system rotation policy.

Physical audio quality, sustained vehicle playback and system rotation require
device retesting. The field log establishes effective context-rate mismatch and
output-reference rejection, but does not identify every device-side trigger.

## 0.2.20-beta.3

- Preserve nominal RTP packet adjacency during CarPlay clock-drift correction, avoiding artificial sample gaps. Start navigation, Siri, calls and alerts with independent arrival-based buffering so missing media presentation lead cannot keep short speech silent.
- Isolate concurrent CarPlay audio streams even when they share a semantic type; retain separate decoder, mixer, transport and stop/reset ownership. Exclude short speech from the media/video clock.
- Reuse one sequential AirPlay resource body when a source ignores Range, bound startup probes to 64 KiB, and rewrite complete/partial HLS playlists correctly. Preserve playback position/rate during proxy recovery without overriding a newer seek, pause or rate command.
- Keep CarPlay control/audio alive when screen data ends during a requested/granted display loan. Make output replacement and delivery atomic across sessions; reject retired callbacks and isolate teardown, feedback and auxiliary-screen EOF.
- Emit first-frame connection proof only after a successful final canvas submission and discard queued frames from superseded configurations.
- Fix settings-backup server restart races: retire the previous listener and its connections before rebinding, isolate each opening's credentials/workers and preserve interrupted-stop behavior.
- Document that Debug captures the original video once on input, without another browser-forwarding payload copy; clarify capture start times, archive sizes and evidence limits. Increment the shared Android/browser version to 0.2.20-beta.3 (code 42).

Verification: 2,133 shared, 1,744 common and 6 home unit tests; 358 browser unit tests;
required Android lint/debug builds; Chromium browser/compiled-phone, media-clock and
AirPlay MP4/HLS recovery E2E; native AirPlay JNI and libsoxr DSP/lifecycle checks;
public-source scan and 9 release-draft tests. Settings-backup regressions also passed
20,000 real-socket restarts, including 10,000 interrupted stops.

Physical iPhone/vehicle audio, long-session video smoothness and actual screen-loan
approval/return remain pending. Code regressions establish the repaired defects,
not the precise cause of every symptom in the supplied device log.

## 0.2.20-beta.2

- Explain in the Android TiPlay mode chooser that Tesla browsers may reject the default private hotspot address and that these modes provide a compatible address. Use the approved Simplified Chinese copy and equivalent translations.
- Increment the shared Android/browser version to 0.2.20-beta.2 (code 41).

Verification: 340 browser tests passed before the version bump. The remaining local Android checks were stopped at the user's request; this beta uses the existing signed Release APK workflow. Physical phone/vehicle acceptance remains pending.

## 0.2.20-beta.1

- Merge DiPlay through `1b1ac5f2` (0.2.20 and subsequent fixes) with full ancestry. Keep TiPlay branding, application identity, Android phone + browser gates, serial AirPlay resource loading, casting admission and existing audio timing fixes.
- Define the product version once in Gradle properties. Show **TiPlay 0.2.20-beta.1** at the bottom of Android Main settings and as a release link in browser settings; remove the playback corner badge. Use TiPlay version code 40 so updates remain newer than 0.2.16.
- Use the official Video.js 10 default skin and layout groups, isolate page button CSS, add left/right half-screen double-tap ±10-second seeking with accumulated feedback and accessible seek buttons, and match the casting-end button to the player.
- Schedule decoded video inside the worker without waiting for a main-thread readiness round trip. Latch the newest eligible frame at display refresh with a deadline fallback, and report frame-interval tails to reveal bursts hidden by average FPS. Preserve encoded dependencies, transfer backpressure, presentation/epoch checks, CarPlay 0 ms and mirror 200 ms caps, and audio 45 ms early / 125 ms late limits.
- Replace browser libsoxr with self-hosted pure JavaScript, retaining the variable-rate filter and clock correction. Remove the WASM binary, compiled-module transfer/byte fallback loading and WASM CSP exception; include reproducible builds, two independent reviews and DSP/performance measurements.
- Audit upstream fix reachability and overlapping TiPlay behavior. Isolate native sink initialization, automatic tethering, wheel remapping and display hooks from phone mode even with restored settings; apply upstream audio-thread scheduling to TiPlay's SCO workers. Record useful unadapted features separately in the [integration review](docs/Upstream.md#integration-review).
- Reuse the browser's pinned/patched libsoxr C engine directly through Android NDK/JNI for SCO playback and microphone resampling, with per-stream state and no JS/WASM runtime. Replace the old Kotlin FIR/linear converter. Blend PCM overflow, underrun/recovery and decoded RTP discontinuities over 5 ms within the existing output frames; retain the 160 ms PCM bound and immediate stream retirement. Add source reproducibility, native DSP/JNI/concurrency checks and signal-envelope regressions. Bound compressed speech duration and RTP span to 160 ms using codec-aware packet lengths. Carry original presentation/arrival deadlines through decoder leases and resampler lookahead, and discard stale PCM before AudioTrack submission with queued output accounted for. Preserve music backpressure and existing latency limits.

Verification: 2,116 shared, 1,740 common and 6 home unit tests; 340 browser unit tests;
all required Android lint/debug builds; hosted-browser and compiled-phone E2E,
MP4/HLS controls/gestures, real CSP AudioWorklet and worker/OffscreenCanvas timing;
public-source scan, 9 release-draft tests, native AirPlay JNI checks and the
compiled Kotlin/native libsoxr DSP, deadline and lifecycle checks. The pure JS
engine passed independent DSP/runtime reviews and a byte-identical production rebuild.

Physical iPhone/vehicle smoothness and acoustic/panel latency require device acceptance.

## 0.2.16

- Scope Debug mode to the current process, create a new capture session on each enable, show its performance hint in Main settings and offer explicit raw-history clearing after a successful ZIP save. Preserve exported artifacts when clearing.
- Export one diagnostic TXT in Standard mode; in Debug mode export a ZIP with the same timestamp naming pattern, log TXT, per-channel raw BIN/PCM streams and timestamp/sequence/offset indexes. Preserve ZIP MIME types and one immutable snapshot across storage fallbacks and sharing.
- Preserve interrupted raw records in a marked ZIP entry and repair append boundaries after process termination without discarding earlier evidence.

Verification: 1,973 shared, 1,561 common and 6 home unit tests; 229 browser tests; Android lint/debug builds; public-source scan and 9 release-draft tests. Physical phone/vehicle, sustained capture under storage pressure and OEM storage/share acceptance remain pending.

## 0.2.15

- Replace the four-step first-use wizard with a single Permission checklist and remove the duplicate permission list from Advanced settings.
- Report missing or unknown Android car Bluetooth audio connections using live A2DP/HFP evidence and the device class, excluding the selected iPhone.
- Turn Debug logging into unredacted application traffic capture for iPhone, browser, USB and Android audio output. Export channel-tagged, millisecond-timestamped records in one TXT; hide the clipboard action.
- Force AirPlay URL media through Android only while Debug mode is enabled; switch active playback routes when the policy changes and retain normal direct eligibility when disabled.

Verification: 1,971 shared, 1,556 common and 6 home unit tests; 229 browser tests; Android lint and debug builds; MP4 browser playback and live Debug route switching. Physical phone/vehicle, raw capture completeness and Bluetooth routing acceptance remain pending.

## 0.2.14

- Replace the informational first-use guide with connection, sound, startup and missing-permission setup, including current Android grant checks and system-settings links.
- Unify page, section, button and description spacing; adapt network choices for narrow windows and large text.
- Consolidate automatic hints below status and keep explicit operation results at their controls. Preserve independent blockers, distinguish unknown Wi-Fi facts and discard stale failures or asynchronous results.
- Remove the residual manual reconnect action; valid settings continue to save and apply automatically.

Verification: 1,967 shared, 1,552 common and 6 home unit tests; 229 browser tests; Android lint and debug builds. Physical phone/vehicle, system authorization and VPN acceptance remain pending.

## 0.2.14-beta.4

- Add a first-use guide on Android, with completion tracking and a Main settings entry to review it.
- Wait for an authenticated browser to report its viewport and decoder capabilities before starting or retrying an iPhone connection. Show **Waiting for browser connection** until ready.
- Select HEVC automatically from browser support, remove the manual codec switch and respect decoder canvas limits when offering Fit.
- Clear readiness on browser disconnect/replacement, expire stale heartbeats and retain already active sessions during short browser interruptions.
- Make the AirPlay resource-replacement test wait for the replacement loader to acquire its request before responding.

Source verification: 1,967 shared, 1,532 common and 6 home unit tests; 229 browser tests; Android CI lint/debug builds; public-source scan; 9 release-draft tests. Physical phone/vehicle acceptance remains pending.

## Earlier integration

- Merge DiPlay through `c30d3f0df` while retaining Android phone + car browser scope and upstream ancestry.
- Apply valid settings immediately and reconnect when needed without closing settings. Support All (USB first), Wireless and USB, with independent CarPlay opt-out and continuous recovery while enabled.
- Make Start on boot optional, subject to Android background restrictions.
- Play buffered CarPlay audio in the browser; use the car's HFP/SCO route for requested Siri/call capture, or opt out to use iPhone-to-car Bluetooth audio. Align audio feedback/presentation with negotiated clocks and recover stalled microphone reads.
- Add ordinary AirPlay mirroring, audio-only playback, original JPEG/PNG photos and unprotected URL media, with device approval in the browser.
- Use Mediabunny/WebCodecs with Video.js 10 controls for URL MP4/HLS, seeking, audio tracks, tempo and captions. Keep dependencies self-hosted.
- Borrow and return the browser display for AirPlay while retaining CarPlay and its mixed-audio contract. Enforce SDR and codec compatibility limits.
- Apply phone address/port edits without migrating the browser. Retain pairing codes and require a manual browser endpoint update.

Real iPhone/vehicle compatibility, complete Bluetooth audio routing and sustained performance acceptance remain pending.

## Published history

TiPlay began as a fork of DiPlay for Android phone + car browser use. It has its own
application ID (`com.ujzk.tiplay`) and does not take over DiPlay settings or pairing records.
See [TiPlay releases](https://github.com/uJZk/TiPlay/releases) for published version notes,
artifacts and checksums.

Inherited DiPlay release history and contributor references are available at
[upstream releases](https://github.com/shihabal3amri/DiPlay/releases). They describe the
upstream product, including native head-unit features outside TiPlay's scope.
