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

For browser/media changes, use the applicable [Chromium harness](../tests/web-e2e/README.md): browser link and recovery, real shared-server wiring, URL MP4/HLS playback, still photos under production CSP, or ordinary AirPlay audio. Native AirPlay changes also require `python3 scripts/test_airplay_native.py`. Rebuild generated site outputs with [the Pages workflow](../.github/workflows/pages.yml) when their inputs change.

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
fallback's uncertainty. Audio may be at most 45 ms early and 125 ms late relative to
matching video; filter/device delay belongs inside this window. A dropped/infeasible
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
