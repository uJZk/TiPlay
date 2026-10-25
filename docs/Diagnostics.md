# Diagnostics

Reproduce, note the symptom/time, then **Save diagnostic report** in Android Advanced
settings. Enable **Debug mode** beforehand for timing detail. Reports use
`Downloads/TiPlay`, with an app-owned shareable fallback. Review before sharing;
include phone/APK versions and connection mode. Keep credentials/captures outside Git.

## Monitor and log detail

Open the browser's default-collapsed **Diagnostics** section for connection-stage,
candidate/channel detail and the **Performance monitor** switch. Healthy playback
shows no success message; waiting/recovery and actionable problems stay concise.
These controls are independent of Android Debug
mode and enable no extra capture. The monitor overlay must not change the canvas,
negotiated viewport or touch coordinates. Its fields are:

| Field | Meaning |
| --- | --- |
| Codec | Current video codec; hardware preference does not prove hardware decoding. |
| FPS | Actual successful draws during the last second. |
| Delta | Latest synchronized canvas submission time minus iPhone scheduled presentation time; unavailable without a new synchronized draw within one second. This is not capture-to-display latency. |
| Drops | Explicit browser input, scheduler, transfer-replacement and presentation discards in the current video configuration. It cannot count decoder-internal, network or phone loss. Replacement streams reset it; repeating a configuration does not. |

Debug starts off on a fresh install. Its enabled state is persisted. Restarting Android's
app process restores capture in a new session and shows a dismissible progress dialog
on the main/advanced phone page. Closing it or choosing **Continue in background**
only hides the dialog. **Stop and export** disables the persisted state and saves the
capture; there is no separate Stop action. Advanced settings can reopen progress and
export retained captures after stopping, including retrying a failed save.

Progress shows duration, compressed size and storage failure. Standard redacts
Android/web logs, including older Debug history. Debug also captures full messages
in `android/log`. Legacy head-unit/HUD/vehicle-probe static dumps are omitted.

Raw capture covers iPhone TCP control/encrypted protocol, video, audio, timing, events
and iAP; RFCOMM; browser HTTP headers/query/body before parsing, including rejected
requests; USB discovery/permissions,
descriptors, open/configuration/interface lifecycle, request queue/wait/cancel/close,
control transfers, USBMUX/NCM/CH341, interrupts and failures. Android playback PCM and outbound payload copies are omitted;
the canonical incoming streams and Android/browser diagnostic events remain. USB records
carry connection/request IDs and requested/completed lengths. Asynchronous input is
captured once at completion before parsing, including bytes drained after timeout.
Debug forces AirPlay URL resources through Android and captures response bodies;
disabling restores direct eligibility, reopening active playback on policy changes.
Android owns A2DP/HFP encoding and USB host-controller signalling. Capture cannot
observe Bluetooth air packets, USB bus signalling, unread kernel buffers or packets
lost before application delivery. Capture does not establish speaker playback timing.

The integrated WebRTC path retains bounded stage metrics: Android hub queue,
transport submission to browser record read (including sender queue/network/reassembly),
browser fragment reassembly, complete-record consumer wait, record-read to decode
submission, decode submission to output, decoded output to scheduler/draw and canvas
submission work. Android-to-browser durations retain clock-mapping uncertainty;
quantiles of different stages must not be added. WebCodecs decode duration includes
opaque driver/reference-reorder work, and canvas submission does not measure panel scanout.
These identify where to investigate, without claiming a measured vehicle bottleneck.

Native `stage=control-work` groups record ingress/RPC queue occupancy, high-water
marks, limits, rejected/abandoned work and processing costs by ACK, authentication,
audio lease and application RPC. Queue wait, synchronous raw-capture time, parsing
and application work have separate totals/maxima; active work also retains its
phase and elapsed time. Debug repeats these bounded groups every ten seconds;
retirement preserves them in Standard too. Raw capture remains synchronous and
can still backpressure media through its shared disk writer. Queue isolation does
not establish that a slow or failing disk can sustain lossless capture.

Source-deadline faults request a compact first snapshot; identity churn is merged
within the existing five-second cadence, while cumulative counters remain in
periodic reports. The first-fault and terminal status snapshots have separate
bounded outbox slots so ordinary telemetry cannot overwrite them or consume touch
edge capacity. Terminal evidence is collected before decoder/peer cleanup, with
the current failure reason and known closed-channel label. Logging failure cannot
prevent cleanup. Sending remains best effort: a retired owner or broken connection
can prevent delivery, even when a local snapshot was preserved.

The video diagnostic event has its own Debug-only budget, separate from the ordinary
2 KiB status and audio diagnostics. It records the five additive drop components,
non-additive scheduler reasons and touch subsets, source/read/decoded/draw evidence,
queues and stage timings, safe ICE/control metrics and the native sender snapshot.
Schema, page, non-sensitive stream generation, epoch and sample identity distinguish
successive snapshots. Interval deltas require a matching generation/epoch and
nondecreasing counters; a new capture, stream or epoch starts a baseline instead
of interpreting a reset as loss. Missing fields stay missing. Any budget omission
is reported explicitly, including when the negotiated control-message limit is low.
Counter-scope fields distinguish pipeline-lifetime counters from epoch-reset
counters; rolling stage samples can span epochs. Compare interval deltas within
one identity rather than dividing mixed-scope cumulative totals.

Accepted video snapshots are captured on `browser/video-diagnostics` only for the
current Debug capture. Capture-session checking and journal append are atomic, so
a delayed report cannot enter a new capture after clear/disable. The metadata TXT
also splits the snapshot into short lines with the same sample identity; ordinary
status throttling does not suppress these dedicated snapshots. The event contains
scalar telemetry, not authentication, touch coordinates, location, SDP, addresses,
media bytes or native peer session identifiers. It does not change playback policy.

Receive-thread `Video source:` windows count complete frames, excluding configuration/
keepalives. They retain stream/window identity, cumulative frames, actual FPS,
adjacent PTS steps/missing/repeats/backward steps and complete-frame arrival gaps,
including window boundaries. New streams reset identity/state. Compare source PTS
and monotonic arrival within their own domains; missing PTS stays unknown. Sparse
cadence/PTS steps alone cannot prove loss or malfunction.
`Video source gap:` retains the frame pair and both measurements for each window's
largest PTS/arrival gaps, which may be different pairs. Associate source IDs with
browser generations/epochs through timestamps/input references, never numeric equality.

Video is captured once at iPhone-to-Android input; forwarding adds no payload copy.
RTC references retain capture session, channel, journal sequence/ranges,
decrypt/Annex-B transformation and downstream epoch/sequence. `captureIntegrity`
exposes write failures; uncertain partial writes suppress new exact-range references
until the next capture session. Append does not establish fsync durability.

Capture cannot recover earlier traffic or prove uninstrumented coverage. It stores
application-visible incoming media/protocol bytes, not radio/bus signalling. Debug
omits outgoing payload duplicates and Android playback PCM; USB lifecycle metadata
and browser diagnostic events remain. Input is still captured before parsing.

