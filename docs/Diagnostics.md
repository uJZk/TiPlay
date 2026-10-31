# Diagnostics

Reproduce, note the symptom/time, then **Save diagnostic report** in Android Advanced
settings. Enable **Debug mode** beforehand for timing detail. Reports use
`Downloads/TiPlay`, with an app-owned shareable fallback. Review before sharing;
include phone/APK versions and connection mode. Keep credentials/captures outside Git.

## Monitor and log detail

Open the browser's default-collapsed **Diagnostics** section for a scrollable,
newest-first log of recent connection, source and error transitions and the
**Performance monitor** switch. The log has no timestamps and does not include
addresses, URLs, device identities or raw errors. It remains available without
Debug mode; full structured diagnostics remain in the Android report.
New events stay visible at the top while the log is at the top; scrolling down
stops automatic scrolling, including while the section is folded.
These controls are independent of Android Debug
mode and enable no extra capture. The monitor overlay must not change the canvas,
negotiated viewport or touch coordinates. Its fields are:

| Field | Meaning |
| --- | --- |
| Codec | Current video codec; hardware preference does not prove hardware decoding. |
| FPS | Actual successful draws during the last second. |
| Receive processing | The selected inbound WebRTC stream's increase in `totalProcessingDelay` divided by its increase in decoded frames between consecutive fresh samples. This covers browser receive/decode processing, not sender, network, Canvas or panel latency. Missing, stale or changed streams show an unknown value. |
| Drops | The browser's inbound `framesDropped` is shown separately from application queue and renderer discards. Application `pre`, `in`, `out` and `render` identify the pre-configuration, main-to-worker, worker-to-main and Canvas stages; unused or unknown stages are not reported as zero. None counts all phone or network loss. |

Browser v96 adds the current video's bounded error code to **Diagnostics** and
`tiplayStats.page.video.errorReason`; first-fault `st` telemetry prioritizes the
same field. Codes contain only lowercase letters, digits and hyphens, with a
100-character limit; invalid text becomes `rtc-video-failed`. This separates
video-only failures from the healthy audio/control transport. Debug raw capture
retains the incoming telemetry; Android's existing Standard text allowlist is
unchanged. A generic playback failure no longer asks the user to update versions.

Native `Browser RTC: stage=video-codec` lines add bounded JSON for the source and
actual encoder selection. They contain only fixed codec/profile fields and safe
state/reason values, with no SDP, arbitrary fmtp, URLs or device identities.
Changed values are checked at most once per second, deduplicated, and forced at
a video failure boundary. Read the fields as separate observations:

| Field | Meaning |
| --- | --- |
| `source` | Codec/profile/level parsed from the source configuration. |
| `negotiated` | First primary video format in the local answer; the source must fit this contract. |
| `requested` | Latest format passed to factory allocation; a query/allocation alone does not establish the running encoder. |
| `announced` | Native `onCurrentEncoder` notification, before initialization succeeds. |
| `current` | Most recently initialized wrapper's format; not proof of encoded output or browser drawing. |
| `preferred` | Source-compatible format the selector requests within the answer's limits. |
| `selection` | `idle`, `waiting`, `ready`, `failed` or `closed`; readiness is the wrapper state, not physical playback. |
| `failure` | Current video failure reason, if available. |

Compare `source`, `negotiated` and `current` to distinguish a receive-capability
failure from an incompatible native encoder selection. The complete safe
`offered` matrix remains in the `videoCodec` peer snapshot and is omitted from
these Standard lines. The diagnostic snapshot is collected outside the transport
wake lock. The v96 field report establishes `encoder-codec-mismatch`; it did not
record the actual native encoder's fmtp, so it does not prove a Baseline-first
selection. That ordering is covered by a regression fixture. The added fourteen
Java selection/lifetime tests pass locally and in full CI without loading JNI; actual
RTP playback and vehicle hardware decoding remain unverified.

Debug defaults off. Enabling starts capture silently; **View logs** opens its dialog.
Log and export-result windows share a bottom text-button bar. The privacy notice
appears only inside Debug logs. A new process restores enabled capture and its dialog.

