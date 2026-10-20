# CarPlay reliable DataChannel contract

## Current implementation and evidence

The Android phone/browser product now uses reliable, ordered WebRTC DataChannels
for compressed CarPlay and ordinary AirPlay live media. The browser still controls
WebCodecs decoding and Canvas presentation; Android creates no RTP media track,
video encoder or browser microphone path. AirPlay URL casting retains its existing
resource/demux pipeline and uses the shared smoothness-first casting profile.

`AndroidBrowserRtcFactory` is injected by the Android product; JVM server tests use
an injectable peer. The current page requires `webrtc-datachannel-v1` and does not
silently revert to HTTP media. Android disables the old `/video` and `/audio` routes
with 410; old cached pages are outside acceptance. `/control` remains a startup/status
bootstrap before the DataChannel is ready. HTTP media fixtures remain only in the
factory-free JVM server tests.

The four policies and current verification boundaries are in the
[WebRTC roadmap](WebRTC-roadmap.md). Standalone vehicle D can play, and desktop
real-PeerConnection tests exercise the transport. Neither proves Android/vehicle
UDP reachability, actual car hardware decoding, physical latency or P/non-P
continuity. Those remain device acceptance work.

## Confirmed requirements

| Area | Requirement |
| --- | --- |
| Scope | iPhone source, Android phone intermediary, existing car browser. Live CarPlay/mirroring use DataChannels; URL casting retains resource playback with the shared casting profile. |
| Platform | Android application and webpage may change. Do not require a native car application, modified browser or modified driver. |
| Live video | Actual hardware decoding must occur in the car webpage. Android decoding followed by raw YUV delivery does not satisfy this requirement. Software video fallback does not satisfy it either. URL casting retains its independent media decoder compatibility policy. |
| Normal video delay | At most **+300 ms relative to sender presentation time**, with the lowest practical delay while preserving compressed input and normal pictures as far as possible. This is a ceiling, not a fixed buffer target. Preserve signed measurements; no new hard lower bound of zero was specified. |
| Touch | Forward immediately at the earliest available scheduling opportunity. Smoothly bring **video** Delta toward zero as quickly as smoothness permits. Complete compressed reception and dependency decoding continue; skipping old **decoded** pictures during catch-up is explicitly allowed. |
| Audio delay | Independently at most **+300 ms relative to its sender presentation time**, normally as low as practical. The former audio-versus-video windows, including -180/+500 ms, are superseded. No additional hard A/V skew window was specified. |
| Audio continuity | Touch must not reset, accelerate or change the audio timeline. Audio may use software decoding. |
| Audio routing | Preserve music/navigation through the car browser. Microphone demand uses Android with verified car HFP/SCO input and corresponding voice playback. Do not use handset microphone or loudspeaker fallback; the webpage must not request microphone access. |
| Transport | Use reliable, ordered DataChannel delivery. Do not configure partial reliability to discard compressed media after a timeout or retransmission count. |
| Debug capture | Keep complete application-visible original streams. Store the original video payload **once**, with downstream events referencing that copy. No silent sampling or capture loss. |

Natural latency variation is not an instruction to refill a 300 ms buffer.
Playback balances the four user-selected priorities through bounded profiles.
Necessary readiness/jitter margins remain below the live ceiling; URL casting has
a separate receiver-owned media clock and stronger prebuffering. Touch release must not restore
the previous accumulated delay.

## Design boundaries

Timing, throughput and resource bounds follow the requirements above. Codec and
queue decisions need actual input/capability evidence. Distinguish user requirements,
API guarantees, source tests, device observations and untested assumptions.

The implementation preserves existing codec/PCM audio records and browser decode
semantics. It pins the Android SDK, channel topology, bounds and touch policy below.
Trusted bootstrap identity and physical performance remain explicit unresolved
boundaries; no source-level choice establishes vehicle acceptance.

## Component boundaries

```text
iPhone CarPlay
  -> Android receive/decrypt/configuration and original timestamps
  -> reliable DataChannel, bounded application fragmentation and flow control
  -> webpage reassembly in encoded decode order
  -> WebCodecs actual hardware decoding
  -> short display queue / touch-only decoded-picture selection
  -> Canvas / browser compositor / car display

ordinary audio -> independent decode/transport/output timeline -> car browser
microphone demand -> Android <-> verified car HFP/SCO
touch and clock exchange -> small control messages, independent of media work
original stream capture -> one canonical payload journal with referenced events
```

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

WebCodecs VideoDecoder outputs pictures in presentation order. Do not add another
codec-reorder buffer after its output callback. The application may still have a
short display scheduler and skip decoded old pictures during touch catch-up.
`max_num_reorder_frames` is a bitstream restriction, not a millisecond latency
cap or an instruction to always accumulate that many frames. Do not lower a
parameter-set declaration below the real stream's requirements to disguise delay.

## DataChannel deployment and protocol work

### HTTPS, identity and direct connectivity

The webpage still needs a trustworthy secure context for WebCodecs/AudioWorklet;
ordinary HTTP at an Android LAN IP is not such a context. Existing HTTPS page
hosting and cached asset behavior must remain usable.

