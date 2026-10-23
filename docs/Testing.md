# Testing TiPlay

TiPlay supports an Android phone plus car browser. Follow [installation](Install.md) and [build](Build.md) instructions; use a parked car for physical acceptance.

## Automated checks

The [Android workflow](../.github/workflows/android.yml) defines required tool versions and commands: browser unit tests, public-source credential checks, release-draft tests, Android unit tests, lint and debug builds. Its retained upstream sample checks do not establish a second supported product.
`gradle/tiplay-product-tests.gradle.kts` excludes legacy native Home/Vehicle/permission
screens and finite-retry stop UI. Upstream fixtures remain available for merging;
TiPlay's phone checklist, browser host, continuous recovery, shared permission logic
and channel persistence tests still run. The isolated native Wi-Fi scan switch
fixture calls a channel-only builder that does not own that switch; shared channel
cases are retained.

For browser/media changes, use the applicable [Chromium harness](../tests/web-e2e/README.md): real DataChannel fragmentation/credit/control, browser link and recovery, shared-server compatibility wiring, URL MP4/HLS playback, still photos under production CSP, or ordinary AirPlay audio. `webrtc.mjs` uses two real PeerConnections and verifies byte-exact large records, application consumption credit, independent audio, control, epoch rejection, cancellation and signaling deadlines. A managed browser that disables non-proxied UDP cannot exercise host ICE; use a dedicated test browser without changing the machine policy. Native AirPlay changes also require `python3 scripts/test_airplay_native.py`. Rebuild generated site outputs with [the Pages workflow](../.github/workflows/pages.yml) when their inputs change.

Desktop simulations and codec probes cannot establish Tesla firmware support, iPhone interoperability, autoplay behavior, vehicle sound or sustained performance. Record which checks ran and which physical checks remain.

### Native SCO resampling and continuity

`python3 scripts/soxr/prepare-native.py --check` reproduces Android's C sources
from the browser archive/patch. After the shared debug build,
`python3 scripts/test_soxr_native.py` compiles host JNI and exercises the actual
Kotlin adapter: six sample-rate pairs, exact split/whole-packet output parity,
temporary shortage without EOF, impulse content offsets, alias rejection,
native-mixer overflow/recovery, independent concurrent handles and retirement.
`BluetoothVoiceMixerTest` isolates the 5 ms envelope with an identity test backend;
the former Kotlin converter's duration/alias checks now cover the real native engine
in the host check rather than the removed converter. Decoder regressions check RTP
wrap, distinct RTP/PCM rates and true timestamp gaps. Native assembly targets every
configured Android ABI; host DSP tests do not establish SCO speaker latency or
acoustic click-free behavior on the vehicle.