- Debug off: **Save / Share / Close**, using redacted Android/web logs.
- Debug on: **End and export / End and share / Discard / Minimize**.
- Ending or Discard disables Debug and clears raw capture history. Export/share first creates
  an independent usable file, then clears capture. A failed export retains evidence
  and reports failure; recording remains stopped. Turning the switch off also ends
  and clears capture.
- Minimize/back/outside dismissal only hides the window; capture continues. The
  View logs button reopens it. Progress shows duration, size and storage failure.

Rolling metadata remains redacted. Standard exports redact older Debug history too;
full Debug text lives in `android/log`. Legacy static device dumps are omitted.

Both Standard TXT and Debug ZIP reports include the last retained Java crash record
and, on Android 11+, up to three recent exits for TiPlay's own package. Exit entries
contain numeric reason/status, age, importance and memory values; descriptions
and process-state blobs are not read. Older Android versions and unavailable
exit history are marked explicitly. These records may predate the current session;
compare their age with the connection timeline before attributing a failure to a
crash, memory pressure or a user-requested stop. Crash text uses the existing
redaction policy even in Debug reports. Collection runs during background export.

<a id="native-crash-traces"></a>

On Android 12+, explicit Debug exports also request the system-retained native
tombstone for the newest native crash of TiPlay's main process among those three
exits. This uses `ApplicationExitInfo.getTraceInputStream()` without root or ADB.
The system may have evicted the trace or the device may not provide it; export
records that outcome rather than treating an absent trace as proof of no crash.
The expected native tombstone format is a binary protobuf. Android can instead
return an earlier retained ANR trace; export preserves the bytes without format
validation. Decode and match the PID/time to the selected exit before treating
it as this crash's stack. Native thread backtraces, module offsets and Build IDs
help identify the faulting library;
source line resolution may additionally require the matching unstripped build.
Historical tombstones can predate the installed APK, so match Build IDs rather
than assuming they describe the current binaries.

Only a complete trace up to 8 MiB is included; empty, oversized or unreadable
traces are omitted with a status. This bounded collection happens off-thread at
export, adds no native crash handler and does not change media transport. The
trace can contain memory, registers, paths and device details and is unredacted;
it is included only in explicit Debug ZIPs. Standard TXT does not read it. Temporary
collection files are removed after archive preparation, including failed exports.

Raw capture covers iPhone TCP control/encrypted protocol, video, audio, timing, events
and iAP; RFCOMM; browser HTTP headers/query/body before parsing, including rejected
requests; USB discovery/permissions,
descriptors, open/configuration/interface lifecycle, request queue/wait/cancel/close,
control transfers, USBMUX/NCM/CH341, interrupts and failures. Android playback PCM and outbound payload copies are omitted;
the canonical incoming streams and Android/browser diagnostic events remain. USB records
carry connection/request IDs and requested/completed lengths. Asynchronous input is
captured once at completion before parsing, including bytes drained after timeout.
Debug forces AirPlay URL resources through Android and captures Android HTTP
response bodies. FCUP resources arrive inside the captured encrypted control
stream; a capture begun after pairing may not contain enough material to recover
their plaintext bodies. Successful FCUP byte counts do not imply plaintext capture;
disabling restores direct eligibility, reopening active playback on policy changes.
Android owns A2DP/HFP encoding and USB host-controller signalling. Capture cannot
observe Bluetooth air packets, USB bus signalling, unread kernel buffers or packets
lost before application delivery. Capture does not establish speaker playback timing.

Transport diagnostics retain bounded queue, fragment/reassembly and consumer-wait
observations for DataChannel records. The preceding encoded-video pipeline also
reported read-to-decode, decode-to-output and scheduler/draw residence; these legacy
fields do not measure the current native RTP receiver. Cross-clock durations retain
mapping uncertainty, overlapping quantiles cannot be added, and Canvas submission
does not measure GPU completion or panel scanout.

