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

The latest beta.51/code93/v123 vehicle capture begins on an already connected
peer and lasts 12.851 seconds. Native ICE/DTLS, a selected nominated pair and
exact owner readiness succeed; common Worklet nonzero samples rise to 222,544
with peak 0.14. The previous persistent ICE/no-software-output symptom is absent
in this observed session. Nine retained failure groups belong to the earlier
beta.50 process, not a new beta.51 regression. Siri microphone capture remains
unopened. The nonzero sample precedes this MIC request by 258 ms, so it does not
certify that Siri utterance or physical speaker sound.

CarPlay HEVC continues decoding and drawing after a source-picture gap of about
9.75 seconds that begins before the capture. A contained six-second window has
no pictures but receives empty-body nonpicture messages. Static sources may
intentionally conserve frames; this does not establish a user-visible fault or
downstream loss. Ordinary AirPlay mirroring is absent, so its earlier black-output
and keyframe-reply recovery remain unverified. Software draws do not establish
physical pixels.

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
focus loss cannot trigger recovery. Stop and close remove the observer.

A paired car is not necessarily a connected HFP device, and recovery cannot
create a missing system route or substitute the handset microphone. In the
beta.51 capture, the requested and actual output match the selected car's A2DP
device. An unmatched SCO candidate has a placeholder identity; the selected
car's HEADSET/SCO ownership remains unknown. A2DP selection bypasses input
enumeration, so `input-devices candidates=0` does not establish an absent system
microphone. Siri and guidance remain on the browser path; the ready Android
AudioTrack is not evidence that Siri was heard. The user reports the call-audio
setting exists, Android media can play through the car's Bluetooth speakers, and
a remote caller hears the car microphone during an ordinary Bluetooth call on
the same phone/car pair. This confirms the underlying media/call capability, not
the setting's exact switch state, this TiPlay/Siri stream or TiPlay's current
SCO input port and recording eligibility. The current capture ends
during active MIC demand; missing release is not a cleanup leak.

The current process records microphone and location eligibility rejection before
raw capture. Successful promotion logs are Debug-only, so current eligibility
remains unknown. Recording stops first at the route gate; foreground eligibility
is a separate prerequisite, not the proven cause of this attempt. The retained
October microphone-service exception is historical.

Beta.52 adds an Android 12+ SCO preparation probe while the selected car's
exact A2DP output is working. It requires one connected HEADSET device matching
the selected car, one masked SCO candidate, current permissions/focus and an idle
communication route. An eight-second preparation budget bounds the attempt;
another app's active communication route is not taken over. The app owns its
mode/device request and checks current demand throughout. A placeholder permits
only preparation: capture still needs an independently exact car SCO input and
verified actual recording route. Capture has its own revocable lease; cleanup
waits for its worker acknowledgement before withdrawing the owned route. A failed
probe does not retire working media playback merely to attempt capture. Output
preference and browser call suppression remain unchanged; global Bluetooth
voice-recognition start/stop calls are not used.

The visible, explicitly receiving Host can also prepare the existing session
service before a browser viewport or iPhone controller exists. Its retained
preparation owner is independent of `CarPlayBackgroundSession`; `hasSession` and
`isOwner` keep their existing semantics. A real stored session adopts the same
unstopped service and its actual accepted foreground types without another
background promotion. Settings-only entry cannot arm it. Settings/permission
withdrawal can remove access, while adding privacy types requires an actually
resumed Activity. Pause does not revoke a legally armed wait. Explicit Stop,
superseded Hosts, recreation, stale receiver callbacks and retired service
lifetimes are fenced by owner/token identity.

