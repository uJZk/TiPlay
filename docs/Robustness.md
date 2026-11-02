# Robustness

TiPlay's supported product is an Android phone plus a car browser. This document
tracks fault boundaries and recovery guarantees across that product. The audit
baseline is `42db8dca`; its beta.36 product build is `c1ad4b32`. The follow-up work
preserves original-codec RTP video, independent native Opus audio, software audio
fallback, the Bluetooth microphone route and SCO silence keepalive.

## Recovery contracts

Every asynchronous result belongs to the generation and resource owner captured
when its work starts. Re-read ownership before publication, after blocking work
and at final callback delivery. Late work may close its own resources, but must
not publish into, stop or clear a replacement. A short state lock must not cover
external network/library startup, device teardown or an unbounded join.

Cancellation and cleanup are separate observations. Cancellation must become
visible promptly. Opaque platform/library work may finish later; its outstanding
resources and cleanup status must stay accounted for. A timeout must not falsely
declare a radio lease released or permit old cleanup to stop a new owner.
If an opaque library never returns, radio ownership remains quarantined; later
attempts report that cleanup is outstanding. A cleanup exception retains the
failed lease for the process lifetime. These cases may require an app restart;
the application cannot forcibly cancel the library or assert that it released
the radio.

Known media failures need a bounded recovery or an explicit stream-specific error.
Normal idle and successfully displayed static video are valid states. Neither an
absent configuration before projection starts nor a low frame rate alone proves
failure. Rejecting a configuration that has actually arrived is different: it
must not leave a healthy-looking transport silently dropping all frames.

Microphone/SCO ownership, codec output and audio focus are distinct. Report a
downlink decoder failure without pretending that a physically active route has
closed. Transient focus loss may wait for the retained request's gain; permanent
loss and owner retirement must release it. Existing busy-route checks continue
to prevent taking another application's call route.

## Remediation map

