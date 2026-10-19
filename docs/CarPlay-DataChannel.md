# CarPlay reliable DataChannel implementation handoff

## Current decision and status

The next conversation should implement **reliable, ordered WebRTC DataChannel
transport for CarPlay**, using first-principles reasoning. This conversation
completed written design and handoff only. No transport, decoder, timing or
runtime behavior has changed; the implementation baseline is
`6f1d9cea4875effb0a3b7877a9ec01551e2d274e` / `0.2.20-beta.5`.

The selected transport carries application media data into a webpage-controlled
decoder. It does not select WebRTC native audio/video tracks or their playback
pipeline. Earlier proposals that defaulted to WSS do not override this decision.
Existing behavior remains documented in [Browser](Browser.md); the requirements
below describe the intended change, not features already shipped.

Subsequent vehicle feedback confirms that standalone test D (same-browser native
WebRTC receive track -> Processor -> Canvas) can play. This is local synthetic
playback evidence, not proof of Android-to-car direct ICE, actual hardware use or
P/non-P gear-transition continuity. It does not replace the selected DataChannel
transport. Current evidence and next gates are in the [WebRTC roadmap](WebRTC-roadmap.md).

## Confirmed requirements

| Area | Requirement |
| --- | --- |
| Scope | CarPlay first: iPhone source, Android phone intermediary, existing car browser. AirPlay mirroring and URL casting are outside this migration's initial scope. |
| Platform | Android application and webpage may change. Do not require a native car application, modified browser or modified driver. |
| Video | Actual hardware decoding must occur in the car webpage. Android decoding followed by raw YUV delivery does not satisfy this requirement. Software video fallback does not satisfy it either. |
| Normal video delay | At most **+300 ms relative to sender presentation time**, with the lowest practical delay while preserving compressed input and normal pictures as far as possible. This is a ceiling, not a fixed buffer target. Preserve signed measurements; no new hard lower bound of zero was specified. |
| Touch | Forward immediately at the earliest available scheduling opportunity. Smoothly bring **video** Delta toward zero as quickly as smoothness permits. Complete compressed reception and dependency decoding continue; skipping old **decoded** pictures during catch-up is explicitly allowed. |
| Audio delay | Independently at most **+300 ms relative to its sender presentation time**, normally as low as practical. The former audio-versus-video windows, including -180/+500 ms, are superseded. No additional hard A/V skew window was specified. |
| Audio continuity | Touch must not reset, accelerate or change the audio timeline. Audio may use software decoding. |
| Audio routing | Preserve music/navigation through the car browser. Microphone demand uses Android with verified car HFP/SCO input and corresponding voice playback. Do not use handset microphone or loudspeaker fallback; the webpage must not request microphone access. |
| Transport | Use reliable, ordered DataChannel delivery. Do not configure partial reliability to discard compressed media after a timeout or retransmission count. |
| Debug capture | Keep complete application-visible original streams. Store the original video payload **once**, with downstream events referencing that copy. No silent sampling or capture loss. |

Natural latency variation is not an instruction to refill a 300 ms buffer. An
artificial controller that raises target latency is not required. Necessary
startup buffering, drift correction and any adaptive policy must be justified
separately against the minimum-delay objective. Touch release must not restore
the previous accumulated delay.

## Reason from requirements before choosing implementation details

Two independent written designs were completed without reading project code,
existing logs or each other's proposals. Both favored preserving compressed
video, webpage WebCodecs decoding and explicit display selection. This agreement
is a design result, not evidence of device performance or hardware use.

For the next implementation, first derive dependencies, timing, throughput and
resource bounds from the requirements above. Then inspect existing code for
integration and compatibility. Do not justify a codec or timing scheme solely
because the current implementation uses it or a previous trace looked good.
State whether each claim is a user requirement, API guarantee, observation or
untested assumption.

Choices still open include audio decode placement and wire format, Android's
WebRTC library/version, channel topology, signaling/identity bootstrap, exact
queue sizes and the touch convergence curve. The proposals' Android-to-browser
PCM path is a candidate, not a user-imposed constraint. Avoid fixing these
choices merely to reproduce a draft.

## Candidate component boundaries

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

One independent proposal used continuous-speed, piecewise acceleration; the
other used a quintic smoothstep with continuous acceleration at its endpoints.
Their illustrative 1.5x speed and 4/s speed-change limits were paper choices,
not verified user thresholds. Select the simplest curve that meets measured
smoothness and convergence requirements; preserve cursor/speed continuity across
repeated touch instead of restarting the catch-up on every move.

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

## Verification and next actions

Local handoff checks passed: `git diff --check`, local relative-link existence,
trailing-whitespace/final-newline and project word-limit checks on this document,
AGENTS and the updated index/Todo, plus `python3 scripts/check_public_tree.py`.
No Android build or browser runtime tests were run for these documentation-only
changes; no build, site or application inputs changed.

This handoff has documentation-only checks. It does not establish DataChannel
connectivity, real hardware decode, physical +300 ms compliance, touch smoothness
or acoustic quality. Existing physical issues in [Todo](Todo.md) remain open;
changing the transport alone does not prove the reported pops, mirror buffering
or unexplained handset navigation output are resolved.

Next conversation:

1. Read this contract and derive a concise capability/timing/resource ledger
   before selecting implementation details. Then inspect the current browser,
   Android server, pairing, media timelines and lifecycle for integration.
2. Define trusted signaling and authenticated peer binding; verify direct ICE
   connectivity on supported browser/network combinations. Preserve page HTTPS,
   pairing replacement, disable/disconnect and stale-session cleanup.
3. Implement reliable fragmentation, application flow control and stage metrics;
   wire WebCodecs and independent audio with the fewest justified buffers.
4. Implement touch-only decoded-output catch-up and preserve full one-copy raw
   capture. Keep normal playback and failure/recovery accounting distinct.
5. Run the applicable [source checks and browser harnesses](Testing.md), then test
   the actual iPhone/Android/car combination: large AUs, loss/retransmission,
   long thermal sessions, repeated touch, reconnect, VPNs, HFP route changes,
   browser suspension and storage pressure. Prove hardware use and measure
   source-relative physical output with explicit uncertainty.
6. Update implementation docs only as behavior lands. Rebuild generated site
   outputs and its service-worker manifest when browser inputs change. Use the
   existing release/deploy path when implementation and validation warrant it;
   this handoff does not publish a new beta or deploy new media behavior.

Public references: [WebCodecs](https://www.w3.org/TR/webcodecs/),
[WebRTC](https://www.w3.org/TR/webrtc/),
[DataChannel / RFC 8831](https://www.rfc-editor.org/rfc/rfc8831),
[WebRTC security / RFC 8827](https://www.rfc-editor.org/rfc/rfc8827),
[ICE / RFC 8445](https://www.rfc-editor.org/rfc/rfc8445),
[secure contexts](https://www.w3.org/TR/secure-contexts/), and
[Web Audio](https://www.w3.org/TR/webaudio-1.1/).
