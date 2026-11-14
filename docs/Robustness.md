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

## Media and wireless recovery

The beta.44 field capture exposes a repeated source PTS followed by a terminal
video writer, and non-silent original Opus packets without browser output while
the independent audio ICE peer remains disconnected. Older retained metadata
also records a mirror receiving deltas for minutes while awaiting a usable IDR.
These are separate from expected source idle, ordinary AirPlay teardown and a
missing car Bluetooth communication device.

The beta.45 follow-up reached only ordinary-AirPlay transport SETUP, event and
feedback traffic; it contained no mirror media SETUP or picture access units.
Consequently it did not exercise `forceKeyFrame`. Combined SETUP information and
preparation observations address protocol/diagnostic gaps, not a proven cause of
the missing stream. Observation expiry leaves that control session available for
late media SETUP.

The current source rejects an equal-PTS access unit without rewriting its time
or feeding it to the native encoder. It invalidates the prediction chain and
requests a new source IDR. The keyframe wait has a six-second deadline from the
first rejected delta or prediction-chain loss; later rejected frames cannot
refresh it. True backward PTS, reordered slices and incompatible codec/profile
remain explicit video failures. A failed source is drained until a different
source configuration arrives, so it cannot permanently kill later CarPlay video.
Mirror ingress waits up to six seconds for the exact source configuration and
subscription to have an admitted, ready native track before publishing its current
original access unit. The condition releases the hub lock and applies only to
ordinary mirroring; it does not hold CarPlay's delivery lock or add a keyframe
cache. Source/subscription replacement and shutdown cancel that wait. Mirror
startup completes only on the browser's first presentation acknowledgment;
forwarding an incoming frame alone does not cancel its startup deadline.

The independent audio offer waits for gathering completion, but its twelve-second
gathering deadline accepts a candidate-bearing partial snapshot. Later candidates
are not trickled. A slot announces readiness only after transport,
Worklet binding and silent playout activation are ready; SDP installation alone
does not authorize sending. Initial negotiation, gathering and transport share a twenty-second budget,
graph readiness a separate five seconds, and a disconnected established peer a
five-second recovery window. Metadata negotiation is bounded by 25 seconds;
original-packet staging has a separate five-second age limit, 256 KiB per stream,
1 MiB globally and 1,024 packets. Rebinding a source does not refresh its packet
age. Each packet retains its original enqueue time; expiry discards that packet
without failing a freshly negotiated peer. A continuing live owner retains its
slot so a fresh tail or later same-epoch packets can proceed. Ended/retired owners
cannot revive, EOS watermarks remain monotonic and replacement peers cannot revive
their ended slots. Genuine metadata/transport readiness deadlines still fail;
retaining a short source beginning does not establish low speaker latency.
After background retries stop, a new source owner can request one further bounded
recovery burst; repeated packets for the same owner cannot reset it. No address
filter infers reachability merely from matching private subnets.

A working wireless session earns the existing bounded 1/2/4/8/16-second recovery
burst after loss. Failed attempts and duplicate Bluetooth events do not reset
that burst. The two-second cleanup wait remains a budget, with radio ownership
retained until asynchronous cleanup really completes.

An observed disabled Android phone Bluetooth radio blocks a new wireless controller
before foreground-service startup. The host shows the existing Bluetooth hint and
waits for radio-state changes, with the inexpensive periodic prerequisite check
retained. Radio-on rechecks browser, permission, menu, ownership and AirPlay gates;
it cannot bypass them. USB and TiPlay's intentional Bluetooth suspension are not
blocked, and a working Wi-Fi session is not restarted merely because Bluetooth is off.

For a continuing Bluetooth voice demand, device arrivals can wake output recovery
without waiting for the remaining backoff. Output prefers the selected car, then
another usable Bluetooth or system route; permissions, audio focus and ownership
still apply. Capture independently requires the verified car input, and permanent
focus loss cannot trigger recovery. Stop and close remove the observer. A paired
car is not necessarily a connected HFP device, and recovery cannot create a
missing system route or substitute the handset microphone. The recorded microphone foreground
service exception is covered by the existing permission/type fallback; current
successful service starts do not reproduce that historical crash.

Device-route and audio-mode clients are cancelled independently. A platform
exception retains only the unfinished ownership and retries at most three times,
one second apart. Already completed cancellations are not repeated, including
after another app takes over. Cleanup failure cannot publish `released=true` or
overwrite the business/focus failure needed for recovery. Permanent failure stays
unreleased; an explicit stop/close can grant another finite cleanup attempt.

The earlier recovery validation passed the required Android command with 4,579 zero-failure, zero-skip JUnit
report cases (2,652 shared, 1,921 common, six home), all three Debug lint and
assembly targets, and 700 browser cases. Unchanged tasks can reuse Gradle results.
Actual Kotlin/JNI/libdatachannel forwarding preserves both tracks' 80 original
Opus payloads and RTP timestamps. Real Chromium software AAC-LC, AAC-ELD and ALAC
reach nonzero Worklet output and release their owners after EOS.

The Chromium original-audio interoperability attempt remains blocked before
signaling: audio, video and DataChannel controls all gather zero local ICE
candidates in this executor. It does not invalidate the native byte/timestamp
check or establish vehicle connectivity. Physical navigation audio, car HFP/SCO,
routed independent-audio ICE, mirror picture and repeated reconnects remain
device acceptance; counters alone do not establish speaker output or a fix for
the target network's connectivity. See [Testing](Testing.md) for those boundaries.

### Diagnostic sufficiency

The post-beta.48 review found that instrumenting a peer does not establish that
its failure evidence survives reporting and export. Browser ICE fields were
missing from the Debug text formatter; Standard telemetry used a separate
admission path. Five-second reporting could miss a failed generation before its
one/two/four-second retry. Native failure messages exceeded the shared
700-character redaction limit, including before Debug journal capture.