DataChannel uses DTLS with fingerprints exchanged through signaling. The Android
media endpoint does not need a browser-trusted public-CA WSS server certificate,
but authenticated pairing/signaling must bind the expected device, session and
DTLS fingerprint. Encryption alone is not proof of peer identity. Do not treat an
unauthenticated HTTP exchange as an authenticated fingerprint binding. Determine
how existing pairing, code invalidation, replacement and reconnect semantics
establish that binding without designing an ad hoc cryptographic protocol.

If signaling uses HTTPS/WSS, that signaling endpoint still needs a trusted TLS
certificate. These transport certificates are distinct from CarPlay accessory
identity material; this migration does not authorize changing that identity.

Same-LAN ICE can connect using host candidates without public STUN/TURN, but
actual browser candidate policy, mDNS resolution, Android interface selection,
hotspot/shared-Wi-Fi isolation, VPNs and local-network permission must be tested.
Do not silently introduce an Internet media relay. Any relay path needs an
explicit latency, availability and deployment assessment.

### Reliability, channel separation and bounded work

- Use ordered delivery with `maxRetransmits` and `maxPacketLifeTime` unset.
  Reliability lasts while the connection remains viable; it is not a guarantee
  against disconnects or unlimited network outages.
- Separate video, ordinary audio and control logically. Multiple DataChannels in
  one PeerConnection normally share an SCTP association, congestion control and
  resources; they do not provide the isolation of separate network paths.
- Reassemble complete video AUs. Bound application fragments by negotiated
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
- Select and pin the Android WebRTC dependency after checking supported ABIs,
  threading/lifecycle, DataChannel features, licenses, APK cost and reproducible
  builds. Do not assume existing Android media dependencies provide this API.

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

### Touch-only catch-up

Advance a video presentation cursor continuously; choose available decoded
pictures near it. Keep audio sample progress unchanged. At equal 60 fps source
and display, removing 300 ms of backlog requires skipping roughly 18 decoded
pictures. Spare display refresh capacity can reduce necessary skips.

The current policy uses quintic smoothstep with a maximum 1.25x source-cursor
speed and a 750 ms interaction hold. These are scheduling defaults, not verified
vehicle thresholds. Repeated touch preserves convergence; release does not refill
the previous backlog or change the audio plan.

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

The Android dependency is `io.github.webrtc-sdk:android:144.7559.12` (WebRTC M144),
pinned from Maven Central with four project ABIs and minSdk 21; TiPlay keeps 25.
See [licenses and artifact provenance](Third-party-notices.md#runtime-dependencies).
Native peer disposal runs outside WebRTC callbacks, control work is bounded and
media/credit stalls retire the session explicitly.

`POST /rtc` accepts `{c,s,offer}` through the existing pairing/ownership gate and
returns `{type,sdp,epoch,fragmentBytes,transport}`. Non-trickle local ICE carries
three reliable ordered channels: `control`, `video`, `audio`. No public STUN/TURN
is configured. The Android factory disables the Java network monitor so real
hotspot/Shizuku aliases can be enumerated by native interfaces without requiring
a ConnectivityManager network handle. It does not invent or rewrite candidates.
Actual UDP binding/reachability and hotspot restoration still require the vehicle.

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

Android fragments from canonical payload references instead of allocating another
complete outgoing AU. Reliable queue overload, credit expiry and decoder stagnation
are explicit recovery outcomes. The decoder uses bounded admission with enough
reference lookahead; it never discards compressed prediction frames to catch up.
Presentation may skip decoded pictures. Mirroring suspension marks input
`DECODE_ONLY`, preserving decoding while closing hidden output frames.

Run the required [source checks](Testing.md#automated-checks) and applicable
[browser harnesses](../tests/web-e2e/README.md). Source tests cover real desktop
DataChannel exchange, framing/credit/epoch rejection, lifecycle/ownership,
independent audio, decoded-frame bounds, touch convergence and AirPlay resource
cancellation. They do not establish Android JNI behavior on every device, actual
hardware use, acoustic/panel latency or sustainable thermal performance.

Physical acceptance must cover `169.254.111.111`, loss/retransmission, large AUs,
long thermal sessions, repeated touch, gear transitions, background/foreground,
VPNs, HFP route changes, hotspot restart, replacement owners and storage pressure.
Measure source-relative physical output with explicit clock uncertainty. The
short code over HTTP preserves the old trusted-LAN boundary; resistance to active
fingerprint substitution still requires trusted signaling/bootstrap.

Public references: [WebCodecs](https://www.w3.org/TR/webcodecs/),
[WebRTC](https://www.w3.org/TR/webrtc/),
[DataChannel / RFC 8831](https://www.rfc-editor.org/rfc/rfc8831),
[WebRTC security / RFC 8827](https://www.rfc-editor.org/rfc/rfc8827),
[ICE / RFC 8445](https://www.rfc-editor.org/rfc/rfc8445),
[secure contexts](https://www.w3.org/TR/secure-contexts/), and
[Web Audio](https://www.w3.org/TR/webaudio-1.1/).