The following 19 items shipped in beta.37/code79 with browser/cache v112 from
`d038685c623112407b656ab78995bd8bd8facdfd`. Required source regressions, signed
packaging, Pages and independent public-artifact checks pass; [Build](Build.md#current-browser-deployment)
records their exact scope and hashes. These results do not establish vehicle acceptance.

| Audit | Boundary | Required behavior |
| --- | --- | --- |
| A1 | Tunnel adoption | Capture run/handler ownership; reject and close late old results. |
| A2 | Wireless cancellation | Invalidate promptly; perform blocking cleanup outside state locks with a real budget and tracked ownership. |
| A3 | Queued wireless status | Recheck the original generation at final delivery. |
| A4 | Paired-car request | Explicit user retry works after an accepted request fails; ordinary observations remain idempotent. |
| A5 | Invalid video configuration | Publish a video-only failure or bounded recovery, preserving normal idle. |
| A6 | Call downlink decoder | Bound codec restart and publish current-stream failure; preserve microphone/SCO ownership. |
| A7 | Audio focus | Distinguish transient/delayed/permanent focus and reject stale owner callbacks. |
| A8 | WakeLock | Old grant/reject/release cannot clear or leak the replacement lock. |
| A9 | Native trace temporary files | Clean abandoned app-owned trace staging directories at process initialization. |
| A10 | Wired optional diagnostics | Keep temporary syslog work out of the CarKit critical path; release untransferred Lockdown ownership on failure. |
| A11 | Keyframe command | Bound the actual event write and cancel only the command's socket owner. |
| A12 | First Canvas submission | Independently bound time to first successful presentation, with generation-safe acknowledgement. |
| A13 | Diagnostic callback work | Keep native/system callbacks lightweight; defer metadata with explicit bounded admission and integrity loss reporting. |
| A14 | Log snapshot | Budget queue draining and storage-lock acquisition together; return explicit partial history on timeout. |
| A15 | Archive storage | Read the fixed journal descriptor directly; retry staging-output failure once per private root and retain raw evidence on failure. |
| A16 | Bonjour input | Bound candidate work, first status-line bytes and total probe time. |
| A17 | Browser upgrades | Do not force a new worker protocol into a running old page. |
| A18 | Native dependency identity | Route local vendor artifacts exclusively and verify the final APK against the pinned AAR. |
| A19 | Native symbols | Retain symbols and Build ID indexes for future producer outputs without changing committed binaries. |

The candidate concerning an Activity losing the only session-end recovery event
was withdrawn after tracing the normal type-130 close through `Failed` and the
retained reporter. It is not part of the remediation count.

## Matched post-stop native crash

The November 2 beta.37/code79 capture contains a real Android tombstone whose
PID and time match the selected native exit. Its faulting `VideoEncoderQue`
thread has SIGSEGV at relative PC `0xada5cc` in `libjingle_peerconnection_so.so`,
Build ID `fda638c36519d2b5`, matching the installed ARM64 AAR. The fault instruction
dereferences a null cadence-adapter pointer. It occurs after the second video
generation becomes ready during H.264/HEVC replacement; this timing alone does
not establish every higher-level caller.

The machine-code and field-access fingerprint identify the custom
`VideoStreamEncoder::SetSourceRateSending` implementation with high confidence.
Upstream permanent stop first stops the encoder and clears its cadence adapter,
then stops the send stream. The latter can enqueue a source-rate state update;
the current setter reaches the cleared adapter without a queue-side stop guard.
One configured stream is sufficient. This is a concrete valid-object post-stop
path; a separate use-after-free hypothesis is not needed to explain it.
The historical binary lacks matching full symbols, so this is not a DWARF source
line resolution or an independently executed native reproducer.

Beta.38/code80 with browser/cache v113 is in preparation. Its minimal native fix
must reject the late update on the encoder queue before gate-state changes or
adapter access. Required regression covers a configured stream, permanent-stop
ordering, the late update and queue drain, plus normal fresh-encoder behavior.
The native regression, full AAR producer, matching symbol retention, APK identity
and release/public-page verification are pending. Source inspection cannot prove
repeated H.264/HEVC replacement or sustained vehicle continuity; those remain
acceptance after the matching APK/page is installed. The original 19-item audit
count above is unchanged by this later field evidence.

## Diagnostics and storage

Original media ingress retains its full, synchronous capture contract. Small
diagnostic metadata can use bounded asynchronous admission to keep system/native
callbacks responsive. Saturation, oversize or failure must be counted against
the originating capture session and mark it incomplete; it is not sampling and
must not be hidden. A late metadata task must never enter a later capture.
Stopping/exporting a capture must account for admitted but undelivered metadata.

An export may omit unavailable history only with an explicit partial marker.
Prepared reports remain immutable and reusable across destination fallbacks.
Compressed media journals stay byte-identical in a STORED ZIP; only added report
and trace content is Zstandard-compressed. Failed storage must preserve original
capture evidence. Staging-space requirements and failure must be truthful.

System native traces are opaque bytes. Match PID, time, module, relative PC and
Build ID before attribution, and reject an old ANR as evidence for a native crash.
Producer symbol archives must match their stripped output's Build ID. A fresh
build with a different Build ID cannot retrospectively symbolize an old binary.
Historical missing symbols cannot be recovered by a source-only patch.

## Browser update boundary

Worker upgrades must preserve the existing page/worker protocol as one version.
The conservative update policy lets the new service worker wait until all old
controlled TiPlay pages leave; it must not claim that a same-page disconnect or
reload is sufficient. This policy does not establish atomicity for an initially
uncontrolled network load across an external CDN deployment.

## Verification and remaining device evidence

For the published beta.37 source, the complete [AGENTS](../AGENTS.md) Android
command passed: 4,535 unit cases
(2,613 shared, 1,916 common and six home), mobile/home/maphost Debug lint and all
three Debug assemblies. Node 22 passed all 690 browser cases. The 52 Python
checks cover native symbols, the WebRTC build driver, final-APK verification,
release drafts and site deployment. The freshly assembled mobile Debug APK also
passes the pinned WebRTC identity/provenance, four-ABI ELF and ZIP-alignment gate.
Public-tree, cache, workflow syntax and documentation word-limit checks pass.
Actual AGP Release JNI compilation and stripping also pass: all 24 module/ABI
pairs have matching Build IDs and retained line tables/symbol tables, backed by
`NDK_DEBUG=0` configurations. The signed beta.37 workflow subsequently verified
the APK and privately archived its 24 matching JNI symbol files plus Build ID
index; independent downloads matched both archive assets byte for byte. This
does not supply symbols for the 27 historical prebuilt libraries, eight of which
have no Build ID.

Real Chromium checks cover legacy-to-waiting service-worker updates with two
pages and Processor/Canvas main/Worker paths using a local capture track. They
do not establish a vehicle RTP path or hardware decoding. New owner, failure,
deadline and storage tests exercise the blocked operation or actual transition.
See [Testing](Testing.md) for reproducible source checks and their limits.

Full WebRTC/audio producer rebuilds were not executed for beta.37; actual mobile
JNI symbol archival passed separately. That release replaced no committed AAR or
native prebuilt binary, and all 51 packaged native libraries match beta.36. The three public Release attachments and tag, 226 page files and
156 MIME checks pass independent verification. Full remote CI was skipped for
this release at the user's request; required local source checks, signed
packaging and Pages all ran.

Earlier native SIGSEGV reports still lack their matching native backtraces;
the November 2 matched crash is analyzed separately above. The beta.37 audit
changes do not establish those earlier crashes' causes or prove ARM64 vehicle
continuity. Hardware acceptance still includes sustained calls with transient
focus, actual graphics context loss, existing Wi-Fi handoff and slow storage.
See [Diagnostics](Diagnostics.md) for capture and [Build](Build.md#current-browser-deployment)
for the last published artifact's separate evidence.