Focused source checks pass 134 shared and 110 common cases: 244 distinct fresh
cases with no failures/errors/skips, including twelve preparation-lease and eight
public Host cases. Ninety-one scoped browser cases also pass.
[API36 helper run 43798317968](https://github.com/uJZk/TiPlay/actions/runs/43798317968)
passes all three scenarios and seven independently replayed phases from the same
final source.
It verifies foreground MIC retention after 45 seconds in background, fresh-background
MIC rejection, missing-permission fallback and normal cleanup. The actual helper
protocol and source lifecycle tests have separate scopes;
neither establishes on-device production Host integration or physical TiPlay
microphone capture. The latest beta.51 field report remains the vehicle baseline:
software downlink succeeds, but the exact app SCO input and actual Siri capture
remain unverified.

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

An earlier local Chromium attempt was blocked before signaling by this executor's
UDP policy; its zero candidates are not a vehicle finding. Later configured
Android/browser proof and the beta.51 field capture have separate scopes. The
field capture now shows connected native audio alongside the main video/control
peer. TiPlay-specific physical sound, selected-car microphone capture, ordinary
mirror pixels, sustained recovery and exact source-preference/fallback execution
remain acceptance boundaries. See [Testing](Testing.md).

### Diagnostic sufficiency

The beta.49 remediation preserves generation-specific browser failures through
bounded immediate reporting, Standard/Debug admission and split native records.
The latest beta.51 report preserves all 25 observed native-audio fields in each
of two healthy Debug snapshots, including explicit selected-pair presence and
connected ICE/DTLS. Their sample ages are 541.6–542.3 ms; there is no current
first-fault queue age to infer. Its nine complete two-part failure groups and
two 23-field native snapshots belong to the previous beta.50 process. Those
older faults retain 1004.2–1038.2 ms last-sample ages and 0–1 ms browser queue
ages. The later closed native snapshot is not another first fault. Do not assign
old failures or the preceding 16.249-second unfinished-attempt boundary to the
new, already connected peer.

Failure snapshots retain the last accepted observation, not a guaranteed terminal
sample. Queue age excludes network transit. Scope counters by main peer,
audio generation and pair scope; missing fields remain unknown. Native
`selectedPairResult=-3` means not selected, not socket errno. Absent selected-pair
members do not imply zero gathered candidates. Bounded queues, disconnection,
storage failures and rolling history can still lose evidence. Complete local
capture does not establish remote receipt, physical output or fsync durability.

Controlled UDP-blackhole and wrong-password failures produce identical complete
native classifications and all 35 non-age browser fields. Complete counters
therefore do not uniquely identify a network or credential cause. Actual TXT/ZIP
roundtrips establish export contracts; further vehicle logs are not needed merely
to verify those local contracts.

[Focused hosted proof 43569629973](https://github.com/uJZk/TiPlay/actions/runs/43569629973)
passes the product Router/Kotlin/JNI/controller path in default Chromium 151:
seventeen owners and two peers reach nonzero Worklet output, while a separate
tap verifies 220 original Opus payloads and RTP timestamps. C-API BUNDLE and
peer-reflexive controls preserve 2,560 original packets. These establish the
tested paths, not this vehicle's audio socket route. The captured car browser is
Chromium 148. Its muted anchor and graph binding cannot substitute for connected
transport. Positive Worklet frame counts can include zeros; nonzero samples and
physical sound are separate observations.

The audio offer still spends about twelve seconds gathering within its shared
twenty-second negotiation budget. That startup cost is a possible optimization,
not an explanation for the earlier beta.50 zero STUN responses. Do not change gathering
or deadlines and claim a connectivity fix without an independent mechanism test.

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

The beta.50 vehicle capture uses a CGNAT HTTP entry. It reports three native
IPv4 hosts and one IPv6 host, but no current complete candidate-class snapshot.
Whether a usable link-local interface exists, whether the main peer selected it
and whether this patch applies to the observed failure remain unknown. Do not
copy the earlier beta.48 capture's IPv4LL-zero inference into this report.
The latest beta.51 raw has no HTTP requests or plaintext offers, so its control
entry and precise IPv4 subclasses remain unknown.

### Native audio source address

An isolated Linux namespace control demonstrates a socket-source failure
mechanism with two real libdatachannel C-API peers and the official Opus
packetizer. Three conditions run twice each. With an ordinary route and an
unbound sender, each receiver obtains 80 original Opus payloads with exact RTP
timestamps. Changing only the route's preferred source keeps the same egress
interface and advertised ANY address set, but prevents connection; no original
frames are submitted. Binding the sender to the known good local IPv4 address
restores all 80 exact payloads/timestamps in each repetition under that same
wrong-source route. SDP is generated normally and is never manually rewritten;
binding naturally narrows its gathered address set.

This establishes the source-address mechanism, not the vehicle cause. The probe
uses a patched host library, not the product Kotlin/JNI, Android, Chromium or the
main peer's selected-pair callback. Existing field data still cannot identify
the actual audio egress source or authenticate the loaded native Build ID.

The source preference applies only when the current connected main peer selects
an eligible UDP host IPv4 address that is still assigned to an up local
interface. Only the actual main selected-pair local candidate supplies this hint;
HTTP Host and remote endpoints cannot choose it. The hint remains local and is
not added to diagnostics. A later native audio generation can prefer that address
through libdatachannel's public bind configuration. The offer must contain a
component-1 UDP host candidate with a strict IPv4 literal; mixed IPv4/IPv6 offers
remain eligible. IPv6-only, mDNS-only
or otherwise ineligible offers retain ANY binding, without DNS. The main hint
is cleared on disconnection, failure or closure. Any bound-peer failure, or
retirement while unready, suppresses the preference for the same address
revision so a later attempt returns to ANY. Only normal retirement while still
ready keeps the preference; earlier readiness does not excuse a later unready
retirement. Changing or clearing the local-address hint advances the revision;
another selected pair with the same hint does not reset a blocked preference.
Path-revision tokens reject old callbacks and cleanup; an already active audio
peer is not restarted merely to adopt a new preference. Binding a local IP is
distinct from binding an Android Network or changing system routes.

A second namespace probe compiles a byte-identical copy of the current production
JNI C source for a host JVM, with an exact-signature Java driver and C-API receiver.
Four route conditions run twice: null binding with a normal route and good binding with a
wrong-source route each deliver 80 exact original payloads/timestamps per run;
null or wrong binding under the wrong-source route remain unselected and submit
no media during the bounded observation. Short DNS text is rejected before peer
creation. This verifies JNI propagation and source binding, not the Kotlin route
coordinator, actual main-pair selection, Android UID routing or a vehicle. The
negative runs do not exercise the full product failure timer. A longer run keeps
the wrong-source ANY case unselected and unready for 26.049 seconds across 130
samples; the native peer never reports failed. The same route with good binding
then delivers all 80 exact payloads/timestamps. Although the observation exceeds
the product's twenty- and twenty-five-second windows, those product timers and
the Kotlin fallback coordinator do not run in this host probe.

Beta.51/code93/browser v123 is published from
`9a03b85c61385e616c5cbbf714a60ea3bfe3e101`. Five focused browser/version
files pass 91 cases; the adapter's 15 Node cases, twelve Python workflow contracts,
two site checks and cache/prebuilt/public-tree checks pass. All 55 focused Android
cases, including fourteen route regressions, pass with no failures or skips;
actual instrumentation Java compilation succeeds. Full CI remains waived.
[Build](Build.md#beta51-release) records the independently verified signed release
and public bytes; these checks remain separate from earlier release results.

[Same-source Android run 43688557977](https://github.com/uJZk/TiPlay/actions/runs/43688557977)
passes with the real source-built debug APK in API35/x86_64's app UID and
`untrusted_app` domain. Each measurement explicitly supplies an existing ordinary
guest IPv4 address: its two generations each have one exact pre-NAT UDP host
candidate and no link-local candidate. Seventeen owners/two peers reach nonzero Worklet output;
a separate tap verifies 220 exact original payloads/timestamps. Packaged-library
identities, same-UID nonce echo, actual NIC/HMP forwarding and all cleanup pass.
The main WebRTC library is initialized without creating a main peer. Thus this
proves explicit binding in that configured Android/browser topology, not automatic
selected-pair hint/fallback integration, active-main coexistence or the signed
APK's runtime. [Testing](Testing.md#current-release-source) retains the scope.

Preserve independent original-codec audio, generation/owner barriers and the
verified-car microphone gate. The latest field report's three single-IPv4 native
answers are consistent with the preference, without direct bind-mode/address or
assignment-check evidence. No current failure exercises same-address-revision ANY
fallback. Successful ICE/DTLS and nonzero Worklet output establish the observed
improvement, not the earlier route fault's unique cause. TiPlay/Siri physical
audibility, TiPlay microphone capture and ordinary mirror presentation remain unverified.

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
