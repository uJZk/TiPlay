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

Service diagnostics distinguish missing permission from foreground eligibility; a granted
microphone permission alone does not establish permission to start microphone capture
in the background.

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

Standard `Browser transport: stage=POLICY` preserves observed profile/interaction
counter changes, capacity-drop increases and clock-validity boundaries, and can
accompany existing transport/failure boundaries. Healthy periodic detail remains
Debug-only. Plan changes, ages and each move do not create per-frame Standard logs.
The ordinary bounded status prioritizes core policy evidence; complete plan fields
can require Debug. An allowlist entry does not guarantee that a budgeted payload
contains it; check omission counts and keep absent fields unknown.

A captured reproduction contains three valid intervals per live mode after each
initial baseline. Mirroring added 859 read frames and 863 draws with no increase in
any of the five additive drop categories. CarPlay added 322 reads, 325 decodes and
223 draws, with 95 capacity evictions and six pacing replacements. Already queued
pictures can make interval draws exceed reads; these counters have different stage
boundaries. CarPlay also had sparse source presentation/read cadence, so low draw
rate cannot all be attributed to browser drops. Its coded picture size made the
64 MiB byte budget admit four queued pictures before the 24-frame limit; aggregate
counts do not reconstruct each eviction's instantaneous cursor or target.

The same CarPlay evidence includes a mapping age above 18 seconds and 37 newly
untimed scheduled pictures, while control exchanges continued. It does not identify
the exact anchor-selection cause or certify those pictures' latency. A later raw
CarPlay return has no simultaneous browser-quality snapshot. No forwarded `t` touch
event or active touch-profile window was captured, so the 750 ms hold and 1.25x
convergence remain unvalidated on that device. These observations establish neither
universal smoothness nor absence of live playback, and do not tune the profile
constants or measure physical panel/acoustic output.

## AirPlay URL playback evidence

URL casting has its own media engine and AudioContext. CarPlay/mirror audio telemetry
does not establish that this context is running. Compare playback ID, command revision
and engine generation before interpreting successive snapshots. A settled old command
keeps its revision without acquiring a newer engine's snapshot; retired/inactive players
cannot report a current engine. `ready`, play intent, `loadedmetadata` and
`readyState=3` do not establish actual `playing`, a resolved play promise or an advancing
media clock. A pending AudioContext resume can leave decoded media ready while position
stays at a seek target.

The bounded engine snapshot is split into fixed groups so the metadata line limit does
not silently discard the later fields:

| Group | Evidence |
| --- | --- |
| `ENGINE_STATE` | Playing intent versus running clock, wait reason, AudioContext state/resume pending, clock anchor and stall elapsed/count. |
| `ENGINE_BUFFER` | Position, playable/per-track ends, scheduled audio end, limiting track, target/time capacities, startup decision and read-progress fallback count. |
| `ENGINE_PIPELINE` | Queue counts/bytes, frame/byte capacities, pending sink reads, budget blocking and end-of-stream flags. |
| `ENGINE_CODEC` | Validated complete short codec/profile token, coded/display dimensions, observed sample cadence/duration, support probe and requested hardware/latency hints. |
| `ENGINE_OWNERSHIP` | Retained sample generation, held/pending/total application-owned samples and estimated bytes; received/closed samples, pending video-read age and last sample age. |
| `ENGINE_AUDIO` | Resume requested/completed/failed counts, known user-activation state, required gesture and requested context latency hint. |
| `ENGINE_NETWORK` | Serialized resource-reader activity/queue, byte progress and its age, timeouts/cancellations, backward restarts, ignored ranges and safe last status/result. |

Semantic media/command edges remain visible. Engine-state changes are sampled from
progress/timeupdate events with a 250 ms minimum interval; an unchanged snapshot with
play intent but no running clock repeats at most every five seconds, and healthy state
at most every ten seconds. Android applies a further unchanged-state deduplication.
Standard, the default mode, retains semantic media/command edges, failures and explicit
`stalled=true` evidence. One recovery snapshot can follow an accepted stall only for
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

Finite-surface tests reproduce a code-level startup deadlock when the engine waits for
an additional sample before recognizing its capacity. They do not measure a vehicle's
surface pool. Local replay also demonstrates that an unactivated, suspended
AudioContext can produce matching readiness-without-progress symptoms and resume
after a real Play action. The field report did not collect that context state or pool
capacity, so neither mechanism is established as its sole cause. Observed complete
upstream response blocks likewise do not establish their final delivery to the browser.

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