App-private `logs/raw-traffic-<process-id>.tsv.zst` files use **Zstandard level 3**,
provided by pinned zstd-jni 1.5.7-4 (Android AAR, desktop JNI for tests). A reusable
compressor closes a complete frame on each append flush. No payload queue, sampling,
expiry or rotation is added. TSV fields after decompression remain `epochMillis`,
process-local sequence, channel, byte count and Base64 bytes. Payload chunks are
at most 48 KiB. Full Android/browser diagnostic messages share the journal as
`android/log`. Process-local session IDs and timestamps distinguish restarts.

Compression/encoding/disk writes remain synchronous and can backpressure ingress;
vehicle performance needs measurement. Flush is not fsync. Crashes may interrupt
the last frame; earlier completed frames remain recoverable. New process files avoid
appending after old truncated frames. Integrity counters cover the current process.

Standard exports a redacted `.txt` report with no raw history. Debug exports `.zip`
as a **STORED-only container**; all compressed content uses Zstandard:

- `<report>.txt.zst`: Android/webpage report and redacted rolling metadata,
  compressed at Zstandard level 9.
- `capture.txt.zst`: format instructions and current-process capture integrity,
  compressed at Zstandard level 9.
- `captures/raw-traffic-<process-id>.tsv.zst`: current and retained process journals,
  copied unchanged, without splitting/decompressing/recompressing media.

Use `zstd -dc <file.zst>` to read a journal/report. Reconstruct each channel by
concatenating decoded Base64 payload chunks in file order, respecting capture/start
session boundaries. The old split-stream exporter remains for compatibility tests;
it now packages STORED entries too and performs no DEFLATE compression.

Export snapshots lengths/handles under the capture lock, then copies off-thread
with bounded memory. Storage fallbacks reuse the finished archive. Temporary files
are cleaned, including abandoned ones on restart. Failed exports preserve captures;
saved ZIPs are independent of later recording/clearing.
**Clear captured data** removes all retained process journals and starts a fresh
session if capture is active, preserving saved exports, preferences and metadata logs.
Debug captures contain private media, credentials and identifiers; review before
sharing and keep them out of Git. Disk pressure does not automatically stop capture.


Targeted verification covers 35 shared tests (raw capture, Zstandard round trips,
retained-process export and browser audio routing) and 146 common tests (diagnostics,
redaction, persisted restart state, dismiss/reopen/stop-export dialog and advanced UI).
All pass. The phone Debug APK builds successfully and packages Zstandard JNI for
arm64-v8a, armeabi-v7a, x86 and x86_64. Full CI is intentionally skipped for this change. Android vehicle checks
remain: microphone-active Siri/navigation audibility and echo, real restart dialog,
long-running level-3 CPU/storage cost, screen-off capture and storage exhaustion.

`captureIntegrity.timing` and `RAW_CAPTURE_TIMING` aggregate completed append calls,
lock-wait/append totals and maxima for the current or last capture session, including
failed appends. Append time includes encoding, filesystem work and flush, not just
storage latency. Maxima retain only a fixed source category. Status reads do not take
the journal lock; concurrent values are approximate. New sessions/clear reset them.
No per-packet timing records or payload copies are added. Beta.12 records 63,248
completed calls, 2591.791/12036.083 ms lock-wait/append totals and 11.980/11.737 ms
maxima. Concurrent aggregate times are not exact wall-clock slowdown or attribution
of a particular audio gap. Older captures cannot supply these fields retroactively.

## Browser audio evidence

Clock evidence separates offset, rate, confidence and clock generation. Worklet stream
evidence distinguishes phase error, source-rate confidence, resampling ratio, recovery
reason and network-buffer target. Raw media/source coordinates, relative device-context
time and exported wall-clock event time are different domains: compare them only through
their recorded anchors. A small phase correction must not be classified as a new stream.
Source-supply rate inferred from realtime ingress is weaker evidence than a sender timing
anchor, especially when network queuing changes slowly.

Per-stream source-fit evidence now separates acquiring, tracking, holdover and disabled
states, with a fixed rejection reason, point count, source span, last measured MAD and
Debug-interval rejection count. Insufficient span/points/pairs, excessive noise and
out-of-range rate are distinct; buffered prefetch explicitly disables arrival fitting.
Accepted-fit age uses the render-context clock and is omitted until an acceptance has
been observed in that domain. Missing values remain unknown. Source MAD and device-fit
uncertainty retain six decimal places in milliseconds through browser packing and TXT;
this is printing precision, not nanosecond measurement accuracy. Other numeric precision,
the 16 KiB/256-field budget and reporting frequency remain unchanged. Bounded packing
prioritizes per-stream fit identity/reason before optional detail and reports omissions.