Native `stage=control-work` groups record ingress/RPC queue occupancy, high-water
marks, limits, rejected/abandoned work and processing costs by ACK, authentication,
audio lease and application RPC. Queue wait, synchronous raw-capture time, parsing
and application work have separate totals/maxima; active work also retains its
phase and elapsed time. Debug repeats these bounded groups every ten seconds;
retirement preserves them in Standard too. Raw capture remains synchronous and
can still backpressure media through its shared disk writer. Queue isolation does
not establish that a slow or failing disk can sustain lossless capture.

The compatibility telemetry path prioritizes source-deadline fault snapshots when supplied; identity churn is merged
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
  compressed at Zstandard level 3.
- `capture.txt.zst`: format instructions and current-process capture integrity,
  compressed at Zstandard level 3.
- `native-crash/info.txt.zst`: native trace availability and numeric exit identity.
- `native-crash/trace.bin.zst`: complete system-provided trace bytes when available
  and within the size limit; native tombstone protobuf is expected but not validated.
- `captures/raw-traffic-<process-id>.tsv.zst`: current and retained process journals,
  copied unchanged, without splitting/decompressing/recompressing media.

Use `zstd -dc <file.zst>` to read a journal/report. Reconstruct each channel by
concatenating decoded Base64 payload chunks in file order, respecting capture/start
session boundaries. The old split-stream exporter remains for compatibility tests;
it now packages STORED entries too and performs no DEFLATE compression.

Export snapshots lengths/handles and copies off-thread; failed writes preserve capture.
The result dialog offers **Copy path / Open folder / Close**, without Share. Copying
keeps it open. Open folder targets the parent directory, never the report file;
inaccessible/private locations show an error. Saved files survive raw cleanup.
Debug captures contain private media, credentials and identifiers; review before
sharing and keep them out of Git. Disk pressure does not automatically stop capture.


Window, page, log and export tests pass, including shared button styling on narrow large-text
screens and no popup on enable. Full CI and APK assembly were skipped for this
follow-up. Vehicle checks remain: microphone-active audio/echo, restart dialog,
sustained CPU/storage, screen-off capture and full storage.

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

Current live audio uses negotiated browser RTP tracks or the PCM/libav.js-to-NetEq
software path, with shared AudioWorklet mixing/ducking. See [Audio tempo](Audio-tempo.md).
The worklet loads precompiled NetEq/audio-core modules with private memories;
it does not run the retired PD/SoundTouch or browser libsoxr controller. The bundled
NetEq Opus API is exercised by library tests, while product Opus requires native
RTP negotiation. A retained schema/allowlist field does not prove a retired path runs.

`nativeAudio.state=ready` means the independent native-audio SDP was installed.
Check its separate `peerState`, `iceState` and `gatheringState` before inferring a
connected transport. `rtcGeneration` fences replacements; `tracks`, `boundSlots`,
`readySlots` and `streams` distinguish received tracks, Worklet graph application,
announced ready active slots and active owners. Ready slots require successful
playout-anchor `play()` as well as Worklet binding. The Standard summary retains the
main state/counts; Debug audio records retain all ten bounded fields. Missing
native-audio fields remain unknown. Failed, retired and closed peers report zero
live track/slot/owner counts and no pending drain. `drainUnknown=true` means an ended owner's
receiver stays connected for its buffered tail; it does not certify drain completion
or audible output. Music may use software AAC while guidance uses this separate
Opus peer, so successful music alone cannot establish native guidance playback.

