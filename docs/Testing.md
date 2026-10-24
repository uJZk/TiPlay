# Testing TiPlay

TiPlay supports an Android phone plus car browser. Follow [installation](Install.md) and [build](Build.md) instructions; use a parked car for physical acceptance.

The current receiver/session source passes **908 browser tests** and **4,189 Android
unit tests** (2,366 shared, 1,817 common and six home), all three required debug lint
targets and all three debug APK builds. The real Chromium presentation component
suite passes Chinese/English at 320/800 pixels. Its structured events do not establish
media transport or physical playback; the full media-page harness is blocked by
this environment's managed ICE policy. Published artifacts remain recorded in
[Build](Build.md#beta-release).

## Browser WASM verification

The beta.15 WASM build passed **893 browser tests** and the complete required Android
command: **4,131 unit tests**, all three debug lint targets and all three debug APK
assemblies. The native libsoxr JNI/signal/concurrency checks pass. All five shipped
WASM binaries rebuild byte-for-byte from their pinned complete source inputs.

Chromium 151 checks use production CSP: live AudioWorklet output, independent
timelines and suspend/resume pass with 85 runtime hashes unchanged; the actual
AAC module worker matches 96 golden PCM frames across eight profiles and passes
load-failure/retry/disposal checks. URL playback passes WebGL and 2D with actual
SoundTouch SIMD loading and backend reporting. SRP pairing and tamper checks pass
with native BigInt; the slower WASM candidate stays outside production.
The real Service Worker also passes a nested-path offline reload: all 86 runtime
cache entries retain their hashes, all five WASM binaries execute offline, and
direct/Worker AAC output matches golden PCM. Uncached requests fail and source
archives stay outside the cache.

Clock-safety regressions independently vary the public getter and actual frame
counter: frozen, biased, slow/fast, jumping and throwing getters cannot train
rate compensation or change Worklet PCM. Causal probes preserve request-time
freshness across delayed ACKs; delayed native samples retain their original
event age. Native outage reacquisition and six-hour output projection pass.
Latency-estimate fallback continues rendering without claiming a source deadline
was verified. URL EOF follows natural node completion even when the getter
crosses the tail early or stays frozen.
The production-CSP Chromium 151 media-clock harness passes normally and with
four injected main-getter faults: frozen, 0.98× progress, ±5-second jumps and
exceptions. Every run produces real nonzero Worklet PCM, preserves independent
source deadlines and suspend/resume behavior, and retains all 85 runtime hashes.

Beta.15/code57 and v83 repeat the complete Android CI, all 893 browser tests,
normal Chromium media-clock output and real offline loading. All 150 browser
inputs remain identical after normalizing three version declarations. Signed
release lint/build and independent signer/runtime/native-library/DEX/source/checksum
verification pass; exact artifacts are in [Build](Build.md#beta-release).

These are software/source-build and signed-artifact results; vehicle acoustic,
panel-latency and physical acceptance remain unverified. See
[WASM boundaries](Browser-wasm.md) and the [browser harnesses](../tests/web-e2e/README.md).

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

Historical Minibili and ordinary MP4/HLS replay evidence does not establish
optimal vehicle thresholds or a unique field failure cause. See
[live policy evidence](Diagnostics.md#live-video-policy-evidence) and
[published artifacts](Build.md#beta-release).

Native queue regressions hold an application RPC while 300 ordinary
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
driver, speaker output or vehicle latency.

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

Android cases cover resource-route
reuse/revocation, redirects and partial manifests, bounded startup/continuity
diagnostics, device-fit/source-anchor evidence and the audio/video diagnostic
allowlists. Mirror worklet regressions
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

An independent hardware-clock/real-Soxr oracle verifies that repeated 10 ms
output-pipeline changes no longer
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
`CarPlayCommandResultsTest` and `CarPlayEventChannelTest` add independent coverage
for bounded command results, monotonic expiry, late/duplicate replies, encrypted
response fragments across idle read timeouts and retired readers. A synchronized
race fixture prevents old modesChanged from overwriting a successor in low-level
reader fixtures. Responses never authorize ownership.
Socket lifecycle fixtures exercise real TCP/UDP and encrypted RTSP SETUP rather
than only installing internal fields. Exact initial-SETUP retries preserve the
original ports/cipher; other initial transactions receive 455. Stream SETUP remains
valid. One cipher per verification epoch rejects nonce-zero replay, and fresh
PairVerify cannot decrypt a prior epoch's ciphertext. Resource cases check port
reuse, worker retirement, late accepts, blocked writes and close during publication.
Delivery-pump fixtures reproduce same-value recursion and transport/state-lock
inversion, and verify stop/return across a channel change during the first borrow.
The beta.12 field capture confirms a mirror loan retaining control, ownership return
without old-session SETUP, fallback after 2.007 seconds and actual browser draw after
5.119 seconds. Both URL loans are confirmed before peer TEARDOWN/control EOF after
322/131 ms; subsequent CarPlay drawing uses new sessions. This proves one recovery
path, not seamless return or iPhone internal intent. Broader picture/sound acceptance
remains in Todo; published sources remain those in [Build](Build.md#beta-release).

Capture regressions cover lock-wait/failed-append timing, retained deadline
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
Signed artifacts and publication are recorded separately in
[Build](Build.md#beta-release); historical scoped runs do not replace current CI.

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
were unchanged by that budget adjustment; subsequent live-audio fixes are described
below. The reference-based CarPlay changes were outside that capture review, and
full Android CI was not rerun for that review.

Native cases additionally cover fixed source-fit/quantum
fields, six-place MAD printing, one-time 400 ms SETRATE anchors, HTTP failure phases
and FCUP deadline ownership/logger isolation. Source/quantum Debug collection and
diagnostic observation preserve real Soxr PCM and recovery decisions. The v76 source passed 90
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

The former experimental isolated-site assembler is no longer the production deployment:
`https://ujzk.github.io/TiPlay/` is replaced directly, the independent `/webrtc/`
site is removed without alias/redirect. All language download pages link to the
GitHub Releases index without a version-specific URL;
the historical 0.2.16 release/download URL is no longer available.

Preserve remote diagnostic coverage when running the integrated suite: bounded
independent video snapshots, capture-session/stream/epoch interval baselines,
legacy and current production-shaped diagnostic fixture validation
(the wire payload remains limited to 256 fields), anonymous ICE/native metrics,
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
AirPlay waiting copy. AirPlay preparation/playback and pending screen return
suspend the CarPlay presentation, preserving its raw phase for release. Regression
checks retain independent permission/AirPlay failures and restore real CarPlay
failure after release. Main settings prioritize AirPlay during casting; all eight
locales include the waiting title. Automatic hints stay below the short status,
and explicit operation results stay below their source control.
Browser codec/protocol/takeover errors use persistent closable cards, dismissed
errors stay hidden on rerender, and code/address feedback stays beside Connect.
The browser omits connection/playback success text and hides empty status rows.
Technical details and the monitor switch stay inside collapsed Diagnostics; web
cases cover expansion, actionable waits/errors and retry advice.
`receiver-ui.mjs` runs the production presentation functions against real Chromium
DOM/CSS/CSP in Chinese and English at 320/800 pixels. Its structured event sequences
cover pending borrow, first-frame epochs, return, URL pause/buffering, old codec
errors and repeatable failure notices. It proves presentation behavior, not media
decoding, pairing or DataChannel delivery. A managed browser policy that produces
no ICE candidates still blocks the full media-page harness.

Host regressions bind ownership to controller, control session and resource state,
rechecking after external callbacks. They reject queued old Active/Frame and
Start/End notifications, preserve independent audio and exercise missing-stream
recovery. AirPlay receiver state/revision is one atomic snapshot; a later revision
distinguishes a new same-label failure from an old polled value.

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

The beta.13 source passed **777/777 browser tests**, **22 scoped Android audio
diagnostic tests** and the real Chromium 151 production-CSP media-clock harness.
All 61 browser runtime hashes stayed unchanged through actual AudioWorklet,
CarPlay/mirror output, suspend/resume and worker/main Canvas checks. Independent
review accepted the corrected short-tail bounds; the earlier 771-test intermediate
run is superseded. That historical scoped run did not include full Android CI. These changes are
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

The subsequent beta.13 capture binds the current code55/v79 recording and excludes
the short beta.12 residue. In a 130-second pure-media window without active speech
mixing, 38 clock-step recoveries accumulate while renderer-underrun totals stay
unchanged. Both native-output and rendered-context long-baseline slopes are about
1.4% slower than the performance clock; this is effective sample-clock progress,
not proof of a physical oscillator fault. Frequent output-step fit resets leave the
applied correction behind that progress. All 6,336 AAC packets in that window decode
with continuous sample coordinates, finite PCM and no systematic packet-boundary
edge. Batched arrivals must not be classified as speech DTX or lost samples.
An independent 20-second production-Soxr oracle with actual context rate 0.9857 and
applied rate 0.998 produces seven phase recoveries and source-cursor jumps; matching
the rate produces none. This establishes a reproducible clock-compensation defect,
without assigning every reported click or speech onset/ending to that defect.

Rate estimation separates native output pairs from running render-cursor pairs.
A fresh accepted native fit takes priority; render progress supplies a fallback,
and missing fresh evidence freezes the one applied-rate controller. Confirmed
sampling/native gaps retain nominal-reset/reacquisition behavior; holding the old
rate across a true rate change increased missing output in an independent oracle
and was rejected. Output phase steps do not clear the independent render fit. Existing 4/16-second fit spans,
2-second slope pairs, ±2% accepted estimate range and 1000 ppm/second slew remain.
Render fits reserve the largest observed block's half-width in their measurement
uncertainty and retain actual raw MAD; this does not make a short coarse-block fit
precise. Its noise gate allows that known resolution in addition to 3 ms excess
noise. Native noise remains independent and cannot inherit this enlarged allowance.
Projection uncertainty uses the reciprocal extrema of the existing rate range over
the actual anchor distance, including the emitted quantum. Reusing a held anchor
does not add the same rate-age interval twice. Actual source deadlines retain the
300 ms ceiling with complete uncertainty. Debug-only observed state-transition
counts/non-running duration preserve brief observed pauses between snapshots;
delayed/coalesced browser events remain a limitation. The capture reports a reduced
Chromium 148/Linux user agent, not a specific browser build. All 221 live snapshots
are running, but no raw lifecycle event or cumulative pause counter establishes
uninterrupted context progress between them.
Voice preparation separates first admission from recovery after actual accepted
PCM output, including silent PCM. First admission retains the 30 ms phase reserve;
recovery uses the actual 300 ms ceiling with complete uncertainty. The 20 ms wait
is paid once per startup/recovery, not repeatedly added to a stopped source cursor.
Preferred delay plans remain soft targets, clamped to the current admission budget;
a reachable 280 ms plan cannot contradict first-admission headroom and block startup.
Candidates use the renderer's shared integer-frame/raw-source mapping and contiguous
input runs; expired candidates are reconsidered as fresh PCM or clock evidence
arrives. Real Soxr input/output preparation survives callbacks under the existing
16-call budget. Its staged prefix retains source/rate metadata, then hands the same
live filter back to the ordinary renderer and shared mixer. A finite short utterance
may emit actual partial output after the wait; zero padding cannot widen its source
age. Source holes, unknown clocks and source/output deadlines remain explicit.
Tests cover actual delivery gaps, same-origin clock generations, uncertainty changes,
expired-to-fresh recovery, short/silent utterances, large quanta and low-rate priming.
Arrival guidance acquiring its first presentation anchor preserves its live filter;
later real generation changes still recover. This separate recovery defect does not
establish the cause of the no-navigation pure-media field window.

The beta.14 functional corrections passed all 814 browser tests, 69 scoped Android cases,
the mobile debug build and the production-CSP media-clock harness in Chromium 151.
The browser runs bind unchanged runtime/test inputs. That historical scoped run
omitted full Android CI; these checks do not measure vehicle speaker output.
Beta.14/code56/v80 metadata preflight also passes 9 release-draft tests, 2 root-site
tests, 62 browser checks and 51 native cases across four classes. Those scoped
counts overlap the functional suites. All 138 checked functional inputs remain
byte-identical after normalizing only the three version-bearing JavaScript files;
the three shared diagnostic fixtures also use v80. Chromium checks pass again on
the versioned source with all 61 runtime hashes unchanged.

The next field capture binds beta.14/code56/v80 and covers only CarPlay, as
confirmed by the user. Excluding old-session residue and first-snapshot totals,
the new pure-media window has four clock-step recoveries over 55.007 seconds
(4.36/minute), versus 38 over 129.983 seconds (17.54/minute) in beta.13. These are
software recovery rates, not measured acoustic pop counts or a controlled trial:
content, duration and effective context progress differ. No new renderer underrun,
source-deadline rejection or clock-generation recovery occurs in that new window.
Across the continuous 80.011-second context segment, rendered progress is 293.67 ms
shorter than journal time; all observed state-change/non-running counters remain
zero. API counters exclude observed pauses, not unreported internal scheduling.
The render fit nevertheless resets 1,632 times, while native phase-fit resets
increase by 13; none of the 17 snapshots selects the render fallback. Five-second
snapshots cannot identify each reset's micro-sample trigger. Reference decoding
of all configured media/voice payloads yields 4,216,896 finite source frames with
continuous per-frame coordinates and no systematic packet-boundary edge. A
cross-transport relay gap belongs to reconnect, not steady pure-media playback.
This sample does not establish mirror/URL acoustic improvement.

The actual worklet counter advances 3,826,176 frames/29,892 callbacks in the same
80.011-second interval, or 79.712 seconds at 48 kHz. Its cursor advances identically;
the main getter differs by only 5.33 ms of endpoint lag. Correcting known report
receipt age still leaves about 276–283 ms, so main getter lag alone cannot explain
the whole deficit. Unknown send/queue delays and process scheduling remain;
these counters do not establish a physical DAC rate.

A historical Chromium 151 experiment reproduced continuous 128-frame Worklet
progress while the main getter advanced in four-block batches: the old short-pair
gate reset 2,313 times, and skipping repeated readings still reset it 322 times.
The v81 token fence was an intermediate correction. Current live timing instead
uses actual frame counters and causal request/ACK intervals; a valid first
frontier is retained. See [current clock roles](Browser-wasm.md#audio-clock-roles)
and [WASM verification](#browser-wasm-verification). Load-dependent reference
acquisition remains a field acceptance item; none of these observations measures
vehicle speaker output or a physical DAC rate.

The independent [ChatGPT clock test](https://ujzk.github.io/TiPlay/chatgpt/) runs
90 seconds of baseline, bounded main-thread load and recovery. It records getter
batching, actual worklet frame progress, causal probe intervals, state/visibility,
timer precision and optional output statistics. Users can mark audible events and
export local JSON; nothing is uploaded automatically. Paused/background intervals
are segmented, and unknown timer precision or capped history downgrades conclusions.
It imports no TiPlay playback runtime. Its synthetic tone/main-thread load cannot
exclude codec, Soxr or video/GPU effects when a problem is absent. The published
page-only v2 source is `957b67f5`, with 33 scoped checks, a 15-second browser
workflow and independently decoded actual-screen QR verification. The unchanged
tone generator retains the earlier complete 90-second runs. A large result card
supports photographing the screen; bounded fragment-only QR summaries can be
opened/saved on a phone without copying or downloading on Tesla. Summary export
preserves selected spans, nulls, caps and omitted-mark counts; it excludes raw
samples and does not upload a report. That page-only publication did not include
the production-clock correction, deployed separately as v81; neither establishes
a physical DAC rate. Use the same
vehicle/output path for a field comparison.

In the user's Tesla 48 kHz, 90-second standalone run, all three process-progress
intervals include zero: baseline −49.47…23.43 ms, main-thread load −43.50…30.90 ms,
and recovery −5.13…35.57 ms. Getter differences are −27.20/+4.97/−5.73 ms over
approximately 30 seconds each; probe RTT P95 is 40.60/43.40/42.00 ms. The user
heard no clicks, despite four baseline and two recovery frame-coordinate
discontinuities. This does not reproduce a sustained deficit in the lightweight
graph or establish those discontinuities as audible events. Frequent repeated
readings and multi-block updates confirm the getter observation boundary on the
vehicle. Production codec/Soxr/video workload is absent, so production-load
scheduling and remaining reported clicks stay open. Tesla cannot reliably copy
or export the raw file; the user transcribed the visible results.

A subsequent 44.1 kHz standalone run includes three or four user-heard light
clicks during main-thread load. Its baseline/load/recovery process intervals are
34.28…40.28/−46.62…−16.52/−45.91…−8.01 ms; getter differences are
48.71/6.18/−0.02 ms and frame-discontinuity counts 5/2/0. Unlike the previous
48 kHz run, this reports a light sound in the independent browser/system output
path. The user subsequently clarified that it is very slight and might differ
from the original CarPlay clicks. Treat it as a separate unconfirmed symptom;
it neither reproduces the original defect nor excludes TiPlay's codec/Soxr path.
One run per rate does not establish a rate-specific cause. Scheduling, buffering
and browser-internal rate conversion remain comparison hypotheses; these intervals
describe recorded throughput with unknown timer-coarsening error, not DAC timing.

The requested next [Cloudflare Workers audio comparison](Todo.md#cloudflare-workers-audio-comparison)
has not started: no WASM comparison page, upload endpoint or vehicle comparison is
implemented or deployed by this work. Current live CarPlay/mirror output already
uses a persistent AudioWorklet, bounded PCM timelines, stateful WASM Soxr and
explicit underrun recovery. Its sample continuity and clock observations still
need physical acceptance. URL casting remains a separate BufferSource-node engine;
page-side demux/PCM processing, tempo changes and rAF-driven scheduling depend on
the main thread, while WebCodecs decoding is asynchronous browser work. Its 500 ms
audio submission horizon is also limited by common A/V coverage. The present
live-clock correction does not move that URL pipeline into a Worker or Worklet.

The planned experiment must isolate the DSP backend rather than compare different
playback designs. Use the same pinned algorithm and PCM, verify output accounting
and quality, then cross or randomize backend order on the same device/route/rate
and buffers through normal, interaction/load and recovery phases. Report audible
marks separately from queue underruns, recovery actions and optional renderer/output
statistics. Check WASM support, CSP and successful preinitialization; record the
actual backend, including unsupported cases. Direct bounded uploads must expose
success/failure and retain failed results for retry, without requiring Tesla JSON
export. This isolates live Soxr DSP, not the separate URL BufferSource graph.
No acoustic benefit or physical clock cause is established in advance;
worker isolation, preallocation and WASM cannot guarantee OS scheduling deadlines.
Native WebRTC audio for non-URL streams remains an alternative, not this round's
implementation. The detailed pending protocol and collection limits stay in Todo.

Immediate buffered flush has a separate captured before/fix regression: a new
track anchor previously forwarded an old-origin packet first. Protocol reference
checks establish the 23-bit sequence ring, excluded marker and first-retained
`until`. Scoped tests cover equality/wrap, queued/forwarded frames, capacity-wait
races, old-prefix draining without media pacing, empty-marker fence retirement,
new-sender isolation and pause/anchor reset without a preceding pause command.
Deferred range requests return explicit RTSP 501 without changing playback or
calling the media handler. All **44 scoped native cases** across buffered stream,
session and RTP timeline pass; sender fallback and physical track changes remain
unverified. This boundary defect does not explain the uninterrupted pure-media
window's clock recoveries. A separate before/fix regression retains prefetched
future-track origins: sequence filtering can scan the queue, while timestamp
trimming only removes its leading prefix.

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
These establish the tested engine's signal and runtime behavior, not a
whole-worklet hardware deadline or universal CPU improvement.

Use the [browser E2E harness](../tests/web-e2e/README.md) for actual CSP, WASM loading,
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