`SpeechAudioQueueTest` covers mixed Opus durations/frame counts, AAC's 1024-frame
units, short bursts beyond 24 packets, PCM tail clipping, timestamp gaps/wrap,
original arrival age, absolute presentation deadlines and retired decoder leases.
The sink tests hold a real shadow MediaCodec inside decoding, advance the clock
and verify old output is discarded before fresh speech resumes. Mixer tests cover
playback stalls, AudioTrack queue lead, resampler lookahead and per-stream expiry
without muting other streams. The software queue/span stays at 160 ms; anchored
first-sample deadlines retain the browser's 125 ms late allowance, with 160 ms
arrival-based fallback before an anchor exists. In-place recovery may emit a
5 ms decay of the last audible sample. Physical SCO/device latency and long
session clock drift still require [device acceptance](Todo.md#browser-and-carplay-audio).

## WebRTC integrated acceptance

Run browser unit tests, shared Android pairing/transport tests and the applicable
real-PeerConnection harness after integrating changes. SRP vectors come from actual
Bouncy Castle 1.79 and cover public values, mutual proofs and HMAC binding. Reject
wrong code, replay/expired challenges, changed SDP/server proofs and retired owners.
Protocol checks cover TDR1 fragmentation, record credit, independent audio
subscription barriers, control limits, cancellation, decoder admission and
explicit overload/stall recovery. No HTTP media/control fallback may bypass SRP.

The beta.7/v73 source passed 528 browser tests and 121 distinct scoped native
regressions across targeted rounds, including the final 31-test run and mobile
debug build. Captured Minibili and ordinary MP4/HLS browser replay passed before
the final diagnostic-only changes. Live policy and clock evidence is described
in [Diagnostics](Diagnostics.md#live-video-policy-evidence); these tests do not
establish optimal vehicle thresholds or a unique field failure cause. Full Android
CI remains skipped at the user's request; signed build and deployment evidence
is tracked in [Build](Build.md#beta-release).

The beta.8/v74 control/audio correction passed all 561 browser tests on
Node 22.23.3, 52 scoped Android tests across seven actual classes, and the mobile
debug build. Native queue regressions hold an application RPC while 300 ordinary
ACKs drain, preserve canonical capture ordering and verify authentication,
audio-lease FIFO, malformed credit, owner retirement and bounded overload evidence.
Real Chromium DataChannel integration passed 17 checks, and ordinary 44.1 kHz AAC
MP4/HLS replay passed using the actual media engine, controls and diagnostics.
The complete page passed 90 checks with the explicit software-only test override,
including all four worker/main paths, touch, reconnection and v74 offline cache.
Four default-policy checks separately confirmed an explicit unsupported state on
the desktop hardware-unavailable path. Neither result establishes actual vehicle
hardware decoding.

The independent URL signal oracle exercises production packet trimming and partial
scheduling with continuous tone/sample-identity inputs. It reproduced all eight
original failures and checks genuine single-sample gaps/overlaps, fractional seek,
format changes, pause/resume and tempo output. The native
[`url-audio-signal.mjs`](../tests/web-e2e/url-audio-signal.mjs) harness compares the
production AudioBufferSource graph with a whole-buffer reference in four rate
combinations. On Chromium 151.0.7922.34, the final 44.1 kHz graph followed by one
continuous 48 kHz device-equivalent conversion had no zero frames, maximum step
residual 1.49e-8 and relative error -169.54 dB over the measured 1.7-second window.
Both constructor-requested and actual graph rates were observed. This offline
conversion checks signal continuity; it does not measure the physical device
driver, speaker output or vehicle latency. Full Android CI remains skipped.

The current URL scheduler also has deterministic tests for a callback arriving after
the submitted audio tail, a task around native `start()`, both source rates and a
finite video-surface pool. They verify source identity, absence of overlapping
submissions, a consistent media clock and bounded recovery rather than accepting a
full resume watermark after every late callback. The Chromium signal harness now
also captures a real AudioContext through an independent AudioWorklet while the
main thread deliberately stalls. Both 44.1/48 kHz runs retained sample order with
no signal errors, and rendered silence agreed with the bounded scheduling evidence.
This capture is before the OS/device output stage and does not prove speaker output.
The earlier user clarification assigned those steady-playback clicks to CarPlay. URL
signal checks and healthy YouTube windows cannot exclude faults in that independent
live-audio path. The later beta.9 report also includes mirror clicks and a higher
CarPlay click frequency during touch; both require physical retesting.

The published beta.9 source passed 604 browser tests, 82 scoped Android tests in
seven classes and the mobile debug build. The Android cases cover resource-route
reuse/revocation, redirects and partial manifests, bounded startup/continuity
diagnostics, device-fit/source-anchor evidence and the audio/video diagnostic
allowlists. The full Android CI remains skipped. Mirror worklet regressions
preserve sample progress when the first valid source anchor follows untimed PCM,
reject expired output, retain unknown origins and isolate the concurrent CarPlay
stream. CarPlay recovery tests retain the pre-recovery phase/rate/uncertainty and
context-clock age without changing real Soxr samples or recovery decisions.
Video tests retain actual snapshot age, maximum read interval and oldest outstanding
decode age, reject old stream/epoch snapshots and preserve bounded diagnostic budgets.

The native [`airplay-short-audio.mjs`](../tests/web-e2e/airplay-short-audio.mjs)
oracle passed ten Chromium cases across 44.1/48 kHz, comparing every rendered sample
with a native whole-buffer source limited to the same metadata duration. One-sample,
fractional-sample and large decoder-padding cases had zero difference, resolved
play before ended and emitted ended once. Audio EOF now waits for the effective
submitted tail on the audio clock, independently of the video tolerance. Unit
regressions also cover final-sample seeks, suspended clocks and mixed audio/video
tails. These signal claims are at 1x; tempo conversion retains its existing rounded
output-sample count and is not lossless at every playback rate.
The URL signal, MP4/HLS controls and shared media-clock harnesses were rerun on
this source. The complete v75 page also passed 90 checks with the explicit desktop
software decoder override, covering all four main/Worker paths, reconnection,
takeover and offline cache. The shared clock run recorded no runtime source changes;
its default hardware probes remained explicitly unavailable on this desktop browser.
These checks do not establish the vehicle decoder implementation or physical output.

Parameter verification covers actual formulas, reachable watermarks, memory-accounting
domains and field samples; [the parameter table](WebRTC-roadmap.md#参数核验与调优边界)
distinguishes proved software bounds from defaults still needing vehicle calibration.
Use a source cadence with continuous motion when measuring stutter: static picture
updates can have long PTS intervals without dropped frames. Compare target and actual
cursor delay during convergence, and retain unknown source/output timing instead of
calling every missing anchor a passed latency measurement.

The beta.11/v77 playback source passed **688 browser tests**, **116 scoped Android
tests across 10 classes**, and the mobile debug build. It adds an independent
hardware-clock/real-Soxr oracle: repeated 10 ms output-pipeline changes no longer
discard a coherent applied device rate, while a real 38 ms change still recovers.
The fixture covers an actual oscillator change, source progress, nonzero PCM and
the unchanged 30/300 ms recovery/deadline policy. An idle stream emits no samples
and cannot fabricate a deadline-recovery count; actual tails and zero-valued source
PCM still receive deadline checks.

Parameter cases cover exact MAD 3/0.5/1.5 ms, one-second source buckets/fastest arrival,
inclusive source/device 10/2-second pairs, 125 ms plan-history continuity and
64/128/256-frame render blocks. A 10,000-update same-clock burst remains cloneable
and bounded after superseded activations are removed. Three parallel real JVM socket
fixtures expired at approximately 10 seconds in response-header, initial-body and
returned-body reads, retaining production limits and FCUP behavior. These do not
validate Android's network stack or the 5-second connect expiry.
An additional real-Soxr case reproduces non-finite output beyond the old 512-frame
mixing buffer, then verifies 1024-frame expansion, smaller-block reuse, nonzero output
in both halves and identical PCM with Debug toggled. No per-quantum allocation is
added when the existing buffer is sufficient.

Real Chromium checks passed shared CarPlay/mirror clocks, MP4/HLS playback and 90
complete-page checks with the explicit software decoder override. The initial URL
probe is held by the fixture: the accessible loading indicator must already be
visible before headers or player import, and retire on actual playing. Stop,
replacement, paused/gesture handoff and permission revocation also have regressions.

Screen-loan regressions reproduce reentrant borrow/return write failures and the
old host's failure to recover a returned resource without a primary data stream.
The latter fails before the fix with `WantedButNotInvoked`. Recovery now waits the
existing two-second interval, rechecks the same owner/session and preserves timely
or in-flight SETUP. Tests cover 1999/2000 ms, settings spanning the wait, new loans,
browser loss/re-authentication,
atomic retirement and first-frame viewport reconciliation. Control/audio continuity,
keyframe requests, stale owners and mirror isolation retain their earlier checks.
The beta.12 field capture confirms a mirror loan retaining control, ownership return
without old-session SETUP, fallback after 2.007 seconds and actual browser draw after
5.119 seconds. Both URL loans are confirmed before peer TEARDOWN/control EOF after
322/131 ms; subsequent CarPlay drawing uses new sessions. This proves one recovery
path, not seamless return or iPhone internal intent. Broader picture/sound acceptance
remains in Todo; published sources remain those in [Build](Build.md#beta-release).

The beta.12/v78 source passed **737 browser tests**, **172 scoped Android tests
in 12 classes**, and the mobile debug build, including capture lock-wait/failed-append timing, retained deadline
evidence, playback-generation rejection and fixed diagnostic schemas. Browser cases
add exact 20/10/40 ms timestamp, 8/30 ms recovery and URL watermarks/lookahead/submission
boundaries; 17 deliberate parameter/comparison mutations are caught. These checks
prove software boundaries, not optimal vehicle settings. Source-deadline evidence is
Debug-only, and stale-generation reports cannot repopulate cleared metrics.

Live and URL diagnostics share the optional `AudioContext.playbackStats` reader.
Tests cover unavailable/throwing/invalid getters, real zeroes, seconds-to-milliseconds,
safe bounds and no reset or Debug-off live reads. Its four scalar fields preserve the
16/64 KiB live budgets; the worst URL control envelope is 4009 bytes within the
existing 4096-byte reservation, with every native group at most 600 characters.
The production-CSP shared-clock harness verifies the actual live graph's renderer
state/counters, nonzero PCM and independent CarPlay/mirror references, with all 61
runtime source hashes unchanged. Chromium 151 exposes the API without experimental flags. Slow or visibility-
gated updates and unavailable counters remain unknown; this is not speaker capture.
Full Android CI remains skipped at the user's request. The beta.12/code54/v78
metadata preflight additionally passed 9 draft, 2 root-site, 23 browser diagnostic
and 34 native diagnostic cases; functional source hashes match the preceding runs
after normalizing version fields. Signed artifacts and publication remain recorded
separately in [Build](Build.md#beta-release).

The subsequent beta.12/v78 read-only field review binds sid2, 255.671 seconds and
63,290 records; its 208 ZIP entries pass CRC/path/length and sequence/offset checks.
The 0.914-second beta.11 residue and historical TXT are excluded. Reference decoding
of 6,088 packets / 5,401,600 frames reports no decode/non-finite/over-full-scale errors.
Live renderer growth is confined to the early window; mirror samples remain continuous
despite 260/265 ms incoming/send-attempt gaps. The user's 4K attempt was not continuous
playback; its 26 scheduled-audio gaps totalling 3.055517 seconds cannot establish
steady-click cause. Two 360p windows have zero recorded scheduling/renderer faults,
not acoustic proof. These observations add no new feature-test or physical pass claim.

Pre-budget-change read-only oracles use the beta.12 URL engine and 96 MiB
budget: one 180 ms main-thread pause produces a 115.420 ms gap at 4K, zero at 360p;
continuous 30-fps PTS supplied at about ten decoded frames/second produces 42 gaps
in 12 seconds, with no skipped/repeated submitted source samples and no audio clock
beyond actual decoded video coverage. This measures scheduling behavior, not actual
codec throughput or sound. An audio-master alternative was not adopted because slow
video could fall unboundedly behind. A 30-second bounded-separation/last-presented-PTS
regression remains a design requirement, not an executed pass. These are historical
96 MiB baselines, not verification of the requested current 256 MiB URL budget.
The isolated 256 MiB change passed all 737 browser tests and the real Chromium MP4/HLS
Video.js harness. After refining the existing 4K fixture to 30 fps so it still
exercises `video-budget` startup, all 106 targeted cases passed again; production
source was unchanged after the full run. The replacement-surface rejection now
uses an 8192×8192 sample to preserve the same admission failure boundary. CarPlay/mirror 64 MiB,
32 queued URL frames, URL DSP, watermarks, 500 ms audio scheduling and synchronization
remain unchanged; subsequent live-audio fixes are described below. The reference-based CarPlay
changes are deferred, and full Android CI was not rerun for this capture review.

The published beta.10/v76 source passed 643 browser tests, 158 scoped Android tests in 13 classes
and the mobile debug build. Native cases additionally cover fixed source-fit/quantum
fields, six-place MAD printing, one-time 400 ms SETRATE anchors, HTTP failure phases
and FCUP deadline ownership/logger isolation. Source/quantum Debug collection and
diagnostic observation preserve real Soxr PCM and recovery decisions. Full Android CI
remains skipped at the user's request. The final v76 release source passed 90
complete-page checks with the explicit desktop software decoder override and real
AAC/ELD, shared media-clock and MP4/HLS harnesses. Shared-clock source hashes remained
unchanged throughout the run; hardware paths were explicitly unavailable on this desktop.
The follow-up preserves exact AAC signal continuity across 19 mirror
NoData units in real Chromium: native AAC-LC and Worker software ELD both resume with
zero PCM difference from their uninterrupted baseline. Source timestamps cover the
inserted samples continuously; callback timestamps may compact gaps or clamp a
negative initial timestamp and are not substituted for RTP sample coordinates.
The production worklet/Soxr regression also compares a single contradictory output
pair with a stable control: both live modes avoid false recovery and retain their
resampler. Real two-pair pipeline changes still recover. Diagnostic-only observation
retains byte-identical output; temporarily unknown mapping can retain a minute
existing phase correction, tested against half an input PCM16 quantization step.

Boundary probes additionally exercise default NoData 2000 ms timeout without extending
it on new markers, source-span capacity, URL watermarks at 0.25/1/4x, 500 ms submitted
audio, 2/3-second read admission, frame/byte limits, manifest/inline 2 MiB and browser
15-second expiry. They distinguish fixed unit deadlines from progress watchdogs and
retain one-sample 1x clips. Clock regressions cover exact valid oscillator endpoints,
genuinely wider drift, expired references, historical/repeated pairs and reacquisition
after opposite extreme device rates. None of these software limits establishes optimal
vehicle tuning, driver/GPU memory consumption or acoustic continuity.

The historical beta.6 integrated source passed 237 scoped Android regressions, 473 browser tests,
90 full-page checks, 17 real-PeerConnection checks, seven SRP security cases with
Bouncy Castle vectors and 24 JVM compatibility checks. Media-clock and AirPlay
photo/audio/MP4/HLS E2E passed. Full-page Chromium playback used an explicit
software-only test override, with strict desktop hardware-unavailable rejection
checked separately. The full Android CI run is skipped at the user’s explicit request. Signed hashes,
root deployment and publication are tracked in [Build](Build.md#beta-release).

Remote 0.2.21-beta.3/v71 historically passed 2,203 shared, 1,748 common and six home
unit tests, 450 browser tests, eight isolated-site checks and nine release-draft
checks. Those counts belong to the old experimental source and do not validate
the current beta. The former isolated-site assembler is no longer the production deployment:
`https://ujzk.github.io/TiPlay/` is replaced directly, the independent `/webrtc/`
site is removed without alias/redirect. All language download pages link to the
GitHub Releases index without a version-specific URL;
the historical 0.2.16 release/download URL is no longer available.

Preserve remote diagnostic coverage when running the integrated suite: bounded
independent video snapshots, capture-session/stream/epoch interval baselines,
legacy 233-field and current 258-field-allowlist production-shaped fixture validation
(the current wire payload remains limited to 256 fields), anonymous ICE/native metrics,
missing/budget-omitted fields, held journal-lock races and complete-frame source
PTS/arrival windows. Source cadence excludes configuration/keepalive records and
retains missing, repeated, backward and cross-window PTS/arrival gaps. These tests
observe source pauses and consumer progress; they do not prove network loss or
remove the need to reproduce the historical source-frame stalls.

Use the current [browser harness instructions](../tests/web-e2e/README.md) for real
SRP/ICE/DTLS/SCTP. A browser that cannot enumerate usable host ICE candidates is a
blocked environment result, not a simulated success. Full-page software overrides
must never be reported as hardware-decode evidence. URL/photo/audio harnesses
remain applicable because resource playback is retained.

On the intended vehicle, manually enter the official root URL, Android address and
four-digit code. Check wrong-code lockout, new code, same-page reconnect, replacement
owners, disable/disconnect, cached/offline reopen and local-network denial. Exercise
large access units, retransmission, shared Wi-Fi/hotspot/VPN, Shizuku aliases,
suspend/resume, sustained heat and storage pressure. Use source/read/decode/draw and
native queue/credit evidence to distinguish source supply from transport retirement
or decoded refresh replacement. Reproduce the old beta.3 200ms-guard/reconnect and
7.75-second source-gap scenarios rather than claiming them fixed from counts alone.

Confirm actual vehicle hardware decoding and source-relative panel/acoustic output
with uncertainty. Repeat touch without resetting audio; test source-anchor loss,
independent speech/media epochs and verified HFP startup/loss/restoration. The live
+300ms enforcement includes known software clock/output/filter uncertainty, while
upstream iPhone NTP uncertainty is not separately transmitted. Missing anchors stay
unknown and `within-bound` is not a physical latency certificate.

## Receiver status and browser notices

Regression checks distinguish receiver preparation, waiting, handshake, readiness,
recovery and failure, and verify that actual display ownership selects CarPlay or
AirPlay waiting copy. Main settings retain short `CarPlay status | AirPlay status`
titles with a consolidated automatic-hint area below. Duplicate causes and routine stage prose are hidden; explicit operation results stay below their source control. All existing copy
is preserved and the 15 additional Android entries are present in all 8 locales.
Browser codec/protocol/takeover errors use persistent closable cards, dismissed
errors stay hidden on rerender, and code/address feedback stays beside Connect.

Physical phone/vehicle checks of status timing during permissions, USB enumeration,
reconnection, AirPlay pause/buffering and browser notification dismissal remain
open in [Todo](Todo.md#connection-settings-and-browser). Desktop harnesses establish
software behavior only.

## Location and notification verification

The implemented [location flow](geolocation.md) uses precise Android GPS until the
browser datum is confirmed, refined GCJ-02 conversion and browser-local datum caching.
Location behavior is covered by the source checks above. The debug APK contains geocoordinates and JNA native
libraries for arm64-v8a, armeabi-v7a, x86 and x86_64; the library checksum matches its
pinned release. This source-only APK contains no runtime MFi identity.

The Chromium `run.mjs`, `phone-run.mjs` and `geolocation.mjs` harnesses cover reconnect/offline behavior, the production shared server, browser-owned
location permission, datum persistence across reload, opt-out, persistent notification
close behavior, upper-left notifications and the lower-left waiting-screen action.
The GPS provider tests verify precise permission, GPS subscription, initial Android
forwarding and cleanup. The decision tests cover immediate GCJ-02 confirmation,
WGS84 movement evidence, stale/duplicate fixes and source fallback.

These checks establish software behavior, not vehicle sensor accuracy or native loading
on a physical phone. Next, run the [location device checks](Todo.md#location), including
cold-start drift, GPS loss/recovery, screen-off operation, geographic boundaries and
actual iPhone navigation. Do not mark those acceptance items complete from simulation.

## Phone and browser acceptance

`BrowserMainPageTest` checks centralized hint placement, cleared stale failures, structured USB consent and automatic persistence without a reconnect button. `BrowserConnectionHintsTest` covers unknown/redacted SSIDs, mismatch and actual absence of Wi-Fi. `HotspotOperationFeedbackTest` checks method-versus-authorization placement, card rebuilds, consecutive clicks and late asynchronous results after a superseding fact. Real Android authorization/VPN and network transitions still require the device checks below.

`BrowserSpacingTest` measures control/description gaps and page edges, checks that opt-outs leave no extra gap, and exercises buttons and network options at 320 dp with large text. System permission dialogs and actual OEM font rendering still require device acceptance.

Automated coverage for this flow lives in `FirstUseActivityTest`,
`BrowserCarPlayReadinessTest`, `BrowserMainHostTest`, `BrowserMainPageTest`,
`CarPlayHostBrowserLinkTest` and `BrowserLinkServerTest`: checklist completion/recreation, legacy-guide migration, completion without wireless configuration, missing-only
permission requests, permanently denied permission settings and uniform navigation spacing,
current-page readiness, authenticated heartbeat/disconnect, startup gating, waiting title
and browser-selected HEVC independent of the old preference.

1. Install/update the intended signed `mobile` APK; confirm settings survive an update. On first launcher open, check that the Permission checklist appears directly, without welcome, connection or sound steps. Verify missing-only permission requests, Back, rotation and completion; configure connection and sound later in the settings pages. Check uniform button spacing on narrow screens and with large text. Deny a permission, deny it permanently, return from app settings, and verify current grant status. Check Bluetooth, battery settings and USB VPN consent. Continue with missing grants only through the explicit confirmation. The next launch should enter Main settings directly, and its Permission checklist action should reopen the checklist. Confirm Advanced settings has no duplicate permission list. Before opening the browser, verify **Waiting for browser connection** and no iPhone connection attempts, including USB attachment, boot and Bluetooth events. Open the hosted HTTPS page from TiPlay's pairing link. Check first-use network permissions, pairing-code entry, saved address and fragment removal. Deny a permission once and confirm the explanation and retry path work.
2. Connect via each affected USB/wireless mode. Confirm CarPlay picture, touch alignment, keyboard/controls and audio. Close/reopen the browser, interrupt Wi-Fi, sleep/wake the screen and reconnect. A replacement browser must take ownership without the old page stealing it back; disconnect must release the session.
3. Check both phone settings menus. Valid edits apply immediately and negotiate a reconnect when required while keeping settings open. Invalid drafts show errors. Disable CarPlay and confirm startup/retry stops; enable it and verify recovery. Verify **Start on boot** only when enabled, subject to Android background restrictions.
4. Resize the browser, change fullscreen/orientation and open/close browser panels. Check stable layout, accurate touch mapping, negotiated resolution and recovery after rapid changes. Verify HEVC is selected only when reported supported, H.264 is selected otherwise, and there is no manual codec switch. Settings and diagnostics must remain usable while disconnected.
5. Change Android's address/port: the pairing code stays valid, but the browser requires a manual endpoint change or new link. **New code** must invalidate the old code and terminate its session. Test a stale code and interrupted connection without exposing credentials in logs.
6. With CarPlay sound enabled, check browser music/navigation, Siri and calls. Verify microphone permission denial still permits playback; microphone demand must use a verified car HFP/SCO route and release it afterwards. The browser must never request microphone access. With CarPlay audio disabled, verify the intended iPhone-to-car Bluetooth path. Check echo, navigation attenuation, timing and route restoration on the actual car.
7. Export diagnostics in Standard and Debug modes and use **Share**. Confirm Standard exports only a TXT and Debug exports a ZIP using the same timestamp naming pattern. Check log TXT, per-channel BIN/PCM files, millisecond/sequence/offset indexes, preserved history and absence of a clipboard action. Test storage fallbacks and retention of the newest eight fallback reports. Confirm the main-page performance hint follows the switch; each enable creates a session with version/configuration, restarting the process defaults to Standard, saving retains raw history, and Clear preserves saved ZIPs while starting a fresh session if still active. Confirm Debug forces active AirPlay URL playback through Android and disabling it restores direct eligibility. Verify ZIP MIME types in Downloads, document-picker and Share flows; reconstruct streams using the indexes and confirm exporting does not consume or truncate the capture.

On the Android phone, turn system automatic rotation off and verify that the connection
host, settings, permission checklist and icon cropper honor the user's orientation.
Turn it on again and verify normal system-controlled rotation.

## Media clock and continuous audio acceptance

The beta.13/v79 live-audio source corrects recovery-tail double fading and
instantaneous voice/media gain changes, independently reproduced with production
code and real Soxr. Recovery resumes the already-faded amplitude; the shared mixer
uses the existing 5 ms envelope across continuous, timestamped and compatibility
streams, retaining media attenuation during voice tails. DC isolates gain edges from
real speech: the former 0.4000205 single-sample jump becomes about 0.0016670; a 50 Hz
control distinguishes natural waveform slope. CarPlay 48 kHz and mirror 44.1→48 kHz
recovery comparisons cover partial underruns, unavailable/reacquired references and
64/128/256/1024-frame blocks. Compare independent old-tail envelopes and fresh Soxr
output, including source sample progress; counters alone are insufficient.

Active/recovery/retired tails share the source-deadline calculation. Keep the old
sample's provenance across crossfades and epoch/reset retirement; reject expired
tails while preserving legal tails and unknown references. Debug retains a bounded
retired-tail rejection with its own epoch/generation, separate from successor
metrics; the browser/native selector fixture checks the diagnostic path and print
precision. Large-quantum cases separately bound fresh PCM, crossfaded old samples
and partial-underrun tails over their actual contribution intervals: a 5 ms tail
inside a 1024-frame block must not inherit the whole block or its zero padding as
extra source age. Both sides of the deadline remain checked, without a larger limit.
These software checks do not establish that every vehicle click or the
separate URL-audio graph is fixed.

This final source passed **777/777 browser tests**, **22 scoped Android audio
diagnostic tests** and the real Chromium 151 production-CSP media-clock harness.
All 61 browser runtime hashes stayed unchanged through actual AudioWorklet,
CarPlay/mirror output, suspend/resume and worker/main Canvas checks. Independent
review accepted the corrected short-tail bounds; the earlier 771-test intermediate
run is superseded. Full Android CI remains waived by the user. These changes are
published as beta.13/v79; [Build](Build.md#beta-release) identifies the verified artifacts and deployment.
The beta.13/code55/v79 metadata preflight additionally passed 9 release-draft,
2 root-site, 35 browser-diagnostic and 40 scoped native diagnostic/protocol cases
across four classes. All 239 checked inputs remained byte-identical after version
normalization; download entries still open the version-independent Releases index.

Frozen beta.12 capture replay also compares identical decoded mirror PCM delivered
at nominal and recorded send-attempt times through the production worklet/Soxr.
Recorded delivery can starve output despite continuous source samples. An ignored
full-10-ms-read admission variant lowers recovery counts but increases emitted
silence by 21.271/29.542 ms in the same central windows; it was rejected. Playback
counters cover the complete replay, while waveform comparisons use a fixed central
14.891-second window. Independent source-availability masks distinguish missing
input from available instantaneous samples without claiming Soxr history/lookahead
is sufficient. CarPlay packet-coordinate replay finds no gaps/overlaps in 4,582
packets / 4,678,720 frames; no source-coordinate change was justified.

Run the browser clock, continuous-audio, AudioWorklet, frame-pacing and main-thread integration tests
with the repository's Node test command. Their deterministic virtual-time cases vary
Android, producer and device rates independently, inject network jitter/queue steps and
calibration changes, and retain dynamic PCM through the real variable-rate JavaScript engine.
Check burst coalescing, deadline-timer fallback, frame-interval tails, waveform error and boundary continuity, bounded phase/rate correction, queue growth,
stream/format isolation, explicit interruption fades and rejection of old generations.
Fixed 1024-frame AAC packets with naturally estimated positive drift exercise the production
resampler beyond its clock-fitting warmup; continuous nominal RTP must not acquire artificial
sample gaps. Worklet cases cover short-lead speech with a 188 ms device pipeline, sustained
arrival-delay steps, and concurrent streams sharing a semantic type, including ending one
while the other remains audible. Constant samples or counters alone do not establish audio quality.
Independent device-rate cases include a context clock running 4000 ppm slow while the
Android/browser mapping stays at unit rate. Production worklet, resampler, output mapping
and video scheduler run together with dynamic PCM, checking sustained output without
clock-step resets, unavailable-reference drops or wider video/A/V limits. Calibration
tests verify real format-specific measurements, cancellation and bounded preparation;
the worklet must not perform cold impulse measurements during playback.
Output-clock regressions inject future/backward native pairs, slow timestamp getters and
measurement refits while rendering dynamic audio through the real resampler. Measurement
generation changes must preserve its live state; actual suspension or skipped render
quanta must still recover. Held output anchors retain the original expiry and accumulate
uncertainty. Mirror packet tests distinguish presentation-clock refinement from stable
decoded sample coordinates, and retain real RTP/sample gaps.
Synthetic pipeline changes also use an independent emitted-sample/output-time oracle,
including lagging platform latency attributes; passing the mapper's own timing checks
alone cannot establish correct skew.
The [libsoxr report](../scripts/soxr/REPORT.md) retains independent DSP/runtime reviews,
format/anti-alias/120-second drift results and raw repeated performance measurements.
These establish the supplied pure JavaScript engine’s tested behavior, not a
whole-worklet hardware deadline or universal CPU improvement.

Use the [browser E2E harness](../tests/web-e2e/README.md) for actual CSP, pure JavaScript loading,
AudioWorklet output, output timestamps, worker/main Canvas paths and context suspend/resume.
Run timing-sensitive browser checks separately from Gradle builds and other browser harnesses;
resource contention can starve actual rendering. Keep timing assertions unchanged when isolating a failure.
Verify the audio-output reference remains active with Debug off. Synthetic clocks must
also test stale/invalid references, large epochs, output-device latency changes and the
fallback's uncertainty. Live video and audio independently retain a sender-relative
300 ms ceiling; touch must leave the audio timeline unchanged. Missing audio references
retain unavailable/skew evidence while video continues. A dropped/infeasible
frame is an explicit recovery outcome, not a successful synchronized presentation. First-frame
proof tests reject scheduler drops, expired paced frames and failed GPU submissions. JVM media
ownership tests exercise old-session teardown/feedback, callbacks after replacement and screen
EOF during a loan; retirement is atomic with delivery and cannot stop a successor.

For device acceptance, record source app/iPhone, Android transport, browser/vehicle,
output route and reproduction times. Exercise long music/navigation playback, delayed
and bursty delivery, background/foreground, pause/resume, seek, track/format changes,
AirPlay takeover/return and changing output routes. Listen for quiet buzz/clicks as well
as gaps, and measure corresponding audio/video events across recovery. Software output
timestamps cannot establish acoustic speaker time or panel scanout. Keep physical
follow-up in [Todo](Todo.md#browser-and-carplay-audio).

## Ordinary AirPlay acceptance

Automated URL regressions verify bounded retained readers for ignored Range responses,
including interleaved audio/video with unknown-length 200 responses, LRU/byte limits,
independent cancellation and idle cleanup. They also verify
bounded FCUP startup probes, complete/partial HLS rewriting and preserved time/rate when direct
playback switches to the proxy after an error. Assert downloaded byte counts as well as output
correctness, so repeated prefix downloads cannot pass unnoticed.
Transient 502/503/504 GET responses receive at most one retry within the original
resource deadline. Tests check cancellation during the retry delay and no retries for
403/404 responses; a repeated upstream failure must still surface as an error.

Use unprotected content from an actual iPhone. Check discovery and device approval, mirroring, audio-only playback, JPEG/PNG photos, and URL MP4/HLS playback with seeking, subtitles, buffering and iPhone controls. Test stopping/replacing a cast and returning the browser display to CarPlay while retained CarPlay audio continues as designed. Exercise authentication/resource expiry and recovery after network loss.

Check advertised audio codecs in the actual browser: ALAC/AAC-LC follow native decoder support; AAC-ELD remains offered and uses supported WebCodecs before the bundled software decoder. Verify clear failures when no implemented decoder can handle the format. HDR content is subject to TiPlay's SDR policy. DRM services and apps that prohibit AirPlay are outside acceptance. See [AirPlay](AirPlay.md) for receiver boundaries.

Record Android/device, browser/vehicle firmware, iPhone/iOS, app version, transport, exact steps and remaining failures. Share reviewed diagnostics without pairing codes, keys or personal data. Track outstanding physical validation in [Todo](Todo.md).

## Debug raw capture and car Bluetooth hints

Run the repository workflow checks against the intended source. Browser audio regressions
exercise actual worklet/timeline code with nonzero PCM across the producer lead, output-delay
and clock-margin boundary; they also distinguish decoded from rendered output, classify
discard reasons, isolate retired worklet reports and bound processor-failure recovery.
Diagnostic transport checks verify independent audio-detail limits, live Debug switching and
exact browser audio response capture. Socket fixtures must close their clients after checking
server-initiated EOF and before checking port reuse.

Mirror regressions accept bounded terminal zero padding while rejecting malformed box tails
and hidden HDR/Dolby extensions. Resource fixtures verify Range isolation, FCUP request headers,
partial responses without double slicing, ignored-range full responses and upstream denial
classification. Foreground-service tests cover granted-but-ineligible access, bounded fallback,
foreground retry and refusal without a process crash. Task-removal tests preserve the active
session when the empty launcher task is removed, while session-task removal still stops it.

`RawTrafficTest`, `DiagnosticExportStoreTest` and `SessionLogIntegrityTest` cover exact recovery of large binary payloads, byte ranges, unredacted credentials, disabled capture, exclusion of retained raw history from Standard TXT, Debug ZIP stream reconstruction, snapshot stability, PCM/binary extensions, temporary-file cleanup and preservation of interrupted records without preventing later session exports. `DiagnosticLogsTest` covers ignoring persisted Debug values at process initialization and capture configuration. `DiagnosticCaptureClearUiTest` covers the completed-export Clear action; `BrowserMainPageTest` covers the performance hint. `DiagnosticExportFallbackTest` also covers ZIP MIME/extension preservation, distinct share URIs and byte-identical fallback copies. `AirPlayVideoProxyTest` and `BrowserLinkServerTest` verify that the debug policy removes peer URLs, rewrites playlist children and proxies redirects, while Standard retains direct eligibility. The Chromium `airplay-video.mjs` harness toggles the policy during decoded playback and checks proxy requests, absence of direct iPhone requests while enabled and restored direct playback when disabled.

`BrowserMainPageTest` covers the iPhone Bluetooth audio reminder, missing-permission checklist guidance and state refresh without session recovery. USB queue replay tests capture exact USBMUX/NCM bytes before parsing and preserve a completion after timeout/cancellation. Hardware checks must still confirm Bluetooth/hotspot refresh latency (including quick-settings toggles and return from Android settings), permissions at each supported API level, and USB attach → authorization → re-enumeration → transfer → detach archives.

`CarBluetoothStatusTest` distinguishes unavailable profiles, two empty profiles, the selected iPhone, car-audio device class and unknown/headphone classes. Actual A2DP/HFP broadcasts, OEM car classes, USB hardware transfers, disk throughput under sustained capture and audible car playback still require device verification. Capture covers Android application I/O, not Bluetooth air packets or USB bus signalling.