RTP packet reception alone also does not establish decoded samples. The local
original-Opus reproduction received packets with zero Worklet output until a
muted, zero-volume audio anchor activated Chromium's peer playout. Check the
existing render nonzero/peak evidence after readiness; the anchor itself has no
audible output. See [audio buffering and tempo](Audio-tempo.md#live-audio-official-neteq)
for the ownership and verification limits.

Debug distinguishes decoder PCM packets/frames/nonzero/peak, worklet rendered
frames/nonzero/peak, per-stream backend/epoch/queue/state and native-track state.
Software-stream NetEq telemetry describes adaptive buffering and time stretching;
native tracks retain the browser receiver's timing. Backend `webrtc-track` and
`neteq` observations must not be combined into one decode-CPU or latency measure.
Separate stream transport IDs may share one music/guidance semantic type.

Raw media/source coordinates, emitted worklet frame counts, native output timestamps,
performance-clock probes and exported wall-clock event times are different domains.
Compare them only through recorded anchors. Main-thread `contextTimeMs` remains
diagnostic-only; `renderReportAgeMs` measures receipt age and `renderAgeMs` remains
unknown. A getter discrepancy does not establish acoustic output time.

The output-clock diagnostic estimator retains device-rate source, target, confidence,
generation, attempted-fit noise, accepted-fit age and reject reason separately from
Android/browser clock offset/rate. Unknown fit values stay absent. `native`, `render`
and `holdover` describe selected evidence, not measured oscillator hardware. Causal
request/ACK probes include render quantum and scheduling uncertainty; raw MAD printing
precision is not measurement accuracy. Native output pairs must pass continuity and
freshness guards. A held pair retains its original age; a later receipt cannot refresh
it. See [audio clock roles](Browser-wasm.md#audio-clock-roles) for these boundaries.
None of these estimates drives the current independent NetEq source timeline.

Current worklet playout references report `sourceDeadlineState=unknown` and
`sourceDeadlineReason=independent-audio`, with no source-time reference. The historical
`within-bound`/rejected-quantum fields remain compatible with older captures; they
must not certify current RTP/NetEq sender-relative +300 ms or physical speaker time.
Counter discontinuities change diagnostic domains; they do not identify every click
or prove that current audio has skipped samples.

Detailed reports carry the active capture ID, playback generation and Debug revision;
reopening Debug or clearing capture rejects stale queued reports. Turning Debug off
stops detailed collection without renegotiating media. Standard retains concise
processor failure/recovery changes and resource/service failures. Bounded packing
reports omitted fields rather than inventing values. [Audio evidence](Audio-evidence.md)
describes the waveform event schema, suppression, truncation and delivery limits.
Its legacy PD/source-clock lanes are null in the current NetEq implementation.

`sound=true` means the AudioContext is running. Decoded nonzero PCM proves content
reached a software queue; rendered nonzero output proves worklet samples were produced.
Neither proves sound reached the vehicle speakers. Queue fullness alone cannot locate
a stall. `AudioContext.playbackStats` reports browser rendering underruns, when readable;
unavailable/invalid/failed states retain unknown counts. The
[API](https://webaudio.github.io/web-audio-api/#AudioPlaybackStats) updates about once
per second subject to visibility/activity, so readable is not necessarily fresh.
Observed context state changes/non-running durations can miss coalesced transitions.
URL `ENGINE_RENDER` uses AVPlayer counters, a separate domain.

`airplay audio modes` records incremental main-audio ownership, speech mode,
phone-call/navigation entity and state, `audioSetups` request count and accepted
`activeAudioTypes` not yet torn down. Only validated fixed fields are logged;
repeated states are silent. Unknown means no valid observation, not a routing
decision. A running browser AudioContext with zero audio SETUP requests does not
establish a browser decoder failure. Capture from before triggering a navigation
announcement to distinguish iPhone routing, stream setup, delivery and playback.

Debug raw capture retains audio configuration, resets and decrypted encoded packets
or PCM. DataChannel records are stored once under `browser/audio/rtc/<epoch>/records`;
`events` references sequence/bytes and `attempt`, `local-enqueue` or `failed`.
Local enqueue proves Android SCTP accepted bytes, not remote consumption or sound.
HTTP `browser/audio` fixtures retain socket-write semantics in JVM tests; the product
route is disabled. RTP playback must not be interpreted as DataChannel codec payloads.
The [local replay importer](../tests/web-e2e/README.md#preparing-a-local-carplay-replay)
keeps original bytes and capture order; Android capture time is not browser arrival.
JS sampling excludes AudioWorklet, native codec and GPU work.

`Browser transport` separates connection stage, epoch, safe host/UDP candidate counts,
ICE/channel state, queue/credit and failure boundaries. Standard retains state/failure
changes immediately; healthy detail is Debug-limited. Audio consumer barriers prevent
old subscription replay. Candidate IPs, SDP credentials and private resource URLs are
excluded from metadata. Raw control input is captured once under
`browser/rtc/<epoch>/control/in` on the admitted control worker; early rejection,
overload or retirement can precede it. Zero capture failures do not prove a complete
SCTP/DTLS packet trace. Raw control has the same unredacted privacy boundary as HTTP.

Resource `HTTP_FAILURE` separates CONNECT, RESPONSE_HEADERS and RESPONSE_BODY,
with stage elapsed time, configured limits and safe exception classes. A configured
limit does not prove which OS timer fired. `FCUP_DEADLINE` separates queue, exchange
and overall ages, retaining the acquisition-time owner. Proxy load IDs and FCUP request
IDs are different scopes. Logger failure must not interrupt cleanup or progress.
No resource URLs, bodies or arbitrary exception messages enter these metadata lines.

Debug `iphone/carplay-screen-loan/events` retains sparse `STATE`, data boundaries,
`COMMAND` and one `CLOSE` per connection. CSeq/event generation, borrow/return, elapsed
time, RTSP status and plist command status remain separate. REQUEST, WRITTEN,
RESPONSE, TIMEOUT, CAPACITY, CANCELLED and WRITE_FAILED are local boundaries;
ACCEPTED/REJECTED/UNKNOWN describe command results, never a resource grant. Five-second
tracking and 16 pending records bound diagnostics, not control ownership. Compare
requested/sent, actual owner, pending, `confirmedBorrow` and stream availability.
A missing iPhone icon or unspecified close cannot explain iOS intent. Old captures
cannot acquire new event boundaries. Current ownership rules are kept in
[AirPlay coexistence](AirPlay.md#carplay-coexistence).

### Historical audio-controller evidence

The retired PD/Soxr implementation's fit, phase/recovery, source-deadline and voice
preparation fields describe older captures only. Their detailed interpretation is
[retained in Git](https://github.com/uJZk/TiPlay/blob/5c47dd00/docs/Diagnostics.md#browser-audio-evidence);
current implementations and tests must not be inferred from that schema.

In beta.12/v78, two CarPlay clock-step recoveries over 55.019 seconds versus
beta.11's 188/730.046 seconds used different sources/load, so they do not establish
acoustic improvement. Mirror underruns rose 116→618 render quanta, not 502 pops.
Continuous source coordinates coexisted with 260 ms input/265 ms send-attempt gaps;
iPhone/network, scheduling and capture interference remained unseparated. Seven of
fifty native timestamps were over 20 ms ahead (maximum 98.2 ms), without proving
acceptance. Reference decoding of 6,088 packets/5,401,600 frames found no decode,
non-finite or over-full-scale errors. These observations cannot measure physical
output, establish a universal click cause or validate the replacement NetEq graph.

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
not successful return on the original connection. The historical replay review passed 19 isolated ownership-state tests; Gradle
distribution access blocked its full Android CI at that time. Current release CI
is recorded separately in [Testing](Testing.md#current-release-source).

## Live video policy evidence

Current CarPlay/mirror video is decoded by the browser's native WebRTC receiver
and submitted from MediaStreamTrackProcessor directly to Canvas. TiPlay has no
live VideoDecoder, decoded-picture timer, rAF playback scheduler or touch catch-up.
Retained profile/plan fields serve compatibility and diagnostics; they do not
control or measure native jitter buffering or actual RTP playout delay.

Use current codec errors, source/negotiated/initialized native format evidence,
first-frame Canvas acknowledgement, successful submission counts, draw intervals
and last-draw age together. FPS counts Canvas submissions; multiple submissions
before one refresh can overstate visible frames. Browser and application drop counts
describe separate stages and do not count all network or sender loss. Receive
processing duration is not capture-to-screen latency.
See the [transport contract](CarPlay-DataChannel.md#current-implementation-and-evidence)
for v96 receive-level probes and v97 encoder selection. API support, successful
initialization and Canvas submission each prove a different boundary; none proves
hardware decoding or physical panel time.

Android `Browser RTC: stage=video-flow` reports bridge-lifetime receive, submit,
encoded-callback output and byte counts every five seconds and at writer retirement.
It separates waiting for a source keyframe, bounded-queue rejection, native input
released without encoding, native keyframe demand on a delta, dependency-chain
rejection and codec mismatch. These counters overlap; do not add them as a total
lost-frame count. Callback output proves local handoff, not RTP receipt. Pending
counts and native rate callbacks help distinguish source starvation from sender
input loss. The `mode=source-rate` field identifies the source-rate factory; an
allocation is unavailable until a callback has actually occurred, and is not a
network-capacity measurement. Compare intervals within one peer/video generation and use the receiver
statistics below for the downstream boundary.

`sourceObservedFrames`, `sourceAdaptationDrops` and `sourceForwardedFrames` observe
the public SDK source-adaptation boundary. The processor keeps normal adaptation
and aligned timestamps; it does not bypass dropping or convert compressed frames
to pixels. Source drops are also included in `releasedUnencodedFrames`; later
encoder losses are not source-adaptation drops. These counters do not distinguish
every native encoder loss reason or prove congestion-window dropping occurred.

`receivedBytes` includes all offered original access units and their parameter-set
prefixes, including frames rejected while waiting for a keyframe. Compare its
interval change with elapsed time to estimate original input demand; it is not
network throughput. `encoderInputsInFlight` counts inputs whose encoder callback
or loss handling has not completed. `pendingFrames` can remain nonzero while an
already encoded buffer is retained; it is not the producer's completion barrier.
The production video peer sets no startup, minimum or maximum bitrate. Native
rate callbacks need not occur in source-rate mode; zero or missing allocation does
not establish the network's capacity or a paused sender. [Android native replay](../tests/native/README.md)
compares source-rate and adaptive controls without claiming vehicle FPS.

`stage=video-feedback` records fixed booleans from the actual answer and sender
header-extension configuration. These show negotiated TWCC/REMB and abs-send-time
support, not proof that feedback arrived. While Debug capture is enabled,
`stage=video-send` samples the exact current sender every five seconds: original
RTP counters, target bitrate, fixed quality-limitation reason, cumulative packet
send delay, linked remote RTCP report/RTT counters and the selected ICE pair.
When exposed by the sender, header bytes include RTP headers and padding together,
and retransmitted bytes count RTP payload sent again; neither identifies a probe
cluster or its padding on its own. `hugeFramesSent` and encoded target bytes use
the encoder target, which cannot control already compressed pass-through frames.
ICE-pair discarded packets/bytes count socket send errors, not Wi-Fi air loss.
The optional transport `ccfbMessagesReceived` counts RFC 8888 feedback messages;
it is not a TWCC sequence coverage counter. Missing fields mean unavailable, not
zero, and a rising message count does not establish packet-level feedback coverage.
Late, expired or retired-generation callbacks cannot publish. Remote report RTT
and ICE RTT do not prove usable packet-level congestion feedback. Divide interval
send-delay changes by sent-packet changes within one sender generation; do not
compare cumulative values across replacements.

If `source`/`negotiated`/`preferred` name High while `current` remains Baseline,
check startup progress and keyframe recovery separately from throughput. The
beta.28 follow-up had only four source AUs, one unencoded release and zero RTP
output before `video-encoder-selection-timeout`. Its initial recovery attempts
fell within the existing 500 ms request limit; after the screen went static no
source-driven retry occurred. The idle poll now retries while waiting, within
the same limit and unchanged startup deadlines. Native before/after replay of
this sparse source belongs to [Testing](Testing.md#current-media-regression-checks).

Debug `transport.rtpVideo.*` samples the current video receiver independently of
the metadata DataChannel. `generation`, `state` and `sampleAgeMs` identify sample
ownership and freshness. Available counters include received/lost packets,
received/decoded/dropped frames, keyframes, NACK/PLI/FIR, decode time and freezes.
When exposed by the browser, packets discarded, multi-packet assembled frame count,
total assembly time and processing delay distinguish receiver assembly and decode
boundaries. These times and counts are cumulative: compare changes within one
generation, not totals across source replacement. The fields are optional and a
missing value is not zero.
`jitterMs` is receiver interarrival jitter. Jitter-buffer delay/target/minimum
values are cumulative milliseconds; divide their interval changes by the change
in `jitterBufferEmittedCount` for an interval average, only within one generation.
Source replacement clears the sample and rejects late old-receiver results.
Missing, failed or ambiguous reports remain explicit; absent counters are unknown.
`powerEfficientDecoder`, when exposed, is the browser's declaration, not an
independent hardware measurement. ICE `availableOutgoingBitrate` describes the
browser's outgoing direction and cannot establish Android's video send budget.

Allowlisted `policyVideo*`, cursor, source-clock and WebCodecs stage fields can
remain in older captures or compatibility fixtures. In the retired application
scheduler, submit-to-output duration included opaque decoder queueing, execution
and callback delivery; output-to-draw described application waiting/submission.
Those stage definitions do not measure the current native RTP receiver. Historical
20 ms submission reserve, 280 ms target cap, zero touch target, 64 MiB surface budget
and five-second policy snapshots are not current receiver settings. Full historical
field meanings remain [in Git](https://github.com/uJZk/TiPlay/blob/5c47dd00/docs/Diagnostics.md#live-video-policy-evidence).
Missing fields remain unknown; an allowlist entry is not evidence it was collected.

For stutter reproduction, enable Debug before connecting, retain one viewport,
include static and continuous-motion intervals, and note visible pause times.
Wait about ten seconds before exporting to include the next diagnostic window.
Viewport replacement can reset per-epoch counters separately from an RTC reconnect.
Captures and rolling aggregates cannot reconstruct every frame or hidden driver queue.

The following observations belong to the preceding DataChannel/WebCodecs engine:

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

Current URL playback uses libmedia AVPlayer, independently of live CarPlay/mirror
audio. The [URL engine contract](AirPlay.md#url-engine-and-captions) describes
player ownership and the Canvas-only path. Compare playback ID, command revision
and engine generation before interpreting snapshots. A settled old command keeps
its revision without acquiring the replacement player's snapshot; inactive players
cannot report a current engine. Ready state and play intent do not establish an
advancing clock, resolved play promise, rendered picture or audible output.

The current fixed scalar schema reports the facade and actual upstream statistics:

| Group | Evidence |
| --- | --- |
| `ENGINE_STATE` | Engine/render mode, wait reason, playing intent versus running state, gesture requirement, media position, requested/effective rate and combined upstream stutter count. |
| `ENGINE_PIPELINE` | Upstream audio/video compressed-packet queue lengths and decoded-frame counts, when available. |
| `ENGINE_RENDER` | Upstream audio/video rendered-frame counts and separate audio/video stutter counters, when available. |
| `ENGINE_CODEC` | Validated short codec token and known coded dimensions. |
| `ENGINE_STARTUP` | Preparation phase and monotonic open elapsed milliseconds, when supplied by the facade. |

The only accepted engine/render identifiers are `libmedia-avplayer` and `canvas`.
Phases are none, dependencies, metadata, first-samples, ready and playing. Wait
reasons distinguish no source, paused, seeking, preparing/buffering, ended, error,
audio-context-suspended and normal running. These are bounded adapter observations;
they do not classify all upstream causes of a stall. Unsupported fields remain
absent in browser events and unknown in Android logs rather than becoming zero.
Codec/dimensions do not identify actual hardware decoding or private pool capacity.
Packet queue counts are not exact buffered TimeRanges, unique byte coverage or a
total-memory measurement. The facade does not invent those values.

The previous custom engine's BufferSource scheduling, PCM identity/peak/alignment,
application sample ownership, serial-reader and PD/SoundTouch counters are removed.
`ENGINE_BUFFER`, `ENGINE_OWNERSHIP`, `ENGINE_AUDIO`, `ENGINE_NETWORK`, `ENGINE_PCM`,
`ENGINE_CONTINUITY` and `ENGINE_SCHEDULE` no longer describe the current URL engine.
An upstream render counter is not the browser device's audio-underrun counter or
proof of sound at the speakers. Live-audio probes remain separate evidence.

Semantic media/command edges remain visible. Progress/timeupdate sampling reads
statistics at most every 250 ms; unchanged stalled state repeats at most every
five seconds and healthy browser summaries at most every ten seconds. Android
applies its own bounded admission: Standard keeps preparation boundaries,
failures, explicit stalled state and one same-ID/revision/generation recovery.
Healthy periodic details are Debug-only. Source replacement is not recovery of
the prior identity. Repeated terminal errors remain bounded; a real fault and one
changed cleanup snapshot bypass the ordinary sampling gate. Error snapshots retain
available upstream state before teardown; cleanup snapshots describe only the
observable facade/upstream state, not verified release of every GPU surface.
A blocked main thread cannot emit a timely diagnostic, so this is not a watchdog.

Terminal HLS master-manifest errors cross the IO-worker boundary with a fixed
message containing only phase (`request`, `body`, `parse`, `playlist`), HTTP status
and an allowlisted cause name. For example, `phase=request status=0 cause=TypeError`
means fetch failed before headers; `phase=parse status=200` means a received body
failed parsing. A received HTTP 502 remains visible in the status. These are
diagnostic distinctions, not evidence that every URL can now open. Browser fetch
failures can share a TypeError across DNS, CORS and local-network permissions;
status zero does not choose between them. No URL, headers or original error text
are copied into this handoff, and existing upstream retries are unchanged.

Both ends whitelist enums, booleans, finite safe numbers and bounded codec tokens.
Fractional queue counters, invalid dimensions, arbitrary strings, URLs, decoder
configurations and media payloads are rejected. The shared cross-language fixture
and tests retain the existing 4096-byte control-envelope quota and bounded log
lines. Diagnostic failures cannot interrupt playback or disclose credentials.

Earlier field observations remain historical evidence of the retired player.
Beta.12's non-continuous 3840×2160 AV1 attempt recorded 26 underruns/3.055517 seconds
of graph gaps under a 96 MiB application budget; its later 256 MiB estimate did not
validate sustained throughput or sound. Synthetic main-thread/slow-video fixtures
measured the old scheduler, not AVPlayer or vehicle codec speed. Beta.10 MiniBili
and another URL reached playing after 10.411/16.779 seconds. Beta.9's CDN 206 and
large inline WebVTT blocking serial FCUP identify resource-path observations,
not acceptance of the replacement. Local `INLINE_DATA` handling avoids that FCUP
exchange without proving universal reachability. Physical AVPlayer startup,
long-play memory, continuity, teardown and sound remain open.

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
| `wireless bonjour: mdns startup`, `family`, `stage`, `state`, `elapsedMs` | Local Bonjour creation, listener and registration progress; completed phases report elapsed time, not iPhone discovery or acceptance. |
| `control probe stage`, `lastProbe` | TCP connect, request sent and response outcome; failures retain the last stage and exception class. |
| `airplay TCP accepted`, safe request/response milestones | Incoming TCP and protocol progress; TCP alone proves neither selected-iPhone identity nor successful CarPlay. |
| `sessionActive`, `waitingFor` | Established session and the next missing milestone; session establishment alone does not prove rendered video. |

With authentication/start sent but no discovery or incoming TCP, check Wi-Fi association, multicast and matching address-family reachability. A connect failure points to TCP reachability; a timeout after `REQUEST_SENT` means the endpoint accepted TCP but returned no usable response in time. An iPhone Wi-Fi checkmark is not required for normal wireless CarPlay. Android hotspot client APIs cannot conclusively establish legacy-client association; logs preserve unknown/not-exposed rather than guessing.

Bonjour supplies JmDNS with the existing numeric bind address and cached
`carplay-...` hostname, retaining IPv6 scope. This avoids the address hostname
lookup during JmDNS creation; listener and registration lifecycle remain
synchronous. Startup records use `stage=create|listener|register` and
`state=starting|ready|failed`; completed or failed stages report `elapsedMs`, and
failures retain only the exception class. Standard logs retain these records.
The observed 26.532-second wait was not divided into these stages, so the
hostname change is a candidate reverse-DNS workaround rather than an established
cause or a verified vehicle improvement. These startup observations do not
identify the native SIGSEGV fault.

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
