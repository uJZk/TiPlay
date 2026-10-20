# Changelog

Release availability and APKs: [TiPlay releases](https://github.com/uJZk/TiPlay/releases).
Current behavior is described in the [documentation](docs/README.md); older implementation
and delivery records remain in Git history.

## 0.2.20-beta.7

Version code 49 and browser cache/diagnostic revision v73. Signed artifacts and
deployment verification are recorded in [Build](docs/Build.md#beta-release).

- Point every language's download entry to the GitHub Releases index without a version-specific URL.
- Prevent URL casting from waiting indefinitely for an unreachable prebuffer target under bounded decoded-sample resources. Account for retained pictures and the next sample, and allow progress from actual playable coverage after the normal wait without claiming knowledge of the hardware decoder pool.
- Make the existing Play control resume an unactivated casting AudioContext and report actual buffering instead of play intent. Preserve pictures through known presentation gaps, bounded silence through delayed audio starts, and cancellation of pending playback commands.
- Record casting codec/configuration hints, queue ownership and successful closes, audio resume state, resource progress and failure context before and after cleanup. Preserve Standard errors and cleanup evidence across sampling limits.
- Add live CarPlay/mirror policy snapshots for effective targets, readiness, capacity, short-touch transition counts and clock freshness. Separate recent clock observations from the selected anchor; retain capacity and clock-state changes in Standard without per-frame or per-move logging.
- Distinguish upstream headers from completed transfer writes, short EOF, retired owners, read/write/close failures and bounded refusal reasons. Preserve legitimate AV1/VP9 codec diagnostics while redacting private addresses and credentials.

Verification: 528 browser tests and 121 distinct scoped native tests across targeted
rounds, including the final 31-test run and mobile debug build. Captured Minibili
and ordinary MP4/HLS browser replay passed before the final diagnostic-only changes.
Full Android CI remains skipped at the user's request. Field evidence does not
establish a unique Minibili cause, actual hardware pool size or optimal live-profile
thresholds; physical acceptance remains pending.

## 0.2.20-beta.6

Published as a prerelease: version code 48 and browser cache/diagnostic revision v72.
This release integrates the remote 0.2.21 WebRTC experiments into the formal root
page; the signed APK, matching source, checksums and root deployment are verified.

- Publish the formal browser at `https://ujzk.github.io/TiPlay/`, replacing the former HTTP client. Remove the independent `/webrtc/` site without an alias or redirect; point download pages to the explicitly labeled beta.6 release instead of the unavailable 0.2.16 asset.
- Retain four-digit SRP-6a mutual proofs and session-key binding of the complete offer/answer SDP. Pairing codes never travel through HTTP signaling; media and controls start only on the authenticated encrypted channel.
- Make reliable, ordered WebRTC DataChannels the formal CarPlay/live AirPlay media path. Reuse compressed video and audio records, bounded fragmentation/credit, session ownership and independent audio subscription generations. Never reencode video. The current page requires WebRTC; legacy HTTP media endpoints return 410 and cached older pages must update.
- Apply shared policies for CarPlay touch, ordinary CarPlay, AirPlay mirror and URL casting. Smoothly catch up decoded video during touch without changing audio, retain independent live +300 ms software deadlines, and favor casting continuity with bounded startup/recovery prebuffering.
- Preserve complete compressed decoder dependencies under congestion with bounded admission and explicit stall recovery. Request hardware for live video without intentional software downgrade; actual vehicle hardware use remains unverified.
- Keep dependency decoding during sender-protocol AirPlay mirroring suspend while suppressing decoded output. This is separate from internal screen arbitration and introduces no user pause button. Fix audio-drain failure cleanup and prevent retired URL operations from controlling a newer playback owner.
- Enforce the audio deadline against actual emitted sample position and known clock/device/filter uncertainty. Suppress an expired output quantum with an explicit recovery reason; missing measurement anchors stay unknown.
- Preserve actionable bounded ICE, channel, credit, decoder, audio and capture failure evidence. Keep the original video payload once, repair duplicate capture writers, report capture integrity failures and retain safe exception causes without private network details.

Integrated local verification: 237 scoped Android regressions, 473 browser tests,
90 full-page checks, 17 real-DataChannel checks, seven SRP security cases and
24 JVM compatibility checks; all three required lint/debug builds (0 Error/Fatal,
38 warnings); media-clock and AirPlay photo/audio/MP4/HLS E2E.
Full-page playback uses an explicit test-only software override; strict desktop
hardware-unavailable behavior is checked separately. Full Android CI was skipped at the user’s explicit request. Signed release lint/build,
APK signature/runtime/source/checksums and all 130 deployed paths passed independent
verification. See [Build](docs/Build.md#beta-release) for the exact commit, hashes and
Actions evidence.

Physical phone/vehicle acceptance remains incomplete. The +300 ms checks describe
known software mappings, with upstream iPhone NTP uncertainty still uncarried;
they do not prove acoustic/panel latency. SRP authenticates the signaling transcript,
while the four-digit secret still requires online-guess limits. HTTP resource bearer
access retains local-network confidentiality limits.

## 0.2.21-beta.3 (remote experimental history)

- Add independently bounded Debug video snapshots, scoped source/read/decode/draw counters, interval baselines and source PTS/arrival cadence diagnostics. Preserve source-compressed input and one-copy capture references.
- Record desktop host-to-host UDP evidence. A 200 ms oldest-record guard caused RTC retirement and about 6.6 seconds until replacement forwarding; 40 source frames never reached a reader. A separate user-confirmed 7.75-second source-frame gap remains a device investigation item.

Historical verification: 2,203 shared, 1,748 common and six home unit tests; 450 browser tests; eight isolated-site checks; nine release-draft checks; required lint/debug builds. These results belong to the remote v71 experiment, not the integrated beta.6 build.

## 0.2.21-beta.2 (remote experimental history)

- Retain the user-confirmed real CarPlay HEVC → WebCodecs Worker → Canvas playback on v70 with kernel-interface host ICE enumeration. The short capture reported no reader sequence gap, decoder error or RTC reconnect; hardware use, gear transitions and physical latency were not established.

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
