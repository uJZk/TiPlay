# Diagnostics

Reproduce the problem once, note its time and visible symptom, then use Android Advanced settings to **Save diagnostic report**. If detailed timing is needed, enable **Debug mode** before reproducing. Reports normally go to `Downloads/TiPlay`; when public storage fails, TiPlay saves an app-owned copy available through its share action. Exported files are independent snapshots. Review them before posting with your Android/iPhone versions, APK version and connection mode; keep credentials and device captures out of Git.

## Monitor and log detail

The browser **Performance monitor** is independent of Android Debug mode. Its overlay must not change the canvas, negotiated viewport or touch coordinates, and enables no extra tracing. Its fields are:

| Field | Meaning |
| --- | --- |
| Codec | Current video codec; hardware preference does not prove hardware decoding. |
| FPS | Actual successful draws during the last second. |
| Delta | Latest synchronized canvas submission time minus iPhone scheduled presentation time; unavailable without a new synchronized draw within one second. This is not capture-to-display latency. |
| Drops | Explicit browser input, scheduler, transfer-replacement and presentation discards in the current video configuration. It cannot count decoder-internal, network or phone loss. Replacement streams reset it; repeating a configuration does not. |

Debug mode is process-local and defaults off (Standard) on every process start; old persisted values cannot re-enable it. Opening another Activity or service in the same process preserves the current switch. Each off-to-on transition creates a new session with a unique ID, start time, application version and capture configuration. Main settings shows a performance-impact hint while Debug is on. Changes apply immediately without reconnecting. Standard retains filtered connection, negotiation, failures and final summaries. Debug preserves diagnostic messages without redaction and enables a separate raw capture with no sampling, queue drops, truncation or rolling expiry.

Raw capture covers incoming iPhone TCP control, encrypted protocol bytes, video, audio, timing, events and iAP tunnel data; RFCOMM traffic; browser HTTP headers/query/body before parsing (including rejected requests read by the server); USB discovery, attach/detach and permission events, device descriptors, open/reopen, configuration and interface claims/releases, request initialization/queue/wait/cancel/close, USB control setup/results, USBMUX, NCM and CH341 transfers, interrupt notifications, partial writes and failed transfer results; and PCM accepted by Android AudioTrack and the verified Bluetooth SCO output. USB lifecycle events and transfers carry connection/request identifiers; asynchronous input is captured once at completion before framing or parsing, including bytes drained after a timeout, with requested/completed lengths and failures. While Debug mode is enabled, AirPlay URL resources are forced through Android and their response bodies are captured too. Disabling the switch restores normal direct-resource eligibility; active browser playback reopens when the policy changes. Android owns A2DP/HFP encoding and USB host-controller signalling: an ordinary app cannot capture Bluetooth air packets, USB bus signalling, unread kernel buffers or packets lost before delivery. AudioTrack acceptance establishes submission, not audible car playback; the `android-audio/track` channel can include non-Bluetooth routes.

The integrated WebRTC path retains bounded stage metrics: Android hub queue,
transport submission to browser record read (including sender queue/network/reassembly),
browser fragment reassembly, complete-record consumer wait, record-read to decode
submission, decode submission to output, decoded output to scheduler/draw and canvas
submission work. Android-to-browser durations retain clock-mapping uncertainty;
quantiles of different stages must not be added. WebCodecs decode duration includes
opaque driver/reference-reorder work, and canvas submission does not measure panel scanout.
These identify where to investigate, without claiming a measured vehicle bottleneck.

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

`Video source:` is a separate receive-thread window summary. It counts only complete
video-frame messages, excluding configuration and keepalives, and reports a local
stream/window identity, cumulative frame numbers, actual window FPS, adjacent source
PTS steps/missing/repeats/backward steps and adjacent complete-frame arrival gaps.
Source PTS and monotonic arrival timestamps are compared only within their own
domains. Window-boundary gaps remain visible, while new streams have separate
identity and state. Missing PTS is not replaced with arrival time. Neither a sparse
source cadence nor a PTS step alone proves network loss or source malfunction.
The companion `Video source gap:` line preserves the frame pair for each window's
largest PTS and arrival gaps, together with both measurements for that same pair.
These maxima may come from different pairs. Source stream IDs are independent of
browser video generations and epochs; associate them using timestamps and input
references rather than equating their numbers.

The original video stream is captured once on the iPhone-to-Android input. Forwarding the
video to the browser does not save another copy of that media payload. RTC reference
records contain capture session, original channel, journal sequence and byte ranges,
plus the decrypt/Annex-B transformation and downstream epoch/sequence. File append
is not fsync durability. `captureIntegrity` exposes write failures; after an uncertain
partial write, new exact-range references are suppressed until the next capture session.

Raw capture begins when Debug is enabled; it cannot recover earlier traffic. A successful export
and zero recorded failures establish neither coverage of uninstrumented paths nor delivery before
application I/O. The ZIP stores encoded network media, not uncompressed video frames or browser
AudioWorklet PCM. Its size depends on capture duration and source bitrate, and does not establish
completeness. Compare `sessions.tsv`, event time ranges, per-channel bytes and failure/reconstruction
counters. Retained sessions may come from different application versions with different capture coverage.

The app-private `logs/raw-traffic.tsv` appends records as `epochMillis`, process-local sequence, channel, byte count and Base64 bytes, separated by tabs. A capture/start record identifies the process. Large payloads are split into consecutive records of at most 48 KiB without omitting any bytes; concatenate decoded records for a channel to recover its stream. Output `/attempt` and `/written` records distinguish attempted and accepted bytes. Bytes are stored synchronously with disk backpressure using a reused writer, flushed after each record. This is application flush, not an `fsync` or power-loss durability guarantee. Storage failures increment the exported `RAW_CAPTURE failures` count and preserve first/last failure times, source category, safe cause and failed-byte-attempt upper bound. Capture files retain all sessions across mode changes and process restarts until explicitly cleared from the saved-ZIP dialog or app data is cleared. Disabling Debug mode stops new raw records but preserves earlier evidence. Storage use can grow substantially, especially for video.

