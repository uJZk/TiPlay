# CarPlay browser media transport

## Current implementation and evidence

The Android phone/browser product uses reliable, ordered WebRTC DataChannels
for control, video metadata and audio without a negotiated RTP codec. Live
CarPlay/mirroring video requires a receive-only browser RTP track negotiated with
`webrtc-track-v1`. Android forwards original compressed access units
through a pass-through encoder interface; it does not decode or reencode video.
The browser consumes the decoded track with MediaStreamTrackProcessor and draws
VideoFrames directly to Canvas, without an HTML video element. NetEq/libav.js
audio remains independent. AirPlay URL casting retains its existing
libmedia AVPlayer resource/demux pipeline and playback clocks.

Native Opus audio uses its own peer and a peer-owned detached audio element,
permanently muted with zero volume, to activate Chromium RTP playout. Received
tracks still enter the common AudioWorklet mixer; the element supplies no second
audible output. Exact slot readiness requires fulfilled `play()` plus the
Worklet graph-binding barrier. Retirement releases the anchor and old graph
owners. The [audio contract](Audio-tempo.md#live-audio-official-neteq) records the
original-Opus reproduction and EOS boundary. This audio activation does not add a
video element or change original-codec video forwarding.

Native JNI/RTP checks pass; browser RTP interoperability and vehicle acceptance
remain open. A codec/profile mismatch, reordered source timestamps, unsupported
frame adaptation, failed source replacement or processor failure reports a
video-only error and preserves the audio/control connection. Supported source
changes use authenticated video-only renegotiation with generation/ready barriers. There is no encoded-video
DataChannel or WebCodecs fallback. H.264 B
slices are detected before submission; HEVC reordering is currently detected by
nonmonotonic source PTS, not a complete HEVC reference parser. Sources without a
matching initial negotiated codec also report an explicit video error.

Browser v96 probes existing H.264 profiles with
`MediaCapabilities.decodingInfo({type: 'webrtc', ...})` at 1920×1080/60 fps.
Only `supported && smooth` permits raising that profile's receive level to at
most 4.2; its profile bytes and packetization mode 1 remain unchanged. The bounded
update applies only to existing `recvonly` video sections, before
`setLocalDescription` for initial and replacement offers. SRP/control signaling
binds the final SDP. Source SPS, profile, geometry and frame rate remain unchanged.
These API declarations do not establish hardware decoding or sustained vehicle
performance. Actual Chromium verifies the production probe and retention of
level 4.2 by `setLocalDescription`; managed zero-host-ICE policy still prevents
an end-to-end RTP playback check. See [current verification](Testing.md#current-release-source).

The native sender uses the public `VideoEncoderSelector` to select the real
encoder and negotiated RTP payload type; SDP answer ordering alone does not
select the running encoder. The immutable source must match both the authenticated
remote offer and the answer's profile, receive level and H.264 packetization mode
1. The selector returns the answer's complete permitted format, preserving a
lower negotiated level instead of replacing it with the offer or a factory query.

`onResolutionChange` runs on the first input frame and size changes;
`onAvailableBitrate` can request the same selection later. Native switching is
asynchronous. An old, incompatible wrapper returns `NO_OUTPUT` before constructing
encoded output or calling its callback. A new initialized wrapper invalidates the
old AU dependency chain and requests a fresh source IDR before resuming. An
uncompleted selection fails only video after six seconds. This does not change
source SPS, profile, dimensions or frame rate, or introduce another encoder.

Selector owner tokens bind callbacks to their bridge/native stream. Factory
allocation, native `onCurrentEncoder` announcement and successful wrapper
initialization remain separate observations. The published SDK callback captures
a native pointer: a per-wrapper `callbackGate` serializes initialization, callback
use and release. Release waits for an in-flight callback and clears its callback
and active slot together; output rechecks ownership and the AU dependency chain
at that gate. Retired callbacks cannot publish through a replacement wrapper.

Fourteen focused Java selection/lifetime regressions pass in the complete local
Android suite and CI; release checks are in [Testing](Testing.md#current-release-source).
They do not load the Android JNI bridge. Native sender switching, browser RTP
playback and hardware decoding still require actual device evidence.

The Android product injects its native RTC runtime; JVM server tests use
an injectable peer. The current page requires `webrtc-datachannel-v1` and does not
silently revert to HTTP media. Android disables the old `/video` and `/audio` routes
with 410; old cached pages are outside acceptance. Old `/control` and `/rtc` routes
are disabled rather than used for bootstrap. HTTP retains SRP pairing, public
discovery and random-token resources/retirement only. Protocol fixtures do not
provide a product fallback.

The four playback scenarios and current verification boundaries are in the
[WebRTC roadmap](WebRTC-roadmap.md). Earlier beta.2/v70 had user-confirmed real CarPlay playback; beta.3/v71 recorded
desktop host-to-host UDP and source-cadence/reconnect evidence. Standalone D remains
a local synthetic playback observation. Desktop real-PeerConnection tests exercise
the transport. These observations do not establish current integrated vehicle
reachability, actual car hardware decoding, physical latency or P/non-P continuity. Those remain device acceptance work.

## Confirmed requirements

| Area | Requirement |
| --- | --- |
| Scope | iPhone source, Android phone intermediary, existing car browser. Live CarPlay/mirroring require a negotiated original-codec RTP video track; URL casting retains AVPlayer resource playback. |
| Platform | Android application and webpage may change. Do not require a native car application, modified browser or modified driver. |
| Live video | Actual hardware decoding must occur in the car webpage. Android decoding followed by raw YUV delivery does not satisfy this requirement. Software video fallback does not satisfy it either. URL casting retains its independent media decoder compatibility policy. |
| Normal video delay | At most **+300 ms relative to sender presentation time**, with the lowest practical delay while preserving compressed input and normal pictures as far as possible. This is a ceiling, not a fixed buffer target. Preserve signed measurements; no new hard lower bound of zero was specified. |
| Touch | Forward immediately at the earliest available scheduling opportunity. Touch does not select a special playback profile or change either media timeline. |
| Audio delay | Independently at most **+300 ms relative to its sender presentation time**, normally as low as practical. The former audio-versus-video windows, including -180/+500 ms, are superseded. No additional hard A/V skew window was specified. |
| Audio continuity | Touch must not reset, accelerate or change the audio timeline. Audio may use software decoding. |
| Audio routing | Preserve music/navigation through the car browser. Microphone demand uses Android with verified car HFP/SCO input and corresponding voice playback. Do not use handset microphone or loudspeaker fallback; the webpage must not request microphone access. |
| Transport | Control, video metadata and audio without a negotiated RTP codec use reliable, ordered DataChannel delivery, without partial reliability. RTP video uses the browser's WebRTC reception policy; it does not promise reliable ordered compressed-frame delivery or use an encoded-video DataChannel fallback. |
| Debug capture | Keep complete application-visible original streams. Store the original video payload **once**, with downstream events referencing that copy. No silent sampling or capture loss. |

Natural latency variation is not an instruction to refill a 300 ms buffer.
The four scenarios describe playback priorities, not selectable latency profiles.
Native WebRTC owns live reception timing; URL casting has a separate
receiver-owned AVPlayer media clock and prebuffering policy. Touch press and
release leave playback timing unchanged.

## Design boundaries

Timing, throughput and resource bounds follow the requirements above. Codec and
queue decisions need actual input/capability evidence. Distinguish user requirements,
API guarantees, source tests, device observations and untested assumptions.

The implementation preserves existing codec/PCM audio records and browser decode
semantics. It pins the Android SDK, channel topology, bounds and touch policy below.
The SRP-authenticated transcript binds bootstrap identity; physical performance
and actual vehicle compatibility remain unresolved boundaries; no source-level choice establishes vehicle acceptance.

## Component boundaries

```text
iPhone CarPlay / AirPlay mirror
  -> Android receive/decrypt/configuration and original timestamps
  -> negotiated original-codec RTP track
     -> browser WebRTC buffering and decoding
     -> MediaStreamTrackProcessor -> VideoFrame -> Canvas
  -> browser compositor / car display

ordinary audio -> independent decode/transport/output timeline -> car browser
microphone demand -> Android <-> verified car HFP/SCO
touch and clock exchange -> small control messages, independent of media work
original stream capture -> one canonical payload journal with referenced events
```

The pass-through Java VideoEncoder seam pairs each existing access unit with a
non-pixel VideoFrame buffer. JNI capture timestamps preserve source PTS spacing,
including burst arrivals. Pixel conversion/scaling is rejected. An input dropped
before encoding invalidates the dependency chain and requests a new source key
frame. An RTP codec capability does not prove actual vehicle hardware decoding.

Each M150 factory disables both raw-frame bitrate dropping and congestion-window
frame skipping through the public `Builder.setFieldTrials` environment:
`WebRTC-FrameDropper/Disabled/` and
`WebRTC-CongestionWindow/QueueSize:350,MinBitrate:30000,DropFrame:false/`.
Scaling settings and disabled degradation preference alone do not disable either
pre-encoder mechanism. Both assume the next raw frame can be encoded independently;
dropping an original compressed reference instead forces IDR recovery.
The congestion window and pushback remain enabled with their default limits;
pushback reports a reduced target rate instead of a raw-frame skip ratio. Network
feedback, RTP pacing and actual overload guards remain active. Passthrough cannot
change source bitrate to honor that target, so this is not source rate control.
The native cadence queue also coalesces raw inputs when more than one is queued.
The producer waits outside native/send locks for the preceding encoder input to
finish before capture. Completion follows the encoder callback or published loss
state; it does not wait for an encoded buffer retained for screen cadence. Storage
stays in the existing bounded reliable source queue. A retired wait cannot fail a
replacement; input failure uses generation-scoped control without blocking video
credit under the shared send lock.

Each sender explicitly admits up to 64 Mbps instead of the SDK's 2.5 Mbps 1080p
default, with a one-time 24 Mbps peer startup estimate. No minimum is set and real
feedback/pacing may reduce the rate. This prior does not encode at that bitrate or
change source bytes, and is not reapplied on each IDR/source replacement.
Actual input loss still invalidates the dependency chain. The source processor
retains the SDK's normal drop/crop/timestamp decisions and separately counts
observed, adaptation-dropped and forwarded inputs.
Sender `video-flow` and receiver `transport.rtpVideo` evidence in
[Diagnostics](Diagnostics.md#live-video-policy-evidence) distinguish those remaining
boundaries; this configuration alone does not establish vehicle continuity.

Processor exposure is detected separately on Window and DedicatedWorker. A main
thread Processor can transfer VideoFrames through bounded delivery to the
existing Worker/OffscreenCanvas; a Worker-only implementation transfers the
track instead. Transfer/processor failures report a video-only error. Old APKs
without RTP video support require an upgrade for live video.

For video-only replacement, keep the initial video transceiver inactive when
retiring its track: that m-line can anchor BUNDLE's DTLS/SCTP transport. Stopping
it before the in-band `video-offer` reaches the phone can reset SCTP and strand
the offer on its own control channel. Each generation still receives a distinct
track; old tracks stop, later non-anchor transceivers retire, and the existing
generation/ready barriers prevent previous-source frames from being admitted.
The inactive anchor is released with the peer.

Preserve source-compressed video without reencoding: the subsequent explicit
constraint is never to encode the video a second time. Decryption, configuration
parsing, AU assembly and transport packetization are allowed. Final decoding must
still use actual hardware in the webpage. Do not assume HEVC or AVC wins without
actual input and browser capability evidence; an unsupported source/decoder
combination requires an explicit compatibility/recovery decision, not transcoding.

### Three different orders

| Order | Responsibility |
| --- | --- |
| Network sequence and fragmentation | Reconstruct complete original bytes/AUs before decoder submission. |
| Compressed decode order | Satisfy codec reference dependencies; do not sort encoded input by PTS instead of decode order. |
| Presentation order and time | Obtain correctly ordered decoded pictures, then select their display times. |

For example, display order `I0 B1 B2 P3` can require decode order
`I0 P3 B1 B2`, because B1/B2 reference P3. Waiting for the whole group at reception
does not remove this dependency, and can delay useful parallel decoding.

Current live video rejects detected reordering and draws decoded RTP-track frames
directly. The preceding WebCodecs decoder/presentation scheduler is retired; its
output-order assumptions must not be used to add another live reorder buffer.
`max_num_reorder_frames` is a bitstream restriction, not a millisecond latency
cap or an instruction to always accumulate that many frames. Do not lower a
parameter-set declaration below the real stream's requirements to disguise delay.

## DataChannel deployment and protocol work

### HTTPS, four-digit pairing and authenticated signaling

Tesla users manually enter the existing Android address and **four-digit code**.
No clipboard, long fingerprint entry, QR scanner or native car application is
required. A copied phone link remains optional convenience for browsers that can
use it.

The HTTPS webpage uses browser WebCrypto and the vendored MIT `tssrp6a` 3.0.0
client; Android uses the existing Bouncy Castle 1.79 SRP6 server. They implement
SRP-6a with the RFC 5054 2048-bit group, SHA-256, and Bouncy Castle's padded evidence
messages. The adapter changes identity/evidence hashing, not SRP arithmetic.
JVM-generated cross-language vectors cover public values, shared secret,
client/server evidence and the session-key HMAC.

1. `POST /rtc/pair/start` receives only the page session ID and returns a random,
   expiring challenge, salt and server SRP public value.
2. `POST /rtc/pair/finish` receives the client public value, client proof and
   gathered browser SDP offer. A challenge is consumed on every proof attempt.
3. After checking the proof and current code, Android returns server proof,
   gathered SDP answer, application peer ID and HMAC-SHA256 session binding.
4. The browser verifies server proof and the binding before applying the answer.
   The binding uses length-prefixed protocol/challenge/page identity, both SRP
   public values, salt, complete offer/answer SDP and application peer ID. This
   authenticates the DTLS fingerprints inside SDP without a public-CA certificate
   on the Android endpoint.
5. The established encrypted control channel must receive `{k:'auth',q,s,c}` before
   the existing ownership gate releases media. The four-digit code is sent only
   inside that DTLS-protected channel, never through HTTP signaling.
6. Only the successful encrypted admission response supplies the random resource
   bearer. HTTP finish does not expose it; HTTP resource and bye operations use
   this token rather than the four-digit code. Authenticated control status supplies
   clock observations; public `/hello` timing is not a trusted media clock anchor.

The shared online-guessing lockout applies to failed proofs and encrypted code
admission. Challenges are single-use, bounded and expire after 30 seconds. Native
peers are bounded to three, with 15-second unauthenticated and six-second inactive
session cleanup. Replacement, new code, disable, disconnect and stop retire the
old peer and its touches. A replacement browser cannot inherit stale media work.

The four-digit secret provides limited protection against online guesses; rate
limits remain necessary. HTTPS protects the page and its cryptographic code.
PAKE does not make denial of service impossible. Legacy authenticated HTTP media/control routes are disabled in the Android product;
factory-free protocol fixtures are not a product fallback.
AirPlay HTTP resources receive a random active-session bearer over the encrypted
channel, so resource URLs do not disclose the four-digit code.


### Reliability, channel separation and bounded work

- Use ordered delivery with `maxRetransmits` and `maxPacketLifeTime` unset.
  Reliability lasts while the connection remains viable; it is not a guarantee
  against disconnects or unlimited network outages.
- Separate video, ordinary audio and control logically. Multiple DataChannels in
  one PeerConnection normally share an SCTP association, congestion control and
  resources; they do not provide the isolation of separate network paths.
- For the retained encoded-record protocol, reassemble complete AUs. Bound
  application fragments by negotiated
  `maxMessageSize`, including application headers. Without confirmed SCTP message
  interleaving, an initial 8–16 KiB fragment candidate avoids sending a large IDR
  as one association-monopolizing message. Final sizing needs measurement.
- Include session/stream/epoch identity, record sequence, AU boundaries, original
  timestamp/timebase and configuration identity. Validate bounds, duplicates,
  stale fragments and malformed lengths before allocating or decoding.
- Bound bytes, oldest media age, incomplete AUs, sender in-flight work and
  receiver resources. Use application credit/consumption feedback;
  `bufferedAmount` is not proof of remote receipt, decode or presentation.
- Keep control processing independent of video decode, drawing and disk I/O.
  Preserve down/up/cancel pairing and coordinate/rotation semantics. A new browser
  owner must retire the old peer and its pending control/media epochs.
- Maintain necessary decode lookahead. A rule allowing only one compressed AU
  until an output arrives can deadlock a stream requiring future reference input.
- The pinned Android WebRTC dependency and verified ABIs/licenses are recorded
  below. Changes must recheck threading/lifecycle, features, APK cost and
  reproducible builds.

Reliable DataChannel is not automatically faster than TCP/WSS. Retransmission,
ordered delivery and shared congestion can still stall video. The implementation
must expose these stalls rather than hiding them behind a growing queue.

## Timing, hardware and finite-resource boundaries

For each picture or audio sample, define Delta as actual output time minus the
mapped **sender presentation reference**. Arrival time, decode callback time,
RAF/draw submission and sender capture time are not interchangeable references.
Maintain source-to-Android-to-browser monotonic-clock mappings, sample positions,
epochs and uncertainty. First arrival must not become an invented source zero.

Identify the source timestamp semantics and synchronization actually supplied by
CarPlay. If a source presentation-clock anchor is unavailable, report only the
local quantities that can be measured; do not claim sender-relative +300 ms.
Calibrate compositor/panel and audio-device/DSP delay separately. Software events
alone do not prove physical video or acoustic output latency.

`prefer-hardware`, successful configuration, `powerEfficient` and low CPU do not
prove actual hardware decoding. Establish evidence for each supported
browser/codec/profile configuration and disclose unobservable fallback behavior.
`decodeQueueSize = 0` does not mean DPB, driver, GPU and display queues are empty.
Release unused VideoFrames promptly; count all simultaneously live surfaces and
avoid submitting hundreds of milliseconds of hidden hardware work.

Sustained network and decode service must exceed input demand, including large
AU bursts and thermal operation. No finite queue fixes sustained overload. If
complete input, finite resources and +300 ms cannot all be preserved, report the
violation and use a real supported renegotiation/recovery boundary. Do not reset
PTS or discard predictive compressed frames to make metrics look compliant.

### Presentation and interaction

Touch-specific catch-up is disabled at the application boundary. RTP video uses
the browser's receive timing and presents decoded track frames directly. Touch
events do not steer audio or change the video playback profile.

If the newest complete, decoded picture can only become physically visible at
+40 ms, skipping older outputs cannot produce zero Delta. Report this available
frontier and the remaining error. A catch-up duration can exceed 300 ms while
each displayed picture stays within its separate 300 ms age ceiling.

### Audio and complete capture

Keep music/navigation, speech streams and HFP transitions distinct. Correct
source-sample accounting and bounded resampling may compensate genuine device
clock drift; video Delta and touch must not drive audio acceleration. Verify the
car route before microphone readiness, including cold SCO startup and loss of
the selected device. API acceptance alone does not establish physical routing.

Record original video bytes once at a canonical Android application boundary.
AU assembly, DataChannel fragments/retransmission metadata, decoder submission
and display decisions should reference record IDs/byte ranges rather than dump
another full outgoing video stream. Distinguish transport loss, input gaps,
decode failures, decoded-but-not-displayed pictures and successful submissions.

Capture needs its own bounded resources and sustained storage throughput.
Document durable versus merely queued records. If storage cannot keep up,
reserve enough capacity to stop safely and disclose the integrity boundary;
finite memory cannot guarantee indefinite, nonblocking, lossless recording under
unbounded disk failure. Do not silently sample, overwrite or drop raw payload.

## Implementation and verification

The Android dependency is `io.github.webrtc-sdk:android:150.7871.01` (WebRTC M150),
pinned from Maven Central with four project ABIs; TiPlay keeps minSdk 25.
See [licenses and artifact provenance](Third-party-notices.md#android-webrtc-transports).
The official page replaces the root at <https://ujzk.github.io/TiPlay/>; the old
independent `/webrtc/` site is removed without an alias or redirect. The APK uses
the root. Native peer disposal runs outside WebRTC callbacks, control work is bounded and
media/credit stalls retire the session explicitly. Canonical control input uses
one FIFO ingress worker with a 256 KiB/2,048-message burst mailbox and a 64 KiB
per-message limit. ACK validation/credit advancement stays independent of the
64-task application RPC queue; authentication is a cross-worker barrier, and
audio-subscription changes retain application FIFO ordering. These are finite
resource bounds, not guarantees against an indefinitely blocked capture disk.
Pending diagnostic RPCs no longer stop both media pumps. A fair native-send lock
gives waiting control replies a send opportunity while preserving media-buffer
limits. A 200ms oldest-media age is
diagnostic evidence rather than an immediate session-ending condition; bounded
overflow and six seconds without genuine consumption progress remain recovery
boundaries. Revalidate the historical reconnect symptom on the actual device.

`POST /rtc/pair/start` and `POST /rtc/pair/finish` carry the SRP exchange described
above; the browser verifies the server evidence and transcript binding before
applying the answer. The native peer and existing ownership gate then admit
`control`, `video` and `audio` as reliable ordered channels. No bare `{c,s,offer}`
HTTP endpoint admits a production peer, and media/control never fall back to HTTP.
No public STUN/TURN is configured. Native interface enumeration supports real
hotspot/Shizuku aliases without requiring a ConnectivityManager handle; it does
not invent or rewrite candidates. It also loses Android per-Network socket binding
and network-change notifications. Actual route, VPN behavior, UDP reachability
and hotspot restoration still require device verification.

Each binary message is at most 16 KiB including a 24-byte little-endian header:

| Offset | Field |
| --- | --- |
| 0 | `TDR1` magic (`0x31524454`) |
| 4 | Transport epoch, independent of media/config epochs |
| 8 | Per-channel unsigned record sequence, modulo 2^32 |
| 12 | Complete record byte length |
| 16 | Fragment offset |
| 20 | Fragment payload length |

Video carries existing Records V1, including original sequence, codec epoch,
timestamp and timing records; audio carries existing audio records. Reassembly
validates epoch, order, offsets, complete length and queue budgets before decoder
admission. The browser ACKs `{k:'ack',channel,q,bytes}` when the reader advances
past a complete record, independently of SCTP receipt. Windows are 16 MiB video /
2 MiB audio; single video payloads retain the existing 8 MiB limit. These are byte
limits, not latency targets. Audio opt-out closes only its subscription; video
cancellation or a protocol error retires the peer.

Each audio open has a new unsigned consumer generation. `audio-ready` carries
that generation; the single Android audio pump completes already-admitted old
records, closes the old subscription and sends `audio-barrier` with the new
generation, transport epoch and first new record sequence. The browser holds the
new reader until its matching barrier and consumes/discards older in-flight
records. Control/media can arrive in different orders without replaying old audio.
Unadmitted old records cancel without consuming a wire sequence or blocking credit.

The encoded-video record framing remains a metadata/protocol compatibility boundary;
it is not a fallback for live video. Current live pictures use original-codec RTP,
with source dependency/IDR guards and video-only failure as described above.
Mirroring suspension closes hidden decoded output without adding a second video
encoder or an application presentation queue.

Run the required [source checks](Testing.md#automated-checks) and applicable
[browser harnesses](../tests/web-e2e/README.md). Source tests cover real desktop
DataChannel exchange, framing/credit/epoch rejection, lifecycle/ownership,
independent audio, decoded-frame bounds, touch forwarding and AirPlay resource
cancellation. They do not establish Android JNI behavior on every device, actual
hardware use, acoustic/panel latency or sustainable thermal performance.

Physical acceptance must cover `169.254.111.111`, loss/retransmission, large AUs,
long thermal sessions, repeated touch, gear transitions, background/foreground,
VPNs, HFP route changes, hotspot restart, replacement owners and storage pressure.
Measure source-relative physical output with explicit clock uncertainty. The
SRP proof and length-prefixed session-key binding authenticate both SDP transcripts,
including DTLS fingerprints. Four-digit online guessing and denial-of-service
limits remain; HTTP AirPlay resources have separate LAN confidentiality limits.

Public references: [WebCodecs](https://www.w3.org/TR/webcodecs/),
[WebRTC](https://www.w3.org/TR/webrtc/),
[DataChannel / RFC 8831](https://www.rfc-editor.org/rfc/rfc8831),
[WebRTC security / RFC 8827](https://www.rfc-editor.org/rfc/rfc8827),
[ICE / RFC 8445](https://www.rfc-editor.org/rfc/rfc8445),
[secure contexts](https://www.w3.org/TR/secure-contexts/), and
[Web Audio](https://www.w3.org/TR/webaudio-1.1/).
