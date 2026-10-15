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

Debug mode defaults off (Standard); unknown preferences also use Standard. Changes apply immediately without reconnecting. Standard retains filtered connection, negotiation, failures and final summaries. Debug preserves diagnostic messages without redaction and enables a separate raw capture with no sampling, queue drops, truncation or rolling expiry.

Raw capture covers incoming iPhone TCP control, encrypted protocol bytes, video, audio, timing, events and iAP tunnel data; RFCOMM traffic; browser HTTP headers/query/body before parsing (including rejected requests read by the server); USB control setup/results, USBMUX, NCM and CH341 transfers, interrupt notifications, partial writes and failed transfer results; and PCM accepted by Android AudioTrack and the verified Bluetooth SCO output. While Debug mode is enabled, AirPlay URL resources are forced through Android and their response bodies are captured too. Disabling the switch restores normal direct-resource eligibility; active browser playback reopens when the policy changes. Android owns A2DP/HFP encoding and USB host-controller signalling: an ordinary app cannot capture Bluetooth air packets, USB bus signalling, unread kernel buffers or packets lost before delivery. AudioTrack acceptance establishes submission, not audible car playback; the `android-audio/track` channel can include non-Bluetooth routes.

The app-private `logs/raw-traffic.tsv` appends records as `epochMillis`, process-local sequence, channel, byte count and Base64 bytes, separated by tabs. A capture/start record identifies the process. Large payloads are split into consecutive records of at most 48 KiB without omitting any bytes; concatenate decoded records for a channel to recover its stream. Output `/attempt` and `/written` records distinguish attempted and accepted bytes. Bytes are stored synchronously with disk backpressure; storage failures increment the exported `RAW_CAPTURE failures` count. Capture files persist across sessions, mode changes and process restarts until app data is cleared. Disabling Debug mode stops new raw records but preserves earlier evidence. Storage use can grow substantially, especially for video.

Saving a report streams an immutable-length raw snapshot into one TXT file after the metadata, without loading it into the UI report string. Streams are identified by channel labels within that file; export does not create separate per-stream TXT files or a ZIP archive. Raw records have millisecond epoch timestamps and sequence numbers; metadata logs have a date, time and timezone. Sharing includes that full file. The result dialog has no clipboard action. Raw data and messages captured in Debug remain unredacted when exported after disabling it. Captures can contain credentials, pairing codes, personal data and media; keep them out of Git.

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

Sources: `shared/.../diagnostics/RawTraffic.kt`; `common/.../DiagnosticLogs.kt`, `DiagnosticLogPolicy.kt`, `DiagnosticRedactor.kt`, `SessionLogFile.kt`, `DiagnosticLogSnapshot.kt`, `DiagnosticExportStore.kt`; `shared/.../network/WirelessStartupDiagnostics.kt`; `site/play/fps-window.js`.
