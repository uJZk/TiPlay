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
packaging, Pages and independent public-artifact checks pass; the
[frozen beta.37 record](https://github.com/uJZk/TiPlay/blob/842574d135492af726ae255ec9463d1408490494/docs/Build.md#current-browser-deployment)
retains their exact scope and hashes. These results do not establish vehicle acceptance.

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
the affected setter reaches the cleared adapter without a queue-side stop guard.
One configured stream is sufficient. This is a concrete valid-object post-stop
path; a separate use-after-free hypothesis is not needed to explain it.
The historical binary lacks matching full symbols, so this is not DWARF source
line resolution. Its old-binary fault has not been independently reproduced.

Beta.38/code80 with browser/cache v113 is published from
`ab629363e6af9d7ea914fd8808baf84ab5f391fb`. Its minimal native guard rejects
late updates on the encoder queue before gate-state changes or adapter access.
Producer `aef6c97a2402f4f5ef4a821a876a11941116d180`, run `41382204134`, rebuilt
all four AAR ABIs. Eleven actual focused native tests pass, including the
configured-stream post-stop regression. The fixed-AAR JNI probe stops the active
video transceiver, retires the old MID, advances epoch 1→0→2, resumes replacement
RTP and completes 72/72 control heartbeats. Its counting decoder does not verify
receiver pictures or physical HEVC/vehicle behavior. New matching symbols and
APK identity have been verified; [Testing](Testing.md#current-release-source)
and [Build](Build.md#current-browser-deployment) record their scope.
Repeated H.264/HEVC replacement and sustained vehicle continuity remain physical
acceptance after installing the matching APK/page. The original 19-item audit
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

For beta.38, the required [AGENTS](../AGENTS.md) Android command passes with
4,535 zero-failure JUnit report cases, all mobile/home/maphost Debug lint and
assemblies. Unchanged shared/home tests and home/maphost builds reused Gradle
results; this is not a claim that all cases were freshly executed. The actual
mobile Debug APK passes the new AAR/patch/provenance gate. The 690 web, 52 Python
and separate 27 native probe-driver cases pass. The full native AAR build and
11 focused native regressions pass independently of those source checks.

The signed APK verifies exactly four replaced WebRTC libraries and 47 unchanged
libraries, signer/runtime continuity, exact source, 25 ELF64 and all 51 JNI ZIP
entries aligned to 16 KiB. Its two producer archives were independently verified:
24 app-JNI matching line/symbol pairs for the application commit and four WebRTC
pairs for the native producer. Twenty-three historical libraries still lack
matching line symbols, eight have no Build ID. New symbols cannot retrospectively
resolve the old crashing ELF. The full WebRTC producer has run; the independent
audio producer was not rebuilt for this release.

All three public Release attachments and the tag, 226 page files and 156 MIME
checks pass independent verification. Full remote CI was skipped at the user's
request; required local checks, native producer, signed packaging and Pages ran.
The [frozen beta.37 record](https://github.com/uJZk/TiPlay/blob/842574d135492af726ae255ec9463d1408490494/docs/Build.md#current-browser-deployment)
retains the original audit release's evidence. Earlier real Chromium worker-update
and local-track Processor/Canvas probes establish those paths, not a vehicle RTP
path or hardware decoding.

Earlier native SIGSEGV reports still lack their matching native backtraces;
the November 2 matched crash is analyzed separately above. These results do not
establish those earlier crashes' causes or prove ARM64 vehicle continuity.
Hardware acceptance still includes sustained calls with transient focus, actual
graphics context loss, existing Wi-Fi handoff, repeated codec replacement and
slow storage. See [Diagnostics](Diagnostics.md) for capture and
[Build](Build.md#current-browser-deployment) for the published artifact's evidence.
