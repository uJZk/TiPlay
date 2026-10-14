# Diagnostics contracts

## Performance monitor and log detail

The browser's Performance monitor is an independent overlay. Enabling it must not
change the video canvas, the viewport offered to the phone, or touch coordinates.
Its visibility is independent of the Android diagnostic log level. The monitor
does not enable protocol tracing or additional frame logging.

The four fields are codec, actual draws in the last second, the most recent drawn
frame's synchronized presentation Delta, and explicit browser frame discards in
the current video configuration. Delta is canvas submission time minus the
iPhone's scheduled presentation time. It is not capture-to-display latency. An
unsynchronized frame or a second without a new draw makes Delta unavailable.
Discard counters cannot measure loss inside the decoder or before the browser;
they cover observable input rejection, scheduler discards, frame transfer
replacement and presentation failure. Replacement streams reset these counters;
repeating the same configuration does not.

Android Advanced settings has a Debug logging switch, off by default. Off uses
Standard metadata; on uses Debug detail. It applies immediately without changing
the media session. Absent or unknown preferences use Standard.
Both levels retain metadata only. Neither level records media contents, raw
protocol bodies, passwords, keys, pairing codes, authenticated resource URLs, or
personal device names. Addresses and identifiers are redacted.

Standard retains connection and recovery transitions, negotiation and routing,
playback commands and significant state changes, failures, and final stream and
transport summaries. Healthy periodic performance, clock, protocol, probing and
I/O samples belong to Debug. Standard browser loss reports record counter
increments, so a historical drop is not repeated forever as a new incident.
Debug adds sampled FPS, Delta, decode and draw timings, queues, clock status,
packet and transport counters, and sanitized request/response metadata. Sampling
and bounded storage still apply; Debug does not mean a complete packet trace.

## Collection lifecycle and completeness

The log target belongs to the app process, initialized before its activities and
services. CarPlay hosts, the browser link and ordinary AirPlay share that target.
Opening settings, replacing a CarPlay session or destroying an Activity does
not reset or close it. Late callbacks retain their original target; obsolete
controllers may retain teardown evidence without changing current UI state.

Diagnostic writes pass through privacy and detail filters before joining a
bounded background queue. Accepted entries carry a full date and timezone.
Queue overflow discards pending entries; write failure does not stop subsequent
writes. Both conditions increment integrity counters. A later successful write
persists a loss marker so earlier gaps remain visible after a process restart.

Rotation retains a bounded history rather than the entire lifetime of the app.
The authoritative size, archive count and names are in
`SessionLogFile`; the export reports those limits. Starting a new process rotates
the previous active file. App data removal removes private logs. Exported files
have their own lifetime and are not updated when the active log changes.

Exports run outside the UI thread, wait a bounded time for the writer, and read a
snapshot under the same lock used for rotation. The report includes the chosen
detail level, intentional policy/privacy omissions, queue losses, storage
failures, rejected writes, pending entries and drain timeout. Completeness is
scoped to accepted metadata within retained history. It does not certify raw
protocol coverage, unlimited history, or messages still in memory when Android
abruptly kills the process. Explicit process shutdown attempts a bounded flush.
Crash records and Android process-exit evidence remain separate report sections.

See [the browser contract](TESLA_BROWSER.md#picture-and-settings) for source-clock
validity and [the phone settings contract](APP-MAIN-PAGE-IMPLEMENTATION.md) for
immediate settings behavior.