The source remediation uses bounded, generation-specific browser failure records,
safe Standard failure summaries and complete split native transport records.
Actual TXT/ZIP roundtrips must verify persistence; in-memory assertions alone do
not establish export completeness. A retained sample is the last accepted
observation, not a guaranteed terminal sample. Queue age does not include network
transit time. Bounded admission, disconnects and storage failures can still lose
evidence; absence must not become zero or success.

A controlled experiment freezes the beta.48 product Kotlin classes and runs the
actual JNI/libdatachannel transport against an official native C-API receiver.
The successful control delivers 160 original Opus packets with identical bytes
and RTP timestamps. A local UDP blackhole receives eight checks without replying;
a separate case deliberately mismatches ICE passwords. Both fail to open and
produce identical complete native transport classifications. Thus
`connecting/checking/not-selected` does not uniquely identify a network or
credential cause. This experiment neither uses Chromium nor reproduces the
vehicle failure. No additional vehicle retest should be requested merely to
prove these local diagnostic contracts.

Two observed audio startups reach their offers near that twelve-second
gathering limit; all twelve audio samples still report `gathering`. A full scan of
the journal finds no outgoing audio answer, so neither gathering completion nor
the answer's actual candidate/credential contents can be reconstructed. Compare
the implemented deadline behavior with those observations; do not describe them
as proof of complete gathering or its causal role.

The captured browser is Chromium 148. Independent controls accept an actual Chromium 151 sixteen-track offer through
the product Router/JNI and install its answer in that browser. Sixteen tracks,
mid/BUNDLE and DTLS role admission pass, but managed UDP prevents connectivity.
The muted anchor's `play()` fulfills even before any RTP arrives in that browser,
so no first-RTP/play-promise deadlock is reproduced. Additional native C-API
controls preserve 2,560 original Opus packets across sixteen bundled tracks and
a forced remote peer-reflexive path. These rule out general lack of BUNDLE/prflx
support; they do not establish Android socket routing or vehicle interoperability.

[Focused hosted proof 43569629973](https://github.com/uJZk/TiPlay/actions/runs/43569629973)
then passes the actual Router/Kotlin/JNI/browser-controller path in default
Chromium 151: seventeen owners and both peer generations reach nonzero Worklet
output without encoded fallback. A separate receive-transform measurement
verifies 220 original Opus frames and RTP timestamps. The two injected failures
also exercise actual browser `getStats()`: all 35 non-age browser fields and all
23 native fields match between the UDP blackhole and wrong-password case.
Therefore full counters still cannot uniquely attribute the vehicle failure.
This does not establish Android socket routing, physical output or mirror picture.

### IPv4 link-local ICE

Post-beta.49 investigation reproduces a native candidate-filter defect relevant
to the hotspot's default `169.254.111.111` alias. Pinned libjuice excludes IPv4
link-local addresses while the main WebRTC transport retains them. Both current
and captured main-peer configuration disable Android network monitoring; do not
attribute the difference to a main-peer `Network.bindSocket()` call. Binding a
local IP and explicitly binding an Android Network are separate operations.

An isolated, native-only two-namespace fixture runs the actual product
NativeRtcAudioPeer/Kotlin/JNI and an official C-API receiver. With only a link-local path
reachable and ordinary candidates unreachable, the original library times out.
Removing only the IPv4 link-local gather exclusion delivers all 80 original Opus
packets with identical bytes and RTP timestamps. A reachable-offer control also
delivers 80 with the original library through peer-reflexive discovery, so the
filter is not a universal failure. These tests leave the host network and managed
browser policy unchanged and do not identify the recorded vehicle's cause.

The minimal patch retains ordinary and mapped IPv4 link-local candidates while
preserving loopback and IPv6 link-local exclusions. Forty cases compile the real
C address classifier; fourteen real archive/patch controls cover preparation,
identity, idempotence and dirty-source rejection. A fresh patched host build
also forwards 160 byte/timestamp-exact original packets. Exact patch and manifest
notices accompany the source. The source-identity gate rejects obsolete
prebuilts, and release preflight verifies it before APK packaging.

Four-ABI producer
[43578453616](https://github.com/uJZk/TiPlay/actions/runs/43578453616) and
authenticated adoption pass: packaged hashes, sizes, Build IDs and 16 KiB
alignment match the actual official archives. Focused Android proof
[43587104717](https://github.com/uJZk/TiPlay/actions/runs/43587104717), source
`e6591ef01d96134de2b336dc0903499e69176c97`, then passes in the actual API35
x86_64 target-app UID and `untrusted_app` domain. It initializes the packaged
main WebRTC library and verifies the packaged native bytes. Both peer
generations gather real IPv4 link-local candidates. Normal Chromium 151 playback
passes all seventeen source owners with nonzero Worklet output and no encoded
fallback; a separate tap verifies 220 original Opus payloads and RTP timestamps.

The fixture explicitly uses legacy WiFi/SLIRP and owned HMP UDP forwarding to
the actual guest address. Runtime NIC/backend association, exact forwarding rows,
same-app-UID nonce echo and all mapping/worker cleanup pass. An earlier classic
forwarding preflight delivered no packets to the app before any native offer;
that failed fixture could not diagnose product ICE. The official evidence ZIP
matches its API digest and both decoded job-log objects. These results establish
this configured Android/browser path, not LL source egress, a concurrently active
main peer, vehicle routing, physical output/capture or mirror presentation. SDK
37.2.13 is observed; its exact source pin is not established. Neither this proof
nor new counters justify another blind vehicle log request.

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
