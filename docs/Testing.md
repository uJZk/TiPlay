# Testing TiPlay

TiPlay supports an Android phone plus car browser. Follow [installation](Install.md) and [build](Build.md) instructions; use a parked car for physical acceptance.

Release-specific test counts and public artifact checks are evidence for their
recorded source, not interchangeable coverage counts for later engines.

## Current release source

**Beta.35/code77, browser v110, is the current release candidate.** It covers
paired-only car Bluetooth selection with car-initiated first pairing, phone
capability-discovery retry and redacted crash/process-exit exports. Existing
authorized Bluetooth reconnection remains available. The pinned upstream WebRTC
build environment, compatibility patches and warning policy apply to future
rebuilds; the committed AAR, native Opus/RTP audio, RTP video and Bluetooth/SCO
microphone route remain unchanged.

Full Android CI is skipped at the user's explicit request. The local complete
Android run was stopped at that request. The candidate passes 675 web tests,
76 build/native Python checks (24 + 52), nine release-draft checks, two
site-deployment checks, public-tree/cache checks and AAR/RTP-audio verification.
Signed packaging, Pages deployment and independent published-byte verification
remain pending. [Build](Build.md#current-browser-deployment) records the candidate
and will identify its final commit, workflow runs and artifacts.

Use the [Android workflow](../.github/workflows/android.yml) for the source revision
under test. Synthetic caption and player tests
do not establish physical subtitle availability, vehicle rendering, or source
compatibility. Validate the matching APK and browser page on the target vehicle;
observe YouTube subtitle delivery, repeated consent, AirPlay mirroring and video
continuity separately. Missing audio transport keys are diagnosed without assuming
a plaintext stream.

## Previous release source

Beta.31/code73, browser v106, adds worker resource-request bridging, native audio
peer recovery, sender identity compatibility and additional diagnostics. The
[Android checks](https://github.com/uJZk/TiPlay/actions/runs/40801961340)
passed for the release source, including browser and WASM checks. The libmedia
build reproduced the committed assets in WSLC using hash-verified cached WASM
inputs. Real-car playback, repeated trust, navigation audio and HEVC continuity
remain physical acceptance work.

Beta.30/code72, browser v105, reserves the application BUNDLE transport before
adding video and stops every retired video receiver. Actual M150 tests reproduce
the old post-replacement bitrate collapse and verify the corrected 40-second
transport; real Chromium verifies the SDP lifecycle. HLS open failures now retain
bounded request/body/parse evidence through the real IO worker. URL metadata
opening on the reported device remains unresolved. Seven new shared JVM cases
cover sanitized native sender/feedback diagnostics and sample ownership; three
new browser cases cover local-only priming and cancellation. The 16 Mbps startup
prior and all congestion guards remain unchanged. Current source/publication
checks are in [Build](Build.md#beta30-release).
All **2,500 shared JVM tests** and **617 browser tests** pass. The final complete
shared run uses `-Pkotlin.incremental=false`. Socket fixtures preserve their
original timeout and ownership assertions while avoiding unrelated oversized
preparation work and accidental probes of a newly reused listener port.

Beta.29/code71, browser v104, retries keyframe recovery during source silence.
Four new JVM regressions use the real Hub's 500 ms suppression and verify recovery
of original High bytes while retaining the two six-second deadlines and terminal
stop conditions. Actual dual-codec AAR before/after results are described below;
the 16 Mbps startup value remains unchanged. Source/publication checks are in
[Build](Build.md#beta29-release), with full Android CI skipped by user instruction.
The final complete local shared command passed all 2,493 tests using
`-Pkotlin.incremental=false`; 613 browser tests and public-source/cache/deployment
checks pass. Socket shutdown verification waits for actual JDK socket-write
frames, with its original deadlines retained.

Beta.28/code70, browser v103, changes the startup prior to 16 Mbps at the user's
request. Its source/publication scope is recorded in [Build](Build.md#beta28-release).
The beta.27 native measurements below used 24 Mbps. A separate actual AAR run of
the new 16 Mbps prior passed 180/180 RTP receiver AUs, zero packet loss and
unchanged SHA-256 for 181,238 source bytes (about 0.483 Mbps). The software
receiver skipped five decode callbacks (175); no picture/render or vehicle
performance claim follows from this transport count.

Beta.27/code69, browser v102, adds native-input completion backpressure and bounded
original-video rate admission after beta.26 still suppressed frames. All 2,489
shared JVM tests and 613 browser tests pass, including 28 targeted video cases;
the actual AAR replay below
provides native queue/pacer evidence. Full Android test CI remains skipped at the
user's request, with signed packaging recorded in [Build](Build.md#beta27-release).

Beta.26/code68, browser v101, passes **2,481 shared JVM tests** and **613 browser
tests**, with public-tree, cache, release-draft and site-assembly checks. Twenty
JVM regressions directly cover video passthrough, flow and source adaptation.
Full Android test CI remains skipped at the user's request for this follow-up;
the separate signed packaging workflow and physical acceptance are recorded in
[Build](Build.md#beta26-release). The JVM tests do not execute native congestion
control or establish vehicle smoothness.

The [beta.25/code67 release](Build.md#beta25-release), browser v100, includes the verified scope of
613 browser tests. Its first complete local required Android command passed
4,346 tests and all required Debug lint/build targets. The final repeated Android
validation was stopped at the user's request; formal CI is explicitly skipped
for this release. Signed packaging and independent published-asset verification passed and are
recorded separately in Build. The media checks below describe source and
desktop behavior, with physical iPhone/Tesla acceptance still pending.

Beta.24/code66 and browser v97 pass 4,335 local Android tests, all required Debug
lint/build targets, 598 web tests, full CI and independent signed/public checks.
Fourteen sender-selection regressions cover Baseline-first startup, asynchronous
High selection, unchanged encoded bytes, IDR recovery, profile/level/mode rejection,
bounded timeout, retired selector/encoder isolation and callback/release/re-init
interleavings. These JVM regressions do not load Android JNI or establish vehicle
decoding. [Build](Build.md#beta24-release) records exact commits, runs, hashes and
all 217 public files; no physical acceptance is implied.

The retained v96 receive-level coverage exercises bounded H.264 probes, both
authenticated offers, cancellation, pre-CONFIG frame ownership and safe video-error
details. At that release, actual Chromium accepted the production helper's local
SDP, while managed-browser policy produced zero host ICE candidates and blocked
RTP playback. A subsequent device capture isolated actual encoder identity from
receive-level admission; v97 addresses that separate selection boundary. The
current full-page desktop RTP checks below use a dedicated ICE-capable test browser
without changing managed machine policy. Actual Android JNI switching, iPhone
source passthrough, native RTP audio, vehicle hardware use and physical continuity
still require device evidence.

The beta.23/v95 AirPlay baseline exercised encrypted SETUP/info/RECORD, independent
type-130 retirement, owner-scoped screen replacement/return, URL audio-only
continuation, late callbacks, photo failures, registry ownership, RAOP refresh and
three-choice consent. It passed 4,321 Android and 568 browser tests, full CI/WASM
reproduction and signed/public verification. Those checks do not establish physical
RAOP/AP2, BLE, trust or vehicle interoperability; [Build](Build.md#beta23-release)
retains that release's provenance.

The v90 AVPlayer migration baseline verified actual Chromium 151 MP4/HLS Canvas,
nonzero URL audio, VOD pause/seek/end/replay, live refresh/fresh-edge resume, SDR
selection, WebVTT language switching and selection/seek. Malformed HLS, nested
proxy resources/redirects and pending-request cancellation were covered, without
video elements, CSP violations or retained URL Workers/AudioContexts. Desktop
video used an explicit software test override, which cannot establish Tesla hardware
use. Native two-track JNI/DTLS-SRTP evidence matched 80 original packets per track;
browser end-to-end RTP remained blocked. Beta.21 skipped its full Android suite;
that historical scope does not qualify the current complete run.

### Desktop RTP integration

An ICE-capable dedicated desktop browser has completed `rtc-canvas.mjs` over real
local RTP for main/Worker Canvas, the compiled `phone-run.mjs` compatibility and
secure-refusal checks, and a full `run.mjs` production-page run. The page receives
synthetic H.264 RTP from a second browser page, while its video DataChannel carries
metadata only. Actual red/blue Canvas pixels and generations 2/3 verify CarPlay →
mirror → CarPlay replacement with authenticated control retained. Worker metadata
stream/chunk, Worker-to-main Canvas and main Processor/Canvas paths, SRP/privacy,
touch/viewport, diagnostics, reconnect, takeover and offline Service Worker/cache
checks pass in the final frozen v99 run, including terminal encoder failure and
compressed-video rejection with control retained. The stock managed-browser
negative run separately exits nonzero with `RTP E2E blocked: no-local-candidates`;
it does not report playback success. These are local desktop results, not a new
cloud full-CI run or published-artifact verification.

The synthetic sender uses browser encoding, not Android's original-compressed-frame
pass-through encoder. These desktop checks do not establish Android JNI selection,
iPhone media interoperability, native RTP audio, vehicle hardware decode, sustained
vehicle load or physical audio/video timing. `rtc-canvas.mjs --local-track` remains
a separate Processor/Canvas diagnostic and cannot substitute for RTP reception.
See the [harness guide](../tests/web-e2e/README.md) for requirements and failure bounds,
and [current deployment](Build.md#current-browser-deployment) for published bytes.

### Current media regression checks

The native sparse bootstrap scenario starts with Baseline allocated, High
negotiated/source/preferred, an initial IDR plus three deltas inside the keyframe
request limit, then source silence. The beta.28 bridge reproduces zero output and
`video-encoder-selection-timeout`. The repaired bridge retries from the idle
poll, selects actual High on the next native initialization and receives a valid
source IDR over RTP after two accepted requests, without changing SDP/profile
admission or extending startup deadlines. The test decoder counts AUs and emits
dummy buffers; one received High AU is not evidence of vehicle render timing.
See the [native probe](../tests/native/README.md) for the persisted scenario.

The [Android native video probe](../tests/native/README.md) runs the exact M150
AAR and compiled product bridge through two native PeerConnections. A software
API28 emulator reproduced queue-block drops with paced input and native suspension
with serial input under default bitrate settings. Higher bitrate admission alone
still suffered queue coalescing. With beta.27's measured configuration of the
production input-completion barrier, 64 Mbps ceiling and one-time 24 Mbps startup
prior, a warmed sender phase produced
180/180 callbacks, 4,190,805 original bytes and matching SHA-256, with zero new
input loss. A low-complexity High-profile phase passed all 180 receiver AUs with
zero RTP packet loss and matching 13,536-byte source/output SHA-256. The heavy
approximately 10 Mbps receiver check remained incomplete on this software
emulator (104/180 frames, 161 lost UDP packets); it is not reported as passed.
An approximately 0.483 Mbps High-profile fixture (181,238 bytes) separately passed
all 180 native RTP receiver AUs with zero packet loss and identical encoded bytes.
Its software receive scheduling skipped three decode callbacks (177); no 180-frame
picture decode/render claim follows from the RTP count.
Warmup and receiver measurements remain separate. The test receiver counts
depacketized AUs and emits dummy I420 buffers;
it does not decode pictures or establish vehicle frame rate. Seven new JVM
concurrency cases cover retained encoded buffers, dependency-loss ordering,
timeout, retirement, interrupt and callback/recovery exceptions.

The working video/control factory uses the custom M150 source-rate transport:
it bypasses native video congestion control and pacing and supplies no sender
bitrate limits. The source is already compressed and cannot be rate-adapted by
the encoder. Native pacer and network-task queues have separate packet and byte
budgets shared across epochs of a transport; pending work from a retired epoch
continues to count until released. Failure is latched per sender epoch and checked
against the current sender, bridge and application generation. This does not bound
all downstream socket buffers; TCP/TURN can have failure semantics that do not
expose every dropped packet.

Exercise reservation release on send, cancellation and retirement, independent
pacer/network limits, retransmission and FEC, sender replacement and stale failure
isolation. A forced-limit native probe checks epoch failure reporting and control
continuity; it does not establish actual network overload recovery. Separately
verify the Android-to-browser renegotiation and first rendered replacement frame,
audio/control continuity, and physical vehicle behavior. A counting decoder or
successful SDP exchange alone does not prove picture correctness.
`BrowserRtcVideoFlowTest` verifies original-byte output, bounded input and distinct
input-loss/keyframe/dependency counters. These Java seam tests do not load Android
JNI or establish vehicle frame continuity. Receiver RTP counters and bridge output
must be compared separately from source cadence and Canvas draws.

The beta.25 vehicle follow-up still recorded 577 input frames, 77 submissions,
45 output callbacks and 32 unencoded releases; 500 later frames waited for a
keyframe. Receiver packet loss/NACK/PLI/FIR were zero, with roughly 2.4 ms average
decode and 0.9–1.4 ms p95 draw time. These establish substantial sender suppression,
but do not identify every native drop reason. Beta.26 addresses the independently
verified congestion-window raw-frame skip path. Twenty targeted JVM regressions
pass, including four new tests of the actual SDK adaptation helper, original
buffer/timestamp preservation, source-drop recovery, pixel rejection and lifecycle
release. They do not load Android JNI or exercise native congestion feedback.

For native audio, a Chromium 156 control received 80 original Opus packets through
the product router/JNI but produced no decoded samples through WebAudio alone.
A detached, permanently muted audio playout anchor starts decoding without adding
another audible path; the existing Worklet still owns mixing and ducking.
`rtc-audio.mjs` checks non-first-slot activation, simultaneous purposes, EOS and
continued music under the production CSP. `rtc-audio-native.mjs` now uses the
actual router, Kotlin/JNI/libdatachannel, all sixteen offered slots and the product
ready barrier. Seventeen source owners force generation two; actual nonzero
Worklet output and old/new anchor cleanup are required. The corrected native run
recorded independent first/replacement-peer peaks of about 0.324 and 0.192.
Muted-element `totalAudioEnergy=0` alone cannot
establish missing decoder output; use decoded samples and actual Worklet samples.

Lifecycle regressions cover rejected/late `play()`, retirement before the ready
microtask and EOS before readiness without cutting the original buffered tail.
These synthetic desktop checks establish a reproducible receive/playout defect
and its source correction, not Android/vehicle interoperability or speaker timing.
Use the [native audio harness instructions](../tests/web-e2e/README.md) to reproduce
the test with an ICE-capable browser and host transport built from pinned sources.

## Browser WASM verification

The current suite uses actual shipped WASM and software decoder Workers for
AAC-LC/ELD/ALAC, exact PCM duration across 8–48 kHz sources, packet/gap boundaries,
EOF draining, cancellation, four-Worker limits and overload. It checks native RTP
metadata and explicitly rejects unnegotiated Opus; NetEq's synthetic Opus/FEC
library tests do not select the product audio path. Worklet tests exercise PCM-NetEq,
shared mixing/ducking, EOS/credit and stale-epoch isolation. Native SCO libsoxr
checks cover Android's separate resampler, not a browser libsoxr runtime.

Use actual Chromium harnesses for software-Worker-to-Worklet output, production
CSP, precompiled modules, nonzero PCM, Service Worker/offline resources and
main/Worker Processor-to-Canvas paths. Frame counters and causal probes remain
separate from main-thread getter values; frozen, jumping or throwing getters
must not alter live PCM. AVPlayer owns URL timing/completion independently.

Historical beta.15/v83 and v89 counts refer to earlier engines, including removed
URL/live controllers. Their targeted CI skips and counts are retained in
[Build](Build.md) and the [historical testing record](https://github.com/uJZk/TiPlay/blob/5c47dd00/docs/Testing.md#browser-wasm-verification).
They are not current coverage or vehicle acceptance. Tesla CPU, output quality,
multistream headroom, acoustic/panel latency and audible clicks remain unverified.
See [WASM boundaries](Browser-wasm.md) and [browser harnesses](../tests/web-e2e/README.md).

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

Run browser unit tests, shared Android pairing/transport tests and applicable
real-PeerConnection harnesses after media changes. SRP vectors use Bouncy Castle
1.79 and cover public values, mutual proofs and SDP HMAC binding. Reject wrong
codes, replay/expired challenges, altered SDP/proofs and retired owners. No HTTP
media/control fallback may bypass authenticated admission.

Protocol checks cover TDR1 fragmentation/credit, audio consumer barriers, control
limits, cancellation and explicit overload/stall recovery. Native queue regressions
hold application RPCs while ACKs drain, preserving authentication, capture order,
audio-lease FIFO and bounded overload evidence. These DataChannel checks do not
establish reliable ordered delivery of current RTP video or its browser decode.

Current live video requires original-codec RTP and MediaStreamTrackProcessor to
Canvas, with no video element, second encoding, encoded-video DataChannel fallback,
live VideoDecoder/pacer or touch catch-up. Verify video-only errors, authenticated
video replacement generations, source/dependency/IDR guards, safe first-frame
ownership and successful Canvas acknowledgement. `run.mjs` now tests the
production RTP page using synthetic H.264 and metadata-only video records; it does
not use a live WebCodecs hardware override or an encoded-video fallback. Only URL
AVPlayer harnesses retain the explicit desktop software-video override. API support
and Canvas submission do not prove hardware use or physical output.

Initial setup must reserve the application m-line through an unpublished data-only
local offer, then update that pending offer with video before external signaling.
Source changes stop every retired video track/transceiver while the application
remains BUNDLE's transport owner. Authenticated offer/answer and
ready barriers must complete over the surviving SCTP control channel before new
metadata/frames are admitted. Check replacement pixels and control progress, not
only a new track event. A terminal codec/processor failure or compressed DataChannel
FRAME reports a video-only error; normal source replacement renegotiates.

The [BUNDLE admission check](../tests/web-e2e/rtc-bundle.mjs) exercises real browser
SDP state, three replacements, one active video receiver and stable application,
ICE and DTLS identities without rewriting SDP. It does not establish an ICE/RTP
path. The actual Android AAR probe must additionally run at least 40 seconds after
replacement: short startup tests miss M150's stale-feedback RTT backoff. The old
video-anchor control decayed to 30 kbps and delivered 1,544/2,400 AUs with zero RTP
packet loss; application-first setup delivered all 2,400 original AUs and retained
adaptive bandwidth. The counting decoder does not establish picture performance.

Missing usable host ICE is a bounded nonzero blocked result, with no local-track
or legacy-media fallback. The new dedicated-browser desktop pass does not imply
that a managed browser with zero candidates has gained connectivity.

Preserve remote diagnostic coverage: independent bounded audio/video reports,
capture/stream/epoch interval baselines, legacy and current production-shaped
fixtures, 256-field wire bounds, anonymous ICE/native metrics, omission accounting,
held-journal-lock races and source PTS/arrival windows. Source cadence excludes
configuration/keepalive and retains repeated/backward/missing references. A field
allowlist does not establish current collection or physical observability.

Resource cases cover owner/route reuse and revocation, redirects/partial manifests,
Range isolation, FCUP deadlines and bounded startup/cleanup evidence. Real JVM
socket fixtures verified approximately ten-second response-header, initial-body
and returned-body expiry. They do not validate Android's actual network timers or
five-second connect expiry. Inline-resource limits, NoData source ordering and
retirement remain independent from the removed custom URL scheduler. AVPlayer
URL tests use its actual pipeline and local resources, not the old scheduler oracle.

Screen-loan regressions cover reentrant borrow/return writes, command/status versus
ownership, event generations, late encrypted replies and bounded pending records.
Returned controller ownership without a main stream triggers the existing two-second
recovery after rechecking owner/session, timely or pending SETUP, settings, browser
readiness and later loans. Socket fixtures cover exact initial-SETUP retries, RTSP
455 for another initial transaction, independent stream SETUP, one event cipher per
verification epoch, port/Worker retirement, blocked writes and close during publication.
A response never grants ownership; stale callbacks cannot stop a successor.

The beta.12 field capture confirmed mirror borrowing with retained control, ownership
return without old-session SETUP, fallback after 2.007 seconds and actual browser draw
after 5.119 seconds through a replacement session. Both URL loans received confirmed
grants before peer TEARDOWN/control EOF after 322/131 ms; subsequent pictures used new
sessions. This proves one recovery path, not seamless return or iPhone internal intent.
The current contract is in [AirPlay](AirPlay.md#carplay-coexistence).

Historical custom-player signal, EOF, watermarks, 96→256 MiB and live PD/Soxr
parameter regressions are [retained in Git](https://github.com/uJZk/TiPlay/blob/5c47dd00/docs/Testing.md#webrtc-integrated-acceptance).
Their executable implementation-specific harnesses were removed with those engines.
The old 180 ms main-thread-pause oracle produced a 115.420 ms 4K audio gap; a slow
video oracle produced 42 gaps in twelve seconds. Those results establish old
scheduling limits, not AVPlayer throughput or vehicle sound. The beta.12 4K field
attempt was not continuous playback, and zero recorded faults in two 360p windows
were not acoustic passes. [Diagnostics](Diagnostics.md#airplay-url-playback-evidence)
keeps the corresponding interpretation boundaries.

Use the [browser harness instructions](../tests/web-e2e/README.md) for real
SRP/ICE/DTLS/SCTP and RTP checks. No usable host candidates is a blocked environment,
not a simulated success. Run the intended vehicle with the official root URL,
Android address and four-digit code. Check wrong-code lockout/new code, reconnect,
replacement owners, explicit disable/disconnect, cached/offline reopen and denied
local-network permission. Exercise large AUs, retransmission, Wi-Fi/hotspot/VPN,
Shizuku aliases, suspend/resume, heat and storage pressure. Reproduce historical
beta.3 reconnect/source-gap scenarios before declaring them resolved.

Confirm actual vehicle hardware decoding and independent source-relative panel/
acoustic output with clock uncertainty. Repeat touch without changing either media
timeline; test source-anchor loss, separate speech/media epochs and verified HFP
startup/loss/restoration. Independent +300 ms live ceilings are requirements, not
current measured/enforced output. Current worklet references are
`unknown`/`independent-audio`; missing source timing cannot become a passed latency
measurement. Physical follow-up remains in [Todo](Todo.md).

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
decoding, pairing or DataChannel delivery. Full-page RTP integration is checked
separately by `run.mjs`; zero-candidate managed browsers still produce a blocked
result rather than inheriting a dedicated-browser pass.

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

The implemented [location flow](Geolocation.md) uses precise Android GPS until the
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

Current live audio uses browser-owned original-codec RTP or the software
PCM/libav.js-to-NetEq path; [Audio tempo](Audio-tempo.md) defines selection,
resampling, EOS/credit and capacity bounds. Opus without native RTP negotiation
fails explicitly. The AudioContext and NetEq graph use 48 kHz. Real libav.js tests
cover exact resampling duration, source timestamp gaps, NoData, cancellation and
finite filter draining. Shared mixer tests cover nonzero PCM, semantic ducking,
stream isolation, endings and 5 ms fade boundaries. Library Opus/FEC tests do not
establish product transport or sound quality.

Worklet frames advance from actual emitted block lengths. Counter discontinuities
remain diagnostic domain changes rather than steering live audio. Exercise variable
render quanta, stale generation/epoch rejection, direct Worker ports, bounded input
credit and retirement while another semantic peer stays audible. Check native-track
and software streams under the same ducking/telephony policy. Synthetic constant
samples and recovery counters alone cannot establish audible continuity.

Use the [E2E harness](../tests/web-e2e/README.md) for production CSP, WASM loading,
actual nonzero Worklet output, native output timestamps, causal probes, main/Worker
Canvas and suspend/resume. Run timing-sensitive harnesses separately from Gradle
or other browser loads; retain the same timing assertions when isolating contention.
Frozen, jumping or unreadable main-thread getters must not steer audio. Output
mapping and probe uncertainty remain diagnostic; `sourceDeadlineState=unknown`
with `independent-audio` does not certify sender-relative or physical output timing.

AVPlayer URL audio owns a separate graph, clocks and synchronization. Check actual
pause/seek/end/replay, buffering, live-edge resume, track changes and teardown rather
than applying removed BufferSource/SoundTouch waveform assertions. A healthy URL
window cannot exclude a live CarPlay defect, and live NetEq tests cannot validate
AVPlayer sound. Their independent device checks remain open.

### Historical live-clock and waveform observations

Earlier beta.13/v79 PD/Soxr regressions independently reproduced double-faded
recovery tails and abrupt voice/media gain changes. The former 0.4000205
single-sample DC gain jump fell to about 0.0016670 with the 5 ms envelope; source
progress, nonzero signals, 44.1→48 kHz conversion and 64–1024-frame blocks were checked.
These old-controller tests do not validate every vehicle click or the current engine.

The beta.13 capture's pure-media window had 38 clock-step recoveries/129.983 seconds
with continuous decoded AAC samples and no renderer-underrun increase. Effective
context/output progress was about 1.4% slower than the performance clock, without
proving an oscillator fault. An independent real-Soxr oracle reproduced phase
recovery from mismatched compensation. Beta.14 then showed four recoveries/55.007
seconds, versus 38/129.983 seconds; content/load/duration differed, so this was not
a controlled acoustic improvement. Its 80.011-second segment retained 1,632 render-fit
resets and 13 native phase-fit resets. These are older controller observations.

An intermediate Chromium 151 experiment observed continuous 128-frame worklet
progress with main getter advances in four-block batches; the old short-pair gate
reset 2,313 times, or 322 times after skipping repeats. The v81 token fence was an
intermediate correction. Current diagnostics use frame counters and causal request/
ACK intervals, while current NetEq timing stays independent. None measures a DAC.
Detailed historical source-deadline/tail/voice-preparation/fit cases and release-local
counts are [retained in Git](https://github.com/uJZk/TiPlay/blob/5c47dd00/docs/Testing.md#media-clock-and-continuous-audio-acceptance).
Retired-controller test coverage is not a current implementation claim.

The independent [ChatGPT clock test](https://ujzk.github.io/TiPlay/chatgpt/) runs
90 seconds of baseline, bounded main-thread load and recovery without importing
TiPlay's playback runtime. It records getter batching, frame progress, causal probe
bounds, visibility/state and optional statistics. Users can mark audible events and
export local JSON or bounded fragment-only QR summaries; nothing uploads automatically.
Unknown timer precision, omitted data or background pauses limit conclusions.

In the user's Tesla 48 kHz standalone run, process-progress intervals included zero:
−49.47…23.43 ms baseline, −43.50…30.90 ms load and −5.13…35.57 ms recovery. Getter
differences were −27.20/+4.97/−5.73 ms; probe RTT P95 was 40.60/43.40/42.00 ms. No
click was heard despite four baseline and two recovery frame discontinuities. This
lightweight graph did not reproduce the production deficit or establish audible
frame-counter faults. Results were transcribed from the vehicle's visible display.
A 44.1 kHz run included three or four very slight load-phase sounds, later clarified
as possibly different from the original CarPlay clicks. Its progress intervals were
34.28…40.28/−46.62…−16.52/−45.91…−8.01 ms, getter differences 48.71/6.18/−0.02 ms
and frame-discontinuity counts 5/2/0. One run per rate cannot establish a rate cause
or exclude production codec/video workload. These are throughput bounds, not DAC timing.

The separate [Cloudflare comparison](Todo.md#cloudflare-workers-audio-comparison)
remains unfinished. Its old Soxr-versus-wasm2js proposal must be reconsidered against
the current NetEq/libav.js implementation; no comparison backend, uploader or vehicle
pass is implied. Browser-owned native RTP is already a negotiated product path.

### Buffered flush and device follow-up

Immediate `FLUSHBUFFERED` has independent before/fix regressions for an old-origin
packet forwarded before a new track anchor. Tests cover the 23-bit sequence ring,
excluded marker, first-retained `until`, equality/wrap, queued/forwarded/capacity-wait
races, old-prefix draining, fence retirement, new sender and pause/anchor reset.
Deferred range cancellation returns RTSP 501 without changing playback. These
protocol tests do not establish sender fallback or physical track changes, nor
explain a continuous pure-media clock window.

For physical acceptance, record source app/iPhone, Android transport, browser/vehicle,
output route and reproduction times. Exercise long music/navigation playback,
bursty/delayed delivery, repeated NetEq stretching, all simultaneous streams,
background/foreground, pause/resume, format/track changes, AirPlay takeover/return
and verified HFP/SCO transitions. Check navigation endings, ducking recovery and
quiet buzz/clicks as well as gaps. Measure source/output events independently;
software timestamp mappings cannot establish speaker sound or panel scanout. Keep
unperformed checks in [Todo](Todo.md#browser-and-carplay-audio).

## Ordinary AirPlay acceptance

[AirPlay](AirPlay.md) records RAOP/AirPlay 2 wire coverage, BLE lifecycle checks and
protocol limits. Before the remote migration, the Chromium notification harness
passed 48 English/Chinese prompts at 320/800 pixels, covering all three choices,
audio/mirror copy, layout and readability. Pure-audio fixtures exercise sender
metadata/artwork, Video.js controls, DACP command delivery and CarPlay hiding;
these synthetic checks do not replace the device checklist below.

URL acceptance uses the actual AVPlayer pipeline and local MP4/HLS resources under
the production CSP. Verify Canvas output without creating video elements, operation
without SharedArrayBuffer, pause/resume, seek, completion, source replacement,
network failure and disposal. The former custom serial-reader and decoder-queue
tests were removed with their implementation. Upstream loader behavior, ignored
Range bandwidth, long playback memory and authenticated iPhone resources still
require integration/device evidence; do not infer those passes from old tests.

Use unprotected content from an actual iPhone. Check discovery and device approval, mirroring, audio-only playback, JPEG/PNG photos, and URL MP4/HLS playback with seeking, subtitles, buffering and iPhone controls. Test stopping/replacing a cast and returning the browser display to CarPlay while retained CarPlay audio continues as designed. Exercise authentication/resource expiry and recovery after network loss.

Check advertised audio codecs in the actual browser: ALAC/AAC-LC/AAC-ELD follow reported libav.js software support; fallback PCM enters NetEq at 48 kHz without WebCodecs audio. Negotiated original codecs use native RTP and the shared mixer; Opus without negotiation must fail explicitly. Verify clear failures when no implemented decoder can handle the format. HDR content is subject to TiPlay's SDR policy. DRM services and apps that prohibit AirPlay are outside acceptance. See [AirPlay](AirPlay.md) for receiver boundaries.

Record Android/device, browser/vehicle firmware, iPhone/iOS, app version, transport, exact steps and remaining failures. Share reviewed diagnostics without pairing codes, keys or personal data. Track outstanding physical validation in [Todo](Todo.md).

## Debug raw capture and car Bluetooth hints

Run the repository workflow checks against the intended source. Browser audio regressions
exercise actual NetEq/worklet code with nonzero PCM, bounded producer lead, EOS
and stream retirement; they also distinguish decoded from rendered output, classify
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

`RawTrafficTest`, `DiagnosticExportStoreTest` and `SessionLogIntegrityTest` cover exact recovery of large binary payloads, byte ranges, unredacted credentials, disabled capture, exclusion of retained raw history from Standard TXT, Debug ZIP stream reconstruction, snapshot stability, PCM/binary extensions, temporary-file cleanup and preservation of interrupted records without preventing later session exports. `DiagnosticLogsTest` covers ignoring persisted Debug values at process initialization and capture configuration. `DiagnosticCaptureClearUiTest` covers the completed-export Clear action; `BrowserMainPageTest` covers the performance hint. `DiagnosticExportFallbackTest` also covers ZIP MIME/extension preservation, distinct share URIs and byte-identical fallback copies. `AirPlayVideoProxyTest` and `BrowserLinkServerTest` verify that the debug policy removes peer URLs, rewrites playlist children and proxies redirects, while Standard retains direct eligibility. The historical custom-player Chromium harness checked Debug proxy switching during playback. The AVPlayer harness verifies nested-resource and redirect proxy-only guards. Switching Debug policy during an actual iPhone session still requires device acceptance.

`BrowserMainPageTest` covers the iPhone Bluetooth audio reminder, missing-permission checklist guidance and state refresh without session recovery. USB queue replay tests capture exact USBMUX/NCM bytes before parsing and preserve a completion after timeout/cancellation. Hardware checks must still confirm Bluetooth/hotspot refresh latency (including quick-settings toggles and return from Android settings), permissions at each supported API level, and USB attach → authorization → re-enumeration → transfer → detach archives.

`CarBluetoothStatusTest` distinguishes unavailable profiles, two empty profiles, the selected iPhone, car-audio device class and unknown/headphone classes. Actual A2DP/HFP broadcasts, OEM car classes, USB hardware transfers, disk throughput under sustained capture and audible car playback still require device verification. Capture covers Android application I/O, not Bluetooth air packets or USB bus signalling.