Standard mode saves a single `TiPlay-yyyyMMdd-HHmmss-SSS.txt` containing the diagnostic report, without raw traffic. Debug mode uses the same naming pattern with `.zip`. The ZIP contains:

- A TXT with the same basename for the diagnostic report.
- `streams/<session-id>/`: separate files per exact channel/direction, with a unique numeric prefix and readable channel label. Opaque/protocol bytes use `.bin`; explicitly labelled PCM16LE audio uses headerless `.pcm`. These are application I/O streams, not independently playable media containers or radio/bus captures.
- `events.tsv`: UTC Unix milliseconds, process-local sequence, stream path, byte offset and byte length for each record. File order is capture order; capture/start markers identify process changes when sequence numbers restart.
- `streams.tsv`: stream paths, original channel names encoded as Base64 UTF-8 and total byte counts. Labels preserve PCM rate/configuration and output attempt/written distinctions.
- `sessions.tsv`: session IDs, start times and Base64 UTF-8 capture/start metadata containing application version, capture configuration and process UUID.
- `capture.txt`: snapshot time, byte count, capture failures, `RAW_CAPTURE_INTEGRITY` boundary and format instructions. `no-observed-write-failure` records the instrumented writer's observations; `partial` identifies a known integrity failure.

Saving prepares one immutable-length snapshot off the UI thread and spools stream data to temporary app-cache files, keeping payloads and the event index out of memory. Storage fallbacks and private share copies reuse the same finished ZIP; newly captured data belongs to a later export. Temporary export files are removed on success or handled failure. A process killed during export can leave cache files; the next process initialization removes these abandoned export artifacts. Malformed/interrupted records are preserved in `unparsed.tsv`; `capture.txt` reports their count and explicitly marks reconstruction as incomplete. Valid records still export. New appends repair an incomplete line boundary without discarding the fragment. Storage/read failures still fail export instead of returning a partial success. Sharing uses `text/plain` or `application/zip` consistently with the saved artifact; the result dialog has no clipboard action.

The ZIP includes retained raw history, including earlier sessions. Disabling Debug stops capture but does not delete it; re-enable Debug to export it again. Saving does not erase the original capture. The saved-ZIP dialog offers **Clear captured data**. This deletes raw history and resets capture failure counters, preserving saved artifacts, settings and metadata logs. If capture is still active, clearing immediately begins a fresh session with the same configuration. Clearing uses the capture lock; an export already holding a snapshot can finish from its open file handle. Automatic storage-pressure stopping is not implemented. Standard TXT excludes raw history, but diagnostic messages previously recorded in Debug remain unredacted. Captures can contain credentials, pairing codes, personal data and media; keep them out of Git.

## Browser audio evidence

Clock evidence separates offset, rate, confidence and clock generation. Worklet stream
evidence distinguishes phase error, source-rate confidence, resampling ratio, recovery
reason and network-buffer target. Raw media/source coordinates, relative device-context
time and exported wall-clock event time are different domains: compare them only through
their recorded anchors. A small phase correction must not be classified as a new stream.
Source-supply rate inferred from realtime ingress is weaker evidence than a sender timing
anchor, especially when network queuing changes slowly.

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

Browser audio uses the bundled pure JavaScript libsoxr backend inside AudioWorklet.
It requires neither WebAssembly nor JavaScript evaluation permissions. Worklet module
loading and processor failures surface as audio errors; check processor errors,
recovery counts and actual nonzero render samples when diagnosing silence.

For uneven dragging with high FPS and unchanged drops, compare `video.frameIntervalP95Ms`,
`video.frameIntervalMaxMs`, `video.lastDrawAgeMs`, `video.decodeMsP95`, `video.drawMsP95`
and `control.rttMsP95`. These fields distinguish irregular picture delivery/submission
from slow serial input requests. `pacingDroppedFrames` counts superseded pending decoded
pictures; it does not count source/network loss or prove actual panel presentation.
The bounded status summary prioritizes these fields; per-stream audio retains its own
separate diagnostic budget.

For a video-stutter reproduction, enable Debug before starting the browser session,
keep one viewport size, include a short static interval followed by continuous
scrolling/animation, and note the visible pause time. Wait about ten seconds after
the pause before exporting, so the next diagnostic window is included. Changing
the viewport can restart the source and reset per-epoch drop counters; report that
separately from an interrupted RTC connection.

Resource diagnostics distinguish Android HTTP from iPhone FCUP, preserve upstream status
and report bounded denial details in Debug. Android resource I/O failures retain bounded
exception class names and one cause class, excluding exception messages and private URLs.
Service diagnostics distinguish missing permission from foreground eligibility; a granted
microphone permission alone does not establish permission to start microphone capture
in the background.

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

Standard metadata filters precede a bounded background queue; Debug message text bypasses redaction. Raw capture is separate from this queue. Accepted records include date and timezone. Overflow and write failures increment integrity counters; a later successful write persists a loss marker. Rotation and process startup expire older history; the authoritative limits are in `SessionLogFile` and the export. Clearing app data removes private logs.

Export runs off the UI thread, waits a bounded time for writes and snapshots under the rotation lock. It reports detail/policy omissions, losses, storage/rejected-write counts, pending work and drain timeout. The metadata completeness counter covers accepted messages in retained history; raw write failures have their own counter. abrupt Android termination can lose in-memory records. Explicit shutdown attempts a bounded flush. Crashes and Android process exits have separate report sections.

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
