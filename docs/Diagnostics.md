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

The app-private `logs/raw-traffic.tsv` appends records as `epochMillis`, process-local sequence, channel, byte count and Base64 bytes, separated by tabs. A capture/start record identifies the process. Large payloads are split into consecutive records of at most 48 KiB without omitting any bytes; concatenate decoded records for a channel to recover its stream. Output `/attempt` and `/written` records distinguish attempted and accepted bytes. Bytes are stored synchronously with disk backpressure; storage failures increment the exported `RAW_CAPTURE failures` count. Capture files retain all sessions across mode changes and process restarts until explicitly cleared from the saved-ZIP dialog or app data is cleared. Disabling Debug mode stops new raw records but preserves earlier evidence. Storage use can grow substantially, especially for video.

Standard mode saves a single `TiPlay-yyyyMMdd-HHmmss-SSS.txt` containing the diagnostic report, without raw traffic. Debug mode uses the same naming pattern with `.zip`. The ZIP contains:

- A TXT with the same basename for the diagnostic report.
- `streams/<session-id>/`: separate files per exact channel/direction, with a unique numeric prefix and readable channel label. Opaque/protocol bytes use `.bin`; explicitly labelled PCM16LE audio uses headerless `.pcm`. These are application I/O streams, not independently playable media containers or radio/bus captures.
- `events.tsv`: UTC Unix milliseconds, process-local sequence, stream path, byte offset and byte length for each record. File order is capture order; capture/start markers identify process changes when sequence numbers restart.
- `streams.tsv`: stream paths, original channel names encoded as Base64 UTF-8 and total byte counts. Labels preserve PCM rate/configuration and output attempt/written distinctions.
- `sessions.tsv`: session IDs, start times and Base64 UTF-8 capture/start metadata containing application version, capture configuration and process UUID.
- `capture.txt`: snapshot time, byte count, capture failures and format instructions.

Saving prepares one immutable-length snapshot off the UI thread and spools stream data to temporary app-cache files, keeping payloads and the event index out of memory. Storage fallbacks and private share copies reuse the same finished ZIP; newly captured data belongs to a later export. Temporary export files are removed on success or handled failure. A process killed during export can leave cache files; the next process initialization removes these abandoned export artifacts. Malformed/interrupted records are preserved in `unparsed.tsv`; `capture.txt` reports their count and explicitly marks reconstruction as incomplete. Valid records still export. New appends repair an incomplete line boundary without discarding the fragment. Storage/read failures still fail export instead of returning a partial success. Sharing uses `text/plain` or `application/zip` consistently with the saved artifact; the result dialog has no clipboard action.

The ZIP includes retained raw history, including earlier sessions. Disabling Debug stops capture but does not delete it; re-enable Debug to export it again. Saving does not erase the original capture. The saved-ZIP dialog offers **Clear captured data**. This deletes raw history and resets capture failure counters, preserving saved artifacts, settings and metadata logs. If capture is still active, clearing immediately begins a fresh session with the same configuration. Clearing uses the capture lock; an export already holding a snapshot can finish from its open file handle. Automatic storage-pressure stopping is not implemented. Standard TXT excludes raw history, but diagnostic messages previously recorded in Debug remain unredacted. Captures can contain credentials, pairing codes, personal data and media; keep them out of Git.

## Browser audio evidence

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
authenticated browser audio response, including codec configuration and decrypted encoded
packets or PCM. Its `browser/audio` attempt/written channels distinguish attempted writes
from bytes accepted by the socket; they do not capture browser speaker output.

Resource diagnostics distinguish Android HTTP from iPhone FCUP, preserve upstream status
and report bounded denial details in Debug. Service diagnostics distinguish missing
permission from foreground eligibility; a granted microphone permission alone does not
establish permission to start microphone capture in the background.

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
