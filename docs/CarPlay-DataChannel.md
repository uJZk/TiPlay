# CarPlay reliable DataChannel

## Scope and status

The `feat/carplay-webrtc` branch implements the WebRTC beta, **0.2.21-beta.1**
(code 45). The Android phone relays source-compressed video into webpage-controlled
WebCodecs decoding; native WebRTC audio/video tracks are not used.
The supported product remains Android phone plus car browser.

The beta webpage lives at <https://ujzk.github.io/TiPlay/webrtc/>. Its deployment
assembles the existing root/download pages from the pre-migration baseline and
adds the beta under `webrtc/`; it does not replace the existing root client.
The beta APK selects that address, including migration of the old default saved
address. Custom HTTPS hosts remain configurable.

CarPlay is the primary migration. The existing shared video/audio hub also carries
AirPlay mirror records over the same channels to preserve display ownership and
stream continuity. AirPlay URL/photo resource fetching and its playback semantics
remain on the existing resource path. This is not an AirPlay codec redesign.

Subsequent vehicle feedback confirms that standalone test D (same-browser native
WebRTC receive track -> Processor -> Canvas) can play. This is local synthetic
playback evidence, not proof of Android-to-car direct ICE, actual hardware use or
P/non-P gear-transition continuity. It does not replace the selected DataChannel
transport. Current evidence and next gates are in the [WebRTC roadmap](WebRTC-roadmap.md).

Implementation and source tests do not establish physical vehicle compatibility,
actual webpage hardware decoder selection, acoustic latency or panel scanout.
See [Testing](Testing.md) and [Todo](Todo.md) for the acceptance boundary.

## Requirements and resource ledger

| Area | Contract |
| --- | --- |
| Video | Never reencode source video. Preserve source-compressed input and decode dependency order. Actual final decoding must be hardware decoding in the webpage; device verification remains outstanding. |
| Normal video | Signed output Delta relative to sender presentation; +300 ms ceiling, not a target buffer. |
| Touch | Forward at the next available scheduling opportunity; smoothly advance video only toward the newest feasible output. Skipping old decoded pictures is allowed. |
| Audio | Independent sender-relative +300 ms ceiling where a source presentation anchor exists. Touch never resets or accelerates audio. |
| Routing | Music/navigation in the browser; microphone/voice through Android verified car HFP/SCO, without handset fallback or browser microphone permission. |
| Delivery | Reliable, ordered channels, with neither maximum retransmits nor packet lifetime configured. Reliability ends if the connection fails. |
| Capture | One original input video journal; downstream references, not duplicate media payloads. No hidden sampling. |

Sustained transport/decode/storage service must exceed source demand. Finite queues
cannot preserve complete input and the timing ceiling during unlimited overload.
The beta ends the affected session explicitly and reconnects rather than hiding
compressed input loss or silently growing queues. A recovery is not a successful
within-ceiling presentation.