Normal worklet feedback carries the current and observed maximum output-block sizes;
Debug additionally retains `renderQuantumFrames` and its observed minimum/maximum.
Output mapping uses a conservative 128-frame floor and expands for larger observed
blocks. Cross-browser calibration still requires the
[parameter checks](Todo.md#playback-parameter-evidence).
Buffered music logs `stage=ANCHOR` at valid SETRATE and `stage=CLOCK` at actual clock
delivery. The local owner and native generation are separate from browser epochs.
Requested/selected RTP, receiver network NTP, monotonic anchor, one-time reserve,
mapping/fallback method and relay lead support correlation without per-packet logging.

Resource `HTTP_FAILURE` records CONNECT, RESPONSE_HEADERS or RESPONSE_BODY, elapsed
time in that API-call stage, configured connect/read limits, bounded exception types
and whether the cause chain reports a socket timeout. A configured limit does not prove
which OS timer fired. `FCUP_DEADLINE` separates queued and dispatched requests, queue,
exchange and overall ages, and the limiting exchange/overall deadline. Its request ID
and acquisition-time playback owner must not be retagged to a successor. Request IDs
and proxy load IDs are distinct scopes. Healthy reads/dispatches add no extra events;
logger failures cannot interrupt media cleanup or queue progress. These fields contain
no resource URLs, response bodies or arbitrary exception messages.

Device/context rate is recorded separately from Android/browser and source rates, with
its target, confidence and reset generation. Resampling and phase correction use explicit
ppm fields so small corrections remain visible after numeric formatting. Output evidence
includes the native context/performance timestamp pair, its age and feedback distance.
The last feedback's context boundary, age and distance survive later control-clock
samples; a reset clears those anchors. Per-stream context time is the actual last
rendered quantum boundary, and remains unavailable before rendering or after retirement.
Render age uses current context progress and the independent device rate, so accumulated
clock offset cannot make a fresh worklet report appear stale. Report/feedback receipt
ages use the performance clock and remain distinct from that render age.
Native timestamp sampling records the getter's duration and validates the result against
clocks read after it returns. During repeated snapshots or brief measurement noise,
`timestamp-holdover` identifies use of the last validated pair, with its original age and
growing uncertainty. Repeated pairs do not refresh that anchor's lifetime. A held pair
expires after 750 ms, cannot cross a context interruption or detected latency change,
and retains the 1000 ms extrapolation limit; it does not widen either live source deadline.
Audio snapshots repeat their stage in bounded lines so the metadata redactor's line cap
cannot silently remove output-clock fields near the end of a full snapshot.
Unavailable-reason counters distinguish suspended contexts, stale/backward/invalid pairs,
missing or unbounded fallback latency, invalid feedback and excessive extrapolation.
`timestamp-discontinuity` records a fresh native pair contradicting the trusted output
mapping. A single ordered pair cannot establish a pipeline step: confirmation requires
new, coherent, advancing pairs, and pending evidence leaves the output reference unknown.
Neither repeated snapshots nor reordered historical pairs refresh that evidence.

Snapshots preserve recovery reasons (`clock-step`, `underrun`,
`source-deadline`, `network-buffer`, `device-clock-jump`, `clock-generation`,
`suspended`, `sender-deadline`) and `rebufferCount`. Missing fields remain unknown;
Expired fresh PCM remains rejected; every controlled cut fades the last published
sample over 5 ms, overlapping fresh fade-in. CarPlay backlog uses dynamic catch-up
up to 20%: three-second trends guide acceleration; above 200 ms phase error,
pressure blends toward 20% over the next 100 ms, with slew and PCM guards.
SoundTouch preserves pitch; libsoxr only corrects sample rates and clocks.
Decoder `noDataPackets`/`noDataFrames`, count
synthesized mirror silence, not lost packets or measured speaker output. No additional capture is required.

Audio output references remain active in Standard mode; Debug controls detailed
collection only. Video records reference availability and audio/video skew while
continuing its independent presentation timeline. `getOutputTimestamp` establishes
the browser's device-output mapping, not measured sound at vehicle speakers. Its
device latency and the resampler's already-accounted content delay must not be added
twice. Missing/stale output evidence cannot prove sender-relative 300 ms compliance.

Debug records the loaded page's cache identity, decoder backend/frame/nonzero/peak counters,
AudioContext time/state and latency, clock mapping, AudioWorklet heartbeat/age, rendered
frames/nonzero/peak and each stream's epoch, queue bounds, playback time and delay. Capacity
eviction, late/duplicate rejection, playback consumption and reset have separate counters.
These details use a separate bounded control event so video statistics cannot displace them;
an omitted-field count makes a size-limit omission visible. Turning Debug off removes the
details and stops their collection without renegotiating media. Standard keeps processor
failure/recovery changes and concise resource/service failures.
The current capture ID travels with detailed reports; reopening Debug or clearing capture
rejects reports delayed from an earlier capture, even if the control outbox retries them.

`sound=true` means the AudioContext is running. Decoded nonzero PCM establishes content
reaching the queue; rendered nonzero output establishes samples produced by the worklet.
Neither proves sound reached vehicle speakers. A full queue can result from a stopped
worklet or a clock that has not reached its contents: interpret its head/tail/playback
timestamps with heartbeat and discard counters. Debug raw capture also retains the
browser audio records, including codec configuration, resets and decrypted encoded
packets or PCM. DataChannel capture stores each record once under
`browser/audio/rtc/<epoch>/records`; its `events` channel references unsigned record
sequence/bytes and `attempt`, `local-enqueue` or `failed`. Local enqueue means SCTP
accepted the bytes on Android, not remote consumption, decoding or sound. HTTP
`browser/audio` fixtures retain socket-write semantics in factory-free JVM tests;
the Android product disables that media route.

For local log-driven reconstruction, see [Preparing a local CarPlay replay](../tests/web-e2e/README.md#preparing-a-local-carplay-replay). The importer preserves original audio bytes and capture order; Android capture times remain distinct from browser arrival times. JS CPU sampling excludes AudioWorklet, native codec and GPU load.

`Browser transport` records stage, transport epoch, host/UDP candidate counts,
ICE/connection state, safe candidate types, queue/credit counters and decoder
stagnation. State/failure changes are retained immediately in Standard; repeated
healthy details are Debug-limited. Audio consumer barriers prevent old subscriptions
from replaying in-flight audio after re-enable. Independent source-deadline evidence
distinguishes `within-bound`, `violated` and `unknown` measurements; rejected output quanta
are recovery events, not successful playback. Candidate IPs, SDP credentials and
private resource URLs are excluded from these metadata lines.
The audio rejection count is cumulative across page streams/epochs; its state and
stream/epoch identify the current worst active reference. Use Debug stream details
for per-stream attribution. Raw control capture starts at the admitted worker input;
early rejection, overload and retirement can precede it. A zero write-failure count
does not establish a complete SCTP/DTLS packet capture.
Debug also retains incoming DataChannel control once under
`browser/rtc/<epoch>/control/in`, before parsing on the bounded control worker;
the native callback does not perform capture I/O. This has the same unredacted
credential/personal-data boundary as the retained HTTP input capture.
The deadline estimate includes known Android/browser/output/filter uncertainty;
upstream iPhone NTP-anchor uncertainty is not separately carried on the wire.
`within-bound` therefore describes this software mapping, not a physical latency certificate.

AudioWorklet uses precompiled libsoxr/audio-core WASM with private fixed memories.
For silence, check module/processor errors, recoveries and rendered samples.
Raw `contextTimeMs` is diagnostic-only; `renderReportAgeMs` measures receipt age.
Getter disagreement cannot establish `renderAgeMs`, which remains unknown.
See [WASM and clock boundaries](Browser-wasm.md#audio-clock-roles).

Shared mixing repairs double-faded tails and abrupt ducking with the existing 5 ms
fade. URL audio has a separate graph; see [waveform verification](Testing.md#media-clock-and-continuous-audio-acceptance).

Device, browser/Android and source rates describe different mappings.
`deviceClockSource` selects fresh accepted `native` output, then fresh accepted
`render` progress, then frozen `holdover`. Both fits share bounded estimation and
one applied-rate controller. Native phase changes preserve independent render
evidence. Frame/probe intervals measure render progress, not physical oscillator
rate. `deviceClockAcceptedFitAgeMs`, `deviceClockFitRejected`,
`deviceClockFitStatus` and `deviceClockFitRejectReason` describe selected evidence;
unknown age stays absent. Holdover need not mean nominal rate.
Debug `deviceClockFitDispersionMs` is attempted raw MAD; accepted
`deviceClockUncertaintyMs` includes selected frame/probe uncertainty. Unknown attempt
noise stays absent after Debug activation/reset. Six decimals preserve evidence,
not accuracy. See [fit bounds](Testing.md#media-clock-and-continuous-audio-acceptance).
`outputTimestampFitUncertaintyMs`, `outputTimestampFitStatus` and
`outputTimestampFitGeneration` separately retain native phase-fit evidence. Its MAD
uses context milliseconds, converted before performance-clock comparisons; render
MAD cannot widen native phase gates. Reference/worklet extrapolation reserves rate
uncertainty over the actual distance. Context replacement/suspend/sample-domain changes
resets the sample domain; confirmed observation gaps retain nominal-reset/reacquisition
behavior. Native phase reacquisition still requires two
advancing pairs and retains its freshness/holdover limits.
Debug `renderClockDomainGeneration`/`renderClockDomainChanges` identify worklet-confirmed
sample continuity. `renderClockProbeState`/`renderClockProbeAgeMs` show pending
request/ACK probes; `renderClockProbeAccepted`, `renderClockProbeRejected` and
`renderClockProbeReason` distinguish admission, expiry and invalid/run-external proof.
Validated generation/frame frontiers enter the history on initial acquisition too;
their causal interval spans request to ACK plus the reported render block, rather
than treating ACK receipt as an exact sample time. Counters restart with Debug;
unknown age stays absent. No per-quantum logging is added.
Debug `contextObservedStateChanges`/`contextObservedNonRunningMs` retain observed
transitions/non-running time between snapshots. Delayed/coalesced events may hide
transitions; these counters cannot certify uninterrupted output.
Voice Debug `voicePreparationState` distinguishes `idle`, `waiting-clock`,
`waiting-data`, `waiting-deadline`, `priming`, `waiting-reserve`, `ready` and `playing`.
`voicePreparedFrames`/`voiceRequiredFrames` count output PCM frames; `voiceWaitMs`
measures elapsed projected output-clock time, not acoustic delay. Read these with
existing stream/source identity and state/reason. These bounded scalars add no PCM
capture and do not enter Standard summaries.
For CarPlay clock-step recovery, `lastClockStepPhaseErrorMs`,
`lastClockStepDeviceRatePpm` and `lastClockStepUncertaintyMs` retain the signed phase,
device-rate estimate and uncertainty before recovery. Compare stream identity and
cumulative count: current phase may already look healthy. `lastClockStepAgeMs` uses
the AudioContext clock, excluding suspension. Unknown values stay absent; a new
timeline clears the slot. No per-step reports or PCM collection are added.
A recovery establishes a software discontinuity, not every click's cause. Healthy
URL playback cannot exclude a CarPlay live-audio fault.
Debug `lastSourceDeadlineDeltaUpperMs`, `lastSourceDeadlineUncertaintyMs`,
`lastSourceDeadlineLimitMs` and `lastSourceDeadlineAgeMs` retain the actual rejection
before recovery; healthy current output cannot erase it. A new Debug interval/timeline
clears the slot. Worklet reports require the current playback generation and Debug
revision; reset immediately clears cached metrics. Pure idle emits no samples and
cannot fabricate deadline faults; actual tails and zero-valued PCM remain checked.
Retired tails use the same deadline guard. Debug retains
`lastRetiredSourceDeadlineEpoch`, `lastRetiredSourceDeadlineGeneration`,
`lastRetiredSourceDeadlineDeltaUpperMs`, `lastRetiredSourceDeadlineUncertaintyMs`,
`lastRetiredSourceDeadlineLimitMs`, `lastRetiredSourceDeadlineAgeMs` and
`retiredSourceDeadlineRejectedFrames` separately from active-stream evidence.
The bounded scalar slot identifies the old epoch; Debug/reset clears it and missing
timing remains unknown. Rejection prevents expired sound, not a proven steady-click cause.

Beta.12/v78 excludes retained beta.11 records and first-snapshot totals. Its two
CarPlay clock-step recoveries/55.019 s versus beta.11's 188/730.046 s have different
sources/load and cannot establish acoustic improvement. Mirror underruns rise
116→618 render-quanta, not 502 pops. Continuous source coordinates coexist with
260 ms incoming/265 ms send-attempt gaps; all nine NoData units precede that window.
iPhone/network, receive scheduling and capture interference remain unseparated.
Renderer counters reach 28/1194.648 ms at 28.850–33.856 s, remaining unchanged through
253.856 s despite context progress. Seven of fifty native timestamps are over
20 ms ahead (maximum 98.2 ms), without proving direct acceptance. Observed blocks
are 128 frames. Reference decoding of 6,088 packets/5,401,600 frames finds no decode,
non-finite or over-full-scale errors. No observed source-deadline rejection explains
absent trigger fields. None of this measures physical output or one universal click cause.
The shared `AudioContext.playbackStats` reader supplies `renderStatsState`,
`renderUnderrunEvents`, `renderUnderrunDurationMs` and `renderTotalDurationMs` for
live Debug and URL `ENGINE_RENDER`. Unavailable/invalid/failed states retain unknown
counts, never fabricated zeros. Available means readable, not fresh: the
[API](https://webaudio.github.io/web-audio-api/#AudioPlaybackStats) updates about once
per second subject to visibility/activity rules. Context-lifetime deltas distinguish
browser rendering underruns from application scheduling gaps; they do not measure
speakers. No permission, experimental flag, reset or extra sampling timer is used.
Per-stream `senderTimingState` distinguishes `unavailable`, `mapped-presentation` and
`arrival-anchored-unverified`; compare its source deadline, policy ceiling and startup
delay. A mirror stream that initially lacks an anchor can upgrade only from a proven
decode/sample correspondence, preserving its consumed sample progress. That upgrade
does not authorize replay of old PCM or bypass the source deadline.

For uneven dragging with high FPS and unchanged drops, compare `video.frameIntervalP95Ms`,
`video.frameIntervalMaxMs`, `video.lastDrawAgeMs`, `video.decodeMsP95`, `video.drawMsP95`
and `control.rttMsP95`. These fields distinguish irregular picture delivery/submission
from slow serial input requests. `pacingDroppedFrames` counts superseded pending decoded
pictures; it does not count source/network loss or prove actual panel presentation.
The bounded status summary prioritizes these fields; per-stream audio retains its own
separate diagnostic budget.

The video stages have distinct observable boundaries:

| Evidence | What it measures |
| --- | --- |
| Captured Android AU/PTS, `readFrameIntervalMsP95` / `readFrameIntervalMsMax` | Source picture cadence and browser read cadence; the maximum retains a sparse pause hidden by P95. Debug capture timestamps describe the recorded Android input, not exact radio/kernel arrival. |
| `recordReadToDecodeSubmitMsP95` | Application admission wait before decoder submission. |
| `decodeMsP95`, `decodeOldestInFlightMs` | Submit-to-output-callback residence and the oldest currently outstanding submission. Residence includes opaque decoder queueing, reordering, execution and callback scheduling. Idle oldest age stays unknown. |
| `decoderStatsAgeMs` | Age of the actual decoder snapshot, including Worker-to-main message delay. Old stream/epoch snapshots cannot refresh it; internal clock timestamps are not logged. |
| Output-to-draw, draw intervals, cursor/target convergence | Application presentation wait, drawing cadence and whether actual buffering has reached the requested target. Canvas submission does not prove GPU/panel presentation. |

Browser samples and uploads remain bounded snapshots and rolling aggregates, not an
exact replay of every frame at each visible pause. `stageSampleScope` explicitly
retains the rolling-window scope, which may span epochs. Transport-submit to browser
read also includes transport, reassembly and consumer scheduling, not pure network
time. WebCodecs exposes neither separate internal queue/execution timings nor the
actual hardware implementation. A `prefer-hardware` request or support query is not
proof of hardware decode; Android phone MediaCodec evidence cannot establish the
car browser's path. Those questions require performance evidence from the device
running that browser. Unknown measurements must remain unknown.

For a video-stutter reproduction, enable Debug before starting the browser session,
keep one viewport size, include a short static interval followed by continuous
scrolling/animation, and note the visible pause time. Wait about ten seconds after
the pause before exporting, so the next diagnostic window is included. Changing
the viewport can restart the source and reset per-epoch drop counters; report that
separately from an interrupted RTC connection.

Service diagnostics distinguish missing permission from foreground eligibility; a granted
microphone permission alone does not establish permission to start microphone capture
in the background.

Debug raw `iphone/carplay-screen-loan/events` retains sparse fixed-schema `STATE`,
screen-data boundaries, screen-command `COMMAND` events and one `CLOSE` per local
`connectionId`. Command evidence records event generation/CSeq, borrow/return,
elapsed time, RTSP status and plist command status separately. REQUEST, WRITTEN,
RESPONSE, TIMEOUT, CAPACITY, CANCELLED and WRITE_FAILED are local boundaries;
ACCEPTED/REJECTED/UNKNOWN describe command results, never a resource grant.
The five-second deadline and 16 pending-record cap bound the response tracker; idle event
read timeouts do not close the control/audio session or discard partial ciphertext.
These details do not enter product status text. Compare desired/sent,
actual owner, pending, `confirmedBorrow` and `carPlayHasScreen`; a sent request is not
a grant. Close reasons distinguish known control/event EOF and failures; `UNSPECIFIED`
does not assert a peer failure. The channel contains no sender identity or plist.
Capture-session checks reject stale events. Screen availability distinguishes ownership
from installed/ended data streams. In beta.12, mirror borrowing preserves control;
after Controller confirms return, no new SETUP arrives on that session. The bounded
fallback starts 2.007 seconds later with `SCREEN_RETURN_WITHOUT_STREAM`; new-session
SETUP/data and browser draw acknowledgement prove recovery after 5.119 seconds.
This is recovery with retained wireless transport, not seamless old-stream return.
Two URL grants are followed by peer TEARDOWN/control EOF after 322/131 ms; later
CarPlay pictures belong to new sessions. Successful borrowing and preserved control
are separate findings. The iPhone icon is user observation; neither its absence nor
EOF identifies iOS's internal reason. Older captures cannot gain new boundaries.

### CarPlay capture replay evidence

A beta.16/code58, v84 capture contains 45,604 locally enqueued audio records and
192 audio diagnostic samples, without observed capture failure. Enqueue does not prove receipt.

Sequential 30-second Chromium 151 desktop replays use original AAC/Opus bytes and
Android send spacing, 48 kHz output and a fixed reconstructed clock. Recorded CPU
as a percentage of one logical core:

| Component | Music, Debug | Music/navigation, Debug | Same mixed clip, Standard |
| --- | ---: | ---: | ---: |
| Main thread | 1.74–1.76% | 2.21–2.23% | 2.15–2.16% |
| AudioWorklet thread | 3.00% | 3.46% | 3.73% |
| Native audio-decoder tasks | 0.14% | 0.37% | 0.39% |

Trace/profiler overhead is included; single-run differences do not establish Debug
cost. Video/UI, target network and vehicle CPU are unmeasured. The original capture
reports zero browser-render underruns but 264 render-clock domain changes and 2,798
output-timestamp invalidations. The mixed replay reproduces navigation queue
underruns and repeated source-deadline recovery, without renderer underruns; this
is a diagnostic phenotype, not acoustic proof of the reported crackle.

At 08:21:16.710 +0800 the screen loan is requested, ownership is confirmed at
16.728, and the original connection reports peer EOF at 17.074. A successor gets
controller ownership and main-screen SETUP at 08:21:47.816/.846. No unborrow command
appears, so this capture establishes borrowing and replacement-session recovery,
not successful return on the original connection. The 19 isolated ownership-state
tests pass; full Android CI remains blocked by Gradle distribution access.

## Live video policy evidence

CarPlay and AirPlay mirroring use the actual scheduling owner's read-only policy
snapshot. `playbackProfile` identifies the applied video plan, not a newly inferred
profile after an idle hold expires. The getter does not change scheduling, clock
selection or audio. These fields accompany the existing browser reports, normally
about five seconds apart; they are not snapshots taken at every capacity eviction.

| Fields | Interpretation |
| --- | --- |
| `policyVideoReadinessMs`, `policyVideoMarginMs`, `policyVideoTargetMs`, `policyTargetReason` | Observed/decayed readiness, actual used margin and the applied plan's target. Reasons are `initial`, `touch`, `readiness`, `initial-floor` or `ceiling`. Unobserved readiness/margin stays missing. |
| `policyVideoPlanFromMs`, `policyVideoPlanDurationMs`, `policyVideoPlanRemainingMs`, `policyVideoLeadRemainingMs` | Plan origin and convergence duration/remaining time, with the initial lead wait reported separately. During that wait, convergence remaining can still equal its full duration. These are not the current cursor delay; compare `videoCursorDeltaMs` and `videoCursorSpeed`. |
| `policyInteractionActive`, `policyHoldRemainingMs` | Physical interaction state versus remaining activity hold. Active interaction can remain true with zero hold remaining; release and applied-profile expiry are separate observations. |
| `policyInteractionStarts`, `policyInteractionReleases`, `policyProfileSwitches`, `policyPlanChanges` | Cumulative timing-owner counts that survive its stream/epoch resets. They preserve short transitions between reports without logging each move; a new owner starts a new baseline. |
| `policyMaxDelayMs`, `policyMaxVideoFrames`, `policyMaxVideoBytes`, `policySubmitMarginMs` | Applied policy capacities and submission reservation. Frame/byte limits describe application decoded-picture queues, not vendor pools or measured GPU use. |

For live video, the target formula reserves the existing 20 ms submission allowance
once from the 300 ms software limit, giving a maximum target of 280 ms. Submission
scheduling uses the allowance already represented by that plan; do not subtract
another 20 ms when interpreting it. CarPlay touch forces the video target to zero.
The profile's 8 ms margin is not used in that target formula: the actual used margin
is zero. Neither zero target nor the configured 20/30 ms ordinary/mirror margins
establish zero latency or empirically optimal tuning. Touch affects video only.

`sourceClockState` (`fresh`, `stale`, `unavailable`), `sourceClockAgeMs`,
`sourceClockGeneration` and `sourceClockMaxAgeMs` describe the mapping available to the
decoder. The same 15-second freshness rule governs presentation mapping; uncertainty
remains in `stageClockUncertaintyMs`. A fresh clock alone does not establish that a
particular picture has valid source timing. Untimed scheduled pictures cannot be
counted as verified source-relative 300 ms compliance.

The main control estimator reports a different boundary:
`clockEstimatorObservationAgeMs` is the age of its last RTT-valid observation;
`clockEstimatorSelectedAgeMs` is the age of the selected mapping anchor.
`clockEstimatorState` distinguishes `unavailable`, `suspended`, `pending-jump`,
`observation-stale`, `selected-stale` and `fresh`. Missing ages stay unknown, not zero.
Continuing clock replies can coexist with an old selected anchor. `selected-stale`
is a derived state, not proof of one particular RTT-filter rejection or a stopped
main thread. Compare estimator evidence with the decoder's mapping rather than
renaming an old mapping timestamp as a gap in clock probes.
When the historical low-RTT fit selects an anchor older than 15 seconds, the
estimator can select real observations from the last 15 seconds whose midpoints
agree with the existing mapping's software error estimate. It recomputes the
selected anchor and uncertainty from those observations, preserving the learned
rate when their span cannot support a new rate fit. This estimate is not a
statistical confidence interval and does not grow with anchor age to force
recovery. Inconsistent or missing observations still leave mapping unavailable;
pending clock jumps, suspension and stream generations retain their guards.

Standard `Browser transport: stage=POLICY` preserves observed profile/interaction
counter changes, capacity-drop increases and clock-validity boundaries, and can
accompany existing transport/failure boundaries. Healthy periodic detail remains
Debug-only. Plan changes, ages and each move do not create per-frame Standard logs.
The ordinary bounded status prioritizes core policy evidence; complete plan fields
can require Debug. An allowlist entry does not guarantee that a budgeted payload
contains it; check omission counts and keep absent fields unknown.

Earlier captures show mirror reads/draws advancing without additive drops and
CarPlay capacity/pacing replacements. A 64 MiB budget admits four coded pictures;
queued pictures explain differing stage counts. Sparse PTS, stale mapping and
untimed pictures prevent latency attribution or validation of touch hold/catch-up.

Beta.7/v73 returned to waiting without an observed browser-process crash. Media
ACKs stopped amid control RPCs and 12–17 detailed reports/second; `timeout` and
`control-overload` exposed shared-executor interference. ACKs were 95.1% of processed
messages. Control-queue isolation and bounded diagnostics address that path;
zero decode errors and Worker capture times cannot identify decoder failure,
prove browser transmission or separate queue/raw-write/callback costs.

Beta.9/v75 has one touch window overlapping a +38 ms phase recovery despite queued
audio and an unchanged 20 ms target; other touch windows do not. Synthetic Worklet
controls reproduce one ordered output-timestamp outlier causing two recoveries,
proving a software failure path rather than every click's cause. Getter duration,
render-report age and main-thread-stall evidence remain separate.

Historical mirror reconciliation finds 2,504 ordinary/297 NoData units in 2,801
continuous RTP units. Pre-order filtering created a 206.8 ms hole from 19 silence
units and refiltered resends. Response counts cannot measure uncaptured requests;
continuous records cannot prove AAC sample continuity. Interpret underruns/deadlines
with source coordinates and explicit silence.

## AirPlay URL playback evidence

Beta.12 contains one 3840×2160 AV1 attempt and two 640×360 attempts. The user confirms
non-continuous 4K playback: 26 underruns/3.055517 s of gaps cannot explain steady-playback
clicks. Zero scheduling/renderer underruns at 360p do not prove clean sound. Its
96 MiB budget holds one retained/two queued 4K pictures; `video-budget` starts with
about 92 ms video despite three seconds of PCM. Shared-rAF audio submission remains
bounded by common continuous A/V coverage and 500 ms. Pending reads cannot separate
codec, resource/demux and main-thread costs; `no-preference`/unsupported probes leave
actual decoding unknown.
With that historical 96 MiB budget, a synthetic 180 ms main-thread pause creates
a 115.420 ms 4K audio gap (none at 360p); slow video creates 42 gaps in 12 s within
decoded coverage. These measure scheduling, not codec speed or sound. Audio-master
was rejected because video can fall unboundedly behind; a 15 s single-read watchdog
cannot detect continuous slow progress. Current budgeting is 256 MiB; these baselines
do not validate it. Synchronization/horizon remain unchanged; see
[follow-up](Todo.md#ordinary-airplay).

Beta.10 MiniBili/another URL reached playing after 10.411/16.779 s; buffering appeared
at 8.903/12.490 s during paused preparation. The immediate indicator covers
resource/import/decode preparation; neither startup nor `video-budget` guarantees
750 ms end-to-end readiness.

Beta.9 MiniBili reached CDN 206 without a demonstrated UA/Referer failure. A
123,248-byte WebVTT became a ~164k-character `data:` URL and blocked serial FCUP
on unanswered 10 s waits. Local `INLINE_DATA` handling avoids that exchange without
proving CDN risk control, iPhone size limits or universal playback.

URL casting has its own media engine and AudioContext. CarPlay/mirror audio telemetry
does not establish that this context is running. Compare playback ID, command revision
and engine generation before interpreting successive snapshots. A settled old command
keeps its revision without acquiring a newer engine's snapshot; retired/inactive players
cannot report a current engine. `ready`, play intent, `loadedmetadata` and
`readyState=3` do not establish actual `playing`, a resolved play promise or an advancing
media clock. A pending AudioContext resume can leave decoded media ready while position
stays at a seek target.

Earlier URL regression inputs exposed sample loss/repetition in packet trimming and
partial scheduling; their fixes preserve the existing sample-identity contract.
Actual `playing` with advancing context time differs from readiness without progress.
Neither planned continuity nor browser rendering establishes acoustic output or
excludes discontinuities in the source.

The bounded engine snapshot is split into fixed groups so the metadata line limit does
not silently discard the later fields:

| Group | Evidence |
| --- | --- |
| `ENGINE_STATE` | Playing intent versus running clock, wait reason, AudioContext state/resume pending, clock anchor and stall elapsed/count. |
| `ENGINE_BUFFER` | Position, playable/per-track ends, scheduled audio end, limiting track, target/time capacities, startup decision and read-progress fallback count. |
| `ENGINE_PIPELINE` | Queue counts/bytes, frame/byte capacities, pending sink reads, budget blocking and end-of-stream flags. |
| `ENGINE_CODEC` | Validated complete short codec/profile token, coded/display dimensions, observed sample cadence/duration, support probe and requested hardware/latency hints. |
| `ENGINE_OWNERSHIP` | Retained sample generation, held/pending/total application-owned samples and estimated bytes; received/closed samples, pending video-read age and last sample age. |
| `ENGINE_AUDIO` | Resume counts, activation/gesture state, context latency hint and available URL-context base/output latency and output-clock estimates. |
| `ENGINE_NETWORK` | Serialized resource-reader activity/queue, byte progress and its age, timeouts/cancellations, backward restarts, ignored ranges and safe last status/result. |
| `ENGINE_PCM` | Decoded source rate/channels, requested and actual context rates, decoded frames and separate seek/overlap trims. |
| `ENGINE_CONTINUITY` | Subsample timestamp alignment count/max correction, inserted silence, source PCM peak, over-full-scale and non-finite sample counts. |
| `ENGINE_RENDER` | Shared feature-detected browser-render underrun count/duration and observed context duration; unsupported remains unknown. |
| `ENGINE_STARTUP` | Fixed preparation phase and browser monotonic elapsed milliseconds; total preparation time freezes at first actual playing. |
| `ENGINE_SCHEDULE` | Submitted frames, node-time gaps/overlaps, late starts, uncovered graph intervals/count/total/max duration and rebuffer stops. |

`startupPhase` distinguishes dependencies, video/audio selection, alternate audio-menu
discovery, metadata, first samples and ready/playing. `openElapsedMs` starts at the
engine's source preparation, after the controls' initial resource probe; it includes
pause/activation waits, but not that probe or the outer player import. `phaseElapsedMs` describes the current
phase, not a retained history of every completed phase. Source replacement starts a
new measurement; later seeks cannot reset a completed startup. Compare `probe-start`,
`probe-ready`, `loadedmetadata`, `seeked`, `playing` and `play-resolved` to identify
the remaining boundaries. Android receipt times include control transport and capture
admission; they are not browser event timestamps or the sender's original send time.

`audioScheduleUnderruns`, `audioScheduleUnderrunMs` and
`audioScheduleUnderrunMaxMs` describe observed gaps between submitted audio nodes,
including recovery after rebuffering. `audioRebufferStops` counts playback-policy
interruptions while an audio clock is needed; user pause/seek does not increment it.
These counters cover gaps previously hidden by clearing the node tail on freeze.
They do not measure the device audio renderer or prove an audible click. In particular,
zero counters cannot exclude an output-device discontinuity. `audioBaseLatencyMs`,
`audioOutputLatencyMs`, `audioOutputTimestampAgeMs` and `audioOutputContextLagMs`
refer to the current URL AudioContext only. `audioOutputTimestampState` distinguishes
unavailable/closed/format-mismatch/startup/invalid/future/context-ahead/valid/failed;
finite age/lag remain signed even for future or context-ahead results. Unsupported
coordinates stay absent. These diagnostics do not drive scheduling or measure the
speaker; do not substitute another context's values. A late scheduler uses one mapping
for subsequent nodes and video, preserving source sample order without starting
overdue slices together; already elapsed silence cannot be recovered. The later
context-clock reading supplies a schedule-order estimate.
`audioSubmitUncertaintyMaxMs` reports maximum observed nonnegative request/getter
separation; it cannot bound native start or establish getter freshness. These
requested node times do not measure physical output. URL EOF requires natural
completion of every current-owner source before clearing the tail. Cancelled
callbacks cannot authorize successor completion; sealed source coverage survives
empty rebuffer boundaries. Natural completion proves graph processing, without
measuring speaker time.

Semantic media/command edges remain visible. Engine-state changes are sampled from
progress/timeupdate events with a 250 ms minimum interval; an unchanged snapshot with
play intent but no running clock repeats at most every five seconds, and healthy state
at most every ten seconds. Android applies a further unchanged-state deduplication.
Standard, the default mode, retains semantic media/command edges, preparation-phase
boundaries, failures and explicit `stalled=true` evidence. Changes to overlap trimming,
inserted silence, scheduling gaps/overlaps, underruns, rebuffer stops, late starts or invalid/over-full-scale PCM also admit a bounded
continuity snapshot at most every five seconds. Silence can be a legitimate track
offset; it is not an error label. Normal decoded/scheduled growth, seek trimming
and subsample alignment alone do not trigger extra Standard reports. One recovery
snapshot can follow an accepted stall only for
the same playback ID, revision and generation; source replacement is not recovery of
that identity. Unchanged healthy detail is Debug-only. These are sampling
intervals when events execute, not an independent watchdog: a blocked browser main
thread cannot emit a timely snapshot. Group lines carry the same identity, and missing
fields remain unknown rather than becoming zero or false.

An engine failure preserves an immutable snapshot before cleanup, including the
available codec token, requested hints, known dimensions, original play intent, queues and
context state. The error event carries this snapshot; a separate post-cleanup snapshot
reports actual application ownership and successful closes. A canvas-retained picture
can legitimately leave one held sample after queue/decoder cleanup; it must not be
reported as zero until that picture is closed. Both snapshots use the same bounded
schema and retain unknown fields as unknown.

Standard retains `error`, `open-error`, `canvas-error` and `play-rejected` failure
edges, the first terminal error snapshot and one changed cleanup snapshot after the
fault without the ordinary 250 ms gate. Repeated identical terminal states, or changes
only to clock values, remain limited to five seconds. An error state is never reported
as recovery of a prior stall. These observations describe application cleanup, not
vendor-internal decoder outputs or physical surface release.

Read `waitReason` with both track coverage and context state. Suspended/resuming audio,
startup/recovery watermarks, a timeline gap and a starved track are different causes
of a stopped clock. Smaller decoded queues do not prove network starvation; a reader
can stop requesting because its consumer has stopped pulling. A fallback based on
pending-read age does not identify hardware pool exhaustion. The
[URL engine limits](AirPlay.md#url-engine-and-captions) are separate application
budgets, not a total GPU or network-memory measurement.
`resourceBytes` is the serialized reader's cumulative response-body bytes read,
including rereads; it is neither unique media coverage nor bytes consumed by the
decoder. Network progress and last-result fields cannot measure decoder-internal
work or audio reaching the speakers. `resourceLastStatus=0` means no recorded response
status; actual HTTP statuses are restricted to 100–599.

PCM level counters inspect the decoded source, before context mixing, gain and
device conversion. Scheduling continuity compares planned node times and submitted
sample counts; it does not record the browser's final mixed PCM or prove speaker
output. Unknown context/source rates remain unknown. Local continuous-tone and
sample-identity inputs reproduce the old packet-trim and partial-node defects;
native OfflineAudioContext rendering separately checks node/resampler continuity
against an independent whole-buffer reference.

Codec support and `requestedHardwareAcceleration` describe negotiation/requested
configuration. They do not identify the actual decoder backend;
`actualHardware`, `poolCapacity` and `vendorBuffers` remain explicitly unknown. Sample cadence and
`samplesReceived` describe samples delivered to the application sink. `samplesClosed`
counts successful first application closes; neither counter observes all vendor
decoder outputs or physical GPU-surface release. These two counters span the engine
lifetime, while video queue counts describe the active generation. Held/pending/owned
counts can include a picture retained across generation changes; use
`videoHeldGeneration` rather than attributing it to the new queue. Estimated video bytes use coded
RGBA8-equivalent size. They exclude vendor/reference buffers and rendering allocations;
application receipt/close cannot establish that an internal buffer leak is absent.

Finite-surface tests reproduce startup deadlock from requesting another sample before
recognizing capacity; suspended-context replay separately reproduces readiness without
progress until a real Play action. Neither measures vehicle pool capacity or uniquely
explains field readiness without those observations. Complete upstream responses do
not prove final browser delivery.

Resource diagnostics distinguish Android HTTP from iPhone FCUP, preserve upstream status
and report bounded denial details in Debug. Resource I/O failures retain bounded
exception classes, excluding exception messages and private URLs.
`LOADED phase=headers-ready delivery=unproven` is an upstream milestone.
For HTTP, it means response headers are available; FCUP may already have a buffered
body. It proves neither completion of the browser-facing transfer nor decode or
playback. `OPEN_END` joins the browser handler's request to the proxy load and safe
resource identity. Successful opens are Debug-only; `phase=open failed=true` retains
open failures in Standard with safe exception classes and upstream status when known.
`BROWSER_DIRECT` establishes the native 307 redirect only; Android cannot establish
completion of the browser's subsequent direct request.
`REFUSED` records rejected admission by a fixed reason: repeated refusals are limited
to one line per reason per five seconds, with total/suppressed counters instead of
untrusted URLs or token values.

Each admitted body transfer has one `TRANSFER_END`, with request/load,
playback/resource/revision identity, route/status, phase/reason, owner, EOF and safe
exception classes. Matching `TRANSFER_BYTES` and `TRANSFER_TIMING` lines preserve
accounting and timing separately. Successful complete 2xx EOF terminal groups are Debug-only; failures,
short EOF, cancellation, retirement and close failures remain in Standard. No
per-chunk metadata log is added.

`expectedBytes` comes from a valid Content-Length and may be unknown. `readBytes`
counts body bytes returned by resource reads; `writtenBytes` counts body bytes in
output-write calls that returned successfully. Header bytes are excluded. A throwing
write may have partially accepted its input: `writeUnknownBytes` is that call's
unresolved byte-count upper bound, not a measured accepted or lost byte count.
`writeAccounting=completed-calls` states this boundary. Even successful writes prove
only local submission, not browser receipt or consumption. A socket error alone does
not prove user cancellation; `cancel=UNKNOWN` preserves that distinction.

Timing scopes overlap and must not be added. `headersMs` measures an upstream HTTP
hop until response headers; open/transfer summaries retain the final upstream hop.
FCUP has no separately observed header time, so it remains
unknown. `responseMs` is that HTTP header wait or the FCUP exchange until its buffered
response. `openMs` spans resource preparation, potentially including redirects, FCUP
and playlist reads/rewriting. `requestMs` starts at browser handler entry, not at the
browser's original fetch call. In `TRANSFER_TIMING scope=handler`, `transferMs` covers
header/body writes and resource close after open; it excludes resource-open time.
These stages establish local progress and failure boundaries, not end-to-end network
throughput or browser consumption.

## Reading wireless startup evidence

| Milestone | What it establishes |
| --- | --- |
| `authenticated`, `wifiConfigs`, `startRequests` | Bluetooth authentication and sent configuration/start messages; sending does not prove iPhone acceptance. |
| `wireless endpoint`, address-family flags | Selected interface family, listener port, channel and security; address literals are omitted. |
| `bonjourAdded`, `bonjourResolved`, `bonjourAddressMismatch` | Observed control-service discovery/resolution. Zero does not prove that no multicast packets arrived. |
| `control probe stage`, `lastProbe` | TCP connect, request sent and response outcome; failures retain the last stage and exception class. |
| `airplay TCP accepted`, safe request/response milestones | Incoming TCP and protocol progress; TCP alone proves neither selected-iPhone identity nor successful CarPlay. |
| `sessionActive`, `waitingFor` | Established session and the next missing milestone; session establishment alone does not prove rendered video. |

With authentication/start sent but no discovery or incoming TCP, check Wi-Fi association, multicast and matching address-family reachability. A connect failure points to TCP reachability; a timeout after `REQUEST_SENT` means the endpoint accepted TCP but returned no usable response in time. An iPhone Wi-Fi checkmark is not required for normal wireless CarPlay. Android hotspot client APIs cannot conclusively establish legacy-client association; logs preserve unknown/not-exposed rather than guessing.

After Bluetooth handoff, the 45-second watchdog requires a rendered frame before retaining a session without tunneled iAP2. `STEP handoff/fallback` retains Bluetooth control after proven video; `STEP handoff/complete` releases it once the tunnel is ready. Fallback alone does not establish authenticated-tunnel saved-history proof.

`browser display reconnect retaining wireless transport` denotes viewport renegotiation that retains Wi-Fi, listener, discovery and authentication resources. Expected old-display teardown is not a network failure. Bootstrap/start milestones cannot prove replacement rendering; report a missing first frame with the viewport change. See [browser lifecycle](Browser.md#browser-session-lifecycle).

## Retention and completeness

One log target belongs to the app process, initialized before activities/services and shared by CarPlay, browser and ordinary AirPlay. Opening settings, replacing a session or destroying an Activity does not reset it; late teardown callbacks keep their original target.

Redacted metadata filters precede a bounded background queue; full Debug message text goes to the realtime Zstandard capture. Raw capture is separate from this queue. Accepted records include date and timezone. Overflow and write failures increment integrity counters; a later successful write persists a loss marker. Rotation and process startup expire older history; the authoritative limits are in `SessionLogFile` and the export. Clearing app data removes private logs.

Export runs off the UI thread, waits a bounded time for writes and snapshots under the rotation lock. It reports detail/policy omissions, losses, storage/rejected-write counts, pending work and drain timeout. The metadata completeness counter covers accepted messages in retained history; raw write failures have their own counter. abrupt Android termination can lose in-memory records. Explicit shutdown attempts a bounded flush. The report focuses on retained Android/browser events rather than unrelated static device dumps.

Sources: `shared/.../diagnostics/RawTraffic.kt`, `RawTrafficArchive.kt`; `common/.../DiagnosticLogs.kt`, `DiagnosticLogPolicy.kt`, `DiagnosticRedactor.kt`, `SessionLogFile.kt`, `DiagnosticLogSnapshot.kt`, `DiagnosticExportStore.kt`, `DiagnosticReportContent.kt`; `shared/.../network/WirelessStartupDiagnostics.kt`; `site/play/fps-window.js`.


## Debug TCP receive backpressure probe

Debug phone APKs have a second launcher entry, **TiPlay TCP Probe**. First connect
CarPlay normally in TiPlay and open the existing car browser page. Open the probe
on the Android phone, keep the source picture changing (map motion or scrolling),
and select **Start**. The 60-second run uses 15 seconds of unrestricted baseline,
15 seconds at 70% of baseline receive bytes/second, 15 seconds at 40%, then
15 seconds of unrestricted recovery. It does not require a new browser page or
WebRTC. A quiet static baseline does not represent the capacity needed for motion.

Only the main CarPlay video TCP reader waits, at complete-message boundaries and
outside shared video/audio delivery locks. Audio, HFP/SCO, controls, timestamps,
cipher ordering and the existing browser output retain their paths. The probe
neither transcodes nor injects packet loss. Kernel and iPhone buffering mean a
read limit is not an immediate network send limit. The feature defaults off,
has no persisted switch or remote control endpoint, stops when its video
connection ends, and restores unrestricted reads on **Stop** or timeout. Closing
the probe screen permits the finite run to continue; a process restart disables it.

The screen shows the phase/countdown, byte budget, completed-message bytes, frames,
socket read attempts (not TCP packet counts), receiver throughput and gate waiting.
`lastReceivedSourceAgeMs` is arrival time minus the source's scheduled presentation
time, using the existing valid NTP-to-monotonic mapping. It is not capture-to-screen
latency; a negative value means early arrival. Missing/stale synchronization is
`unavailable`, never an arrival-time substitute. `lastFrameReceivedAgoMs` shows
when the last complete frame arrived. The bounded text history can be shared
from the phone; the same measurements enter the existing session diagnostics.

Compare picture age during the limited phases and immediately after recovery.
Throughput falling alone does not prove that the iPhone encoder adapted. Growing
age followed by a burst of old frames indicates buffering; bounded age and prompt
recovery support this device combination's use of receive backpressure. Source
encoder behavior, actual screen latency, music continuity and USB/wireless
interoperability still need device measurements. `TcpReceiveProbeTest` verifies
default-off behavior, finite phases, missing/negative timing evidence, immediate
stop/connection-retirement wakeup and stale-connection isolation.

Vehicle receive-backpressure results and their implementation implications are
recorded in the [WebRTC roadmap](WebRTC-roadmap.md#tcp-背压实测). The probe is a
diagnostic experiment, not the production congestion-control policy.