The [TCP receive-probe measurements](WebRTC-roadmap.md#tcp-背压实测) show that
reading at 70%/40% of baseline accumulated about 4.5/8.18 seconds of sender-relative
arrival delay, with a reported browser freeze; restoring unlimited reads briefly
drained at about 41.32 Mbps/107 fps. This is evidence of receive throttling and
backlog, not confirmed source-encoder bitrate adaptation. The probe remains an
explicit Debug experiment, not the beta's default congestion controller.

## Four-digit pairing and authenticated signaling

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
5. The established encrypted control channel admits the existing browser pairing
   gate and starts media. Pairing codes do not travel in HTTP requests on this path.

The shared online-guessing lockout applies to failed proofs and encrypted code
admission. Challenges are single-use, bounded and expire after 30 seconds. Native
peers are bounded to three, with 15-second unauthenticated and six-second inactive
session cleanup. Replacement, new code, disable, disconnect and stop retire the
old peer and its touches. A replacement browser cannot inherit stale media work.

The four-digit secret provides limited protection against online guesses; rate
limits remain necessary. HTTPS protects the page and its cryptographic code.
PAKE does not make denial of service impossible. Legacy HTTP endpoints are retained
for upstream compatibility; they keep their existing network protection limits.
AirPlay HTTP resources receive a random active-session bearer over the encrypted
channel, so resource URLs do not disclose the four-digit code.

## Native and browser transport

Android pins `io.github.webrtc-sdk:android:150.7871.01` (Chromium M150 fork), with
arm64-v8a, armeabi-v7a, x86 and x86_64 libraries. See [third-party notices](Third-party-notices.md)
and the packaged `licenses/webrtc/` provenance and complete binary notices.
`BrowserRtcRuntime` owns one factory and app-private persistent DTLS certificate;
`BrowserRtcPeer` owns one data-only peer and bounded native/control work.

Preserve source-compressed video without reencoding: the subsequent explicit
constraint is never to encode the video a second time. Decryption, configuration
parsing, AU assembly and transport packetization are allowed. Final decoding must
still use actual hardware in the webpage. Do not assume HEVC or AVC wins without
actual input and browser capability evidence; an unsupported source/decoder
combination requires an explicit compatibility/recovery decision, not transcoding.

The browser creates reliable ordered `video`, `audio` and `control` channels in one
PeerConnection. They share SCTP congestion and network resources; channel separation
is not physical network isolation. No public STUN/TURN or Internet media relay is
configured. Host ICE, interface selection, mDNS, hotspot isolation, VPN behavior
and local-network permissions still need validation on each supported vehicle.

Video/audio retain their existing record formats inside a 24-byte little-endian
fragment envelope: magic `TRC1`, application session, record sequence, total length,
fragment offset and fragment length. Complete messages are at most 16 KiB,
including this envelope, further bounded by negotiated SCTP message size. Each
ordered media channel has at most one incomplete record. Identity, lengths,
continuity and negotiated limits are checked before allocation/decoding.
Control messages have a separate 64 KiB ceiling, bounded by the negotiated limit.

Receiver credit and cumulative complete-record consumption acknowledgements bound
application in-flight work independently for video and audio. `bufferedAmount`
is only an additional native queue guard; it does not prove remote consumption.
The receiver acknowledges when a complete record is handed to the downstream
consumer; downstream decode backpressure prevents unlimited reads. Disabled audio
playback explicitly consumes/discards audio while preserving transport and latest
format metadata; its discarded bytes are counted.

| Boundary | Initial bound / failure behavior |
| --- | --- |
| Reliable Android video hub | 8 MiB, 120 frames, 200 ms oldest queued frame; explicit END on overload/expiry |
| Reliable Android audio hub | 1 MiB, 128 ordered records, 200 ms oldest queued media; explicit close |
| Native sender queues | 12 MiB video / 2 MiB audio; 200 ms queued or unacknowledged stall ends peer |
| Browser receiver credit | 10 MiB video / 1 MiB audio, including complete queued and incomplete records |
| Video decoder input | Bounded decode admission with dependency lookahead; prolonged stall ends stream, never skips predictive input |
| Decoded pictures | At most 20 retained pictures with prompt VideoFrame release |

These are initial finite-resource policies, not measured optimal settings.

Video source replacement or normal retirement renews the video subscription without
ending the authenticated peer or independent audio. Retiring one audio publication
appends its stream-end record in order; another active stream continues. Overload
and expired queues remain explicit failures.

## Time, reordering and touch

Touch edges are submitted immediately. Moves coalesce within one microtask, and
up/cancel/new-down invalidates a pending stale move. The RTC control outbox allows
eight bounded requests in flight, preserving ordered submission without waiting
one round trip per request; late older status responses cannot overwrite newer ones.

The three orders are separate: network fragments reconstruct original complete
access units; compressed input remains in decode order; WebCodecs outputs pictures
in presentation order. No second codec reorder buffer is inserted after its output.
For example, display `I0 B1 B2 P3` can require decode input `I0 P3 B1 B2`.
Waiting for an entire group is not required and would add avoidable delay.

Existing source-to-Android and Android-to-browser clock mappings supply sender
presentation references, with epochs and uncertainty. First arrival is not invented
as source presentation zero. Without a valid source anchor, diagnostics report
local/arrival timing and cannot claim sender-relative compliance.

CarPlay has independent video/audio policies with no old hard audio-versus-video
skew window. Normal playback adds no arbitrary target buffering. Audio device
output mapping and resampling retain their independent sample accounting and genuine
drift correction. Source-timed speech uses a one-time bounded startup reserve to
retain utterance start; a missing source anchor uses an explicitly unverified arrival
fallback. An infeasible source deadline is reported rather than hidden by clock reset.
AirPlay keeps its existing synchronization policy.

A touch advances a continuous video presentation cursor, initially using a 1.5x
maximum catch-up speed and 4/s speed slew. Repeated touch preserves cursor/speed
continuity; release does not restore prior accumulated delay. These constants are
initial test policies, not verified human smoothness thresholds. Audio progress is
independent. At equal 60 fps input/output, removing 300 ms of decoded backlog needs
roughly 18 old decoded pictures to be skipped.

This catch-up only removes backlog after decoding. It cannot remove retransmission,
missing reference input, decoder-internal DPB work, compositor or panel delay. If the
newest physically available picture is +40 ms old, skipping outputs cannot achieve
zero Delta. Per-stage evidence must establish the actual bottleneck; changing
transport alone does not prove the field reports are fixed.

WebCodecs is configured to prefer hardware, without a CarPlay software-fallback
configuration. The API cannot prove that a browser honors that preference.
`powerEfficient`, low CPU, successful configuration and an empty decodeQueue are
not hardware or physical latency proof. Supported vehicle/browser/codec combinations
need external hardware evidence and output measurements with explicit uncertainty.

## Complete original capture

`ScreenStream` retains the original encrypted input TCP headers and payloads once.
It brackets each access unit with capture-session/channel/sequence/byte-range
references, and records the decrypt/length-prefix-to-Annex-B transform.
`WebVideoRecord.sourceCapture` and RTC reference metadata associate downstream
epoch/sequence work with that canonical journal. Outgoing video is not saved again.

Capture writes synchronously with disk backpressure. File-append success is not
an fsync durability guarantee. Partial storage failure increments public integrity
counters and suppresses new exact-range references until a fresh capture session;
reports must not claim those unknown ranges are complete. Control/status reads do
not wait on the capture disk lock. See [Diagnostics](Diagnostics.md).

## Validation boundary

Source checks cover protocol bounds/credit, SRP cross-language vectors and tampering,
HTTP/session lifecycle, complete-input queue behavior, decoded-picture catch-up,
independent timing, verified-route code and capture integrity. The genuine Chromium
RTC harness exercises real ICE/DTLS/SCTP when its execution environment exposes
usable network interfaces. A host with no ICE candidates cannot establish connectivity
and must be reported as blocked, never replaced with a simulated success.

Before treating this beta as vehicle-validated, test actual iPhone/Android/car
combinations: host ICE on every intended network, codec/profile hardware selection,
large keyframes, retransmission and thermal runs, repeated touch, suspend/resume,
VPN/network transitions, HFP startup/loss/restoration and storage pressure. Measure
sender-relative acoustic/panel output separately from software submission events.
