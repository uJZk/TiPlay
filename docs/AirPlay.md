# AirPlay receiver

TiPlay's experimental receiver sends ordinary AirPlay mirroring, unprotected URL
video, photos and audio to the paired car browser. It starts when TiPlay opens,
subject to Android local-network permission. Its Bonjour name **TiPlay AirPlay**,
listener and pairing identity are separate from CarPlay's **TiPlay** entry.
The RAOP/AirPlay 2 audio, BLE hints, three-choice trust and pure-audio music controls
described here shipped in beta.23/v95 on the beta.22/code64 base;
current signed artifacts are recorded separately in [Build](Build.md#beta24-release).
Browser v96 corrects the main picture's H.264 receive-level SDP declaration after
a bounded WebRTC decoding-capability probe; it does not change the iPhone's
encoded stream or establish vehicle hardware decoding. See the
[live video transport contract](CarPlay-DataChannel.md#current-implementation-and-evidence).

## Use

1. Put the iPhone, Android phone and browser on a network that permits communication
   between devices, then open the paired [HTTPS browser page](Browser.md).
2. Select **TiPlay AirPlay** in Screen Mirroring or a compatible app's AirPlay menu.
3. Choose **Always allow**, **Allow once** or **Reject** in the browser's existing
   notification card within five seconds. It shows the sender name, requested casting
   type and its effect on the CarPlay picture. Unknown intent is labelled a connection
   request rather than guessed. Expiry or browser disconnection rejects the request.
4. End casting on the iPhone, or use browser Stop for URL video/photos. A still-valid
   CarPlay session returns after the iPhone confirms screen ownership.

Android Advanced settings can disable AirPlay immediately or **Reset AirPlay trusted
devices**. Disablement persists without reconnecting CarPlay. Reset removes stored
and connection-only grants, cancels pending prompts and leaves already-running media,
CarPlay pairing and browser pairing intact; later authorization requires a fresh choice.
Always allow uses a signature-verified pairing public key when available, otherwise a
normalized sender-reported `X-Apple-Client-ID` UUID. The header is an unauthenticated
claim, not proof of device ownership. When both appear on the same verified connection,
an existing remembered Client-ID grant is migrated to the verified key.
All senders see the same three choices without an
identity-verification warning or disabled button. A sender providing no valid client
UUID or verified key can receive connection permission but cannot be recognized on a later
connection. Allow once never persists trust; concurrent connections with the same
verified key and strong AirPlay session share it while any of them remains active.
IP/name is never trust, and approval
cannot displace another active sender. Ordinary AirPlay uses no PIN; browser pairing
retains its separate code.

A reverse event channel can be staged before media authorization. At most four
unattached channels remain staged, for at most 60 seconds; attaching approved
playback cancels that deadline. After playback ends, the channel enters a grace period
so the queued stopped event can be delivered. If staging is full, another staged
channel is closed to make room.

## Nearby Bluetooth discovery

When Android supports BLE advertising and the Nearby devices permission is granted,
the receiver advertises an Apple Continuity AirPlay-target hint (manufacturer `0x004C`,
message `0x09`) with its IPv4 address and configuration seed. The sender does not have
to join the receiver's network before receiving the BLE hint. Bluetooth discovery does
not carry media or configure Wi-Fi. Android's public API does not expose Apple's AWDL,
so cross-network appearance in the iOS AirPlay picker and peer-to-peer playback are
not guaranteed; Bonjour resolution and a reachable network path are still needed.

Advertising follows the receiver lifecycle, refreshes after permission/radio/address
changes and ignores retired callbacks. Unsupported BLE or denied permission leaves
LAN Bonjour and CarPlay running. No Bluetooth pairing, scan or device-name change
is performed. The observed packet reference is
[Continuity AirPlay target](https://github.com/furiousMAC/continuity/blob/d9fa98bddafbfa3baafc84e37a417d78a0598546/messages/airplay_target.md);
real iPhone picker behavior remains a device acceptance check.

## Playback and limitations

| Input | Android | Browser |
| --- | --- | --- |
| Mirror | Authenticate/decrypt and relay H.264 or enabled HEVC | Original-codec WebRTC RTP, MediaStreamTrackProcessor and Canvas |
| URL video | Protocol, authenticated resources and controls | libmedia AVPlayer Canvas playback; Video.js controls |
| JPEG/PNG | Bounded original-image cache/resource | Native decoding, EXIF orientation, contain fitting |
| Type-96 audio | RTP/decryption, packet order, RTP/NTP mapping | libav.js software decode/resample, NetEq and AudioWorklet output |

No Android URL-video/photo encoder or ordinary audio decoder fallback exists.
The audio transport implements PCM, ALAC, AAC-LC and AAC-ELD. Browser capabilities
are intrinsic software-decoder capabilities, not WebCodecs probes. Realtime AAC-LC,
AAC-ELD and ALAC use libav.js Workers, and raw PCM uses the WASM unpacker plus
continuous software resampling where needed. All enter NetEq as PCM16/48 kHz.
Negotiated source codecs can instead use standard WebRTC audio tracks; unsupported
formats retain the DataChannel PCM/libav.js-NetEq path. Opus requires native RTP
negotiation and fails explicitly without it.
No realtime WebCodecs audio path remains. Each source retains its clock, transport ID and epoch. Only reported
formats appear in receiver offers or pass SETUP; unknown capabilities offer no audio.
Reports belong to the current browser session and are never restored from a saved
viewport; changes constrain the next SETUP without interrupting current media.
Sender negotiation and actual sound still require iPhone validation.
Network PCM uses big endian; 24-bit input becomes PCM16 output.

Ordinary audio has three transport paths on the same receiver listener:

| Protocol | Implemented path | Explicit limits |
| --- | --- | --- |
| AirPlay 1 / classic RAOP | `_raop` discovery; SDP ANNOUNCE; UDP SETUP/RECORD, PCM/ALAC, NTP, retransmission and FLUSH; clear or FairPlay AES-CBC packets | AirTunes RSA `Apple-Challenge`/`rsaaeskey` is unsupported; no private AirTunes credential is imported |
| Legacy plist audio | FairPlay transport setup and type-96 UDP PCM/ALAC/AAC-LC/AAC-ELD | Existing legacy pair-verify path; no microphone |
| AirPlay 2 realtime | Transient HAP/SRP pairing, authenticated control/event channels, NTP and type-96 ChaCha20-Poly1305 audio | Persistent HomeKit pairing, PTP/multiroom and type-103 buffered audio are unsupported and not advertised |

The protocol comparison uses
[Shairport Sync RTSP handling](https://github.com/mikebrady/shairport-sync/blob/b991d91350e537c1f50dac98d9a3c836eceddcfc/rtsp.c)
and its [transient HAP pairing](https://github.com/mikebrady/shairport-sync/blob/b991d91350e537c1f50dac98d9a3c836eceddcfc/pair_ap/pair_homekit.c).
TiPlay reuses its existing SRP/cryptography primitives and browser decoders rather
than embedding Shairport's Linux audio backend. Authenticated HAP frames are bounded
to 1,024 bytes with independent channel counters; pairing failure retires that epoch.
Transient pairing provides no persistent verified sender identity. The browser still
authorizes the actual audio stream, and any separately presented sender identifier
remains a claim. Capability flags offer transient/CoreUtils pairing only while a
browser audio decoder is available; they do not offer buffered audio or PTP.
Independent SRP-client and loopback socket tests cover encrypted control, events,
audio delivery and unsupported transport rejection. These checks do not establish
iOS picker selection, interoperability with every sender or physical output timing.
CarPlay buffering is [a separate protocol](Browser.md#audio-and-microphone).

Unprotected MP4, HLS-TS and CMAF/fMP4 HLS require decodable, accessible resources.
Recognized HDR is rejected; there is no tone mapping or confirmed sender SDR-request
mechanism. Legacy FairPlay transport-key negotiation enables mirroring, not FairPlay
Streaming licenses, SAMPLE-AES or DRM playback. Photo display has Stop, not a timeline
or slideshow scheduler. iOS may send photos through mirroring instead of `PUT /photo`.
Sender DMAP title/artist/album/duration, JPEG/PNG artwork and RTP progress updates
populate the audio player's real state. Artwork stays bounded in memory and uses
the paired browser's authenticated resource route; new artwork revisions retire
old resource keys, and stopping playback retires the cover. Metadata from another
control connection cannot overwrite the current sender. Progress uses the negotiated
sample rate and delivered RTP coordinates, including wraparound, rather than browser
`currentTime` or an assumed audible position.

The audio player's play/pause controls act locally on TiPlay's AirPlay soundtrack:
pause clears its output queue while retaining the sender connection, packet ordering
and clock; resume returns to the live sender position. They do not pause the iPhone's
music app. Previous/next and ±10-second controls are enabled only when the current
sender supplies a valid DACP-ID and Active-Remote token and its matching `_dacp._tcp`
advertisement resolves to that same RTSP peer. The discovery listener shares TiPlay's
existing Bonjour instances. A service name, arbitrary TXT address or browser input
cannot select another host. Skip also requires valid, nonzero sender progress and
the negotiated sample rate; the server computes and clamps the millisecond target.

DACP uses fixed `previtem`/`nextitem` and `setproperty?dacp.playingtime=` commands,
following [Shairport's DACP request format](https://github.com/mikebrady/shairport-sync/blob/b991d91350e537c1f50dac98d9a3c836eceddcfc/dacp.c#L251)
and [DMAP playing-time control](https://github.com/postlund/pyatv/blob/v0.16.1/pyatv/protocols/dmap/__init__.py#L380).
No remote playback-rate capability or draggable live-audio timeline is advertised.
Commands run on a bounded daemon queue outside session locks, with a one-second HTTP
deadline and bounded response headers. A successful HTTP response acknowledges the
command, not a new playback position. Sender progress/title updates remain authoritative.
One command is pending at a time; controls wait for a subsequent sender update after
acknowledgement, failure or a two-second retry limit. RTP-derived progress is held
across remote commands until a sender FLUSH or that bounded recovery, so stale packets
cannot manufacture a seek result. Peer/port/token changes and session retirement cancel
obsolete work; new sessions cannot inherit queued commands. Sender apps may omit DACP
or reject individual commands; actual iPhone response still requires device acceptance.
CarPlay's audio remains independent. Compatibility volume replies do not change gain.
Content already drawn into video remains visible.
When CarPlay is running, its picture keeps priority while AirPlay audio and metadata
continue independently. The music view appears when CarPlay is absent and uses the
same Video.js control style as URL media; it shows sender metadata rather than
inventing a track title or artwork.

## CarPlay coexistence

AirPlay borrows only `mainScreen`, preserving CarPlay audio for mixed output.
`changeModes` transfer 3 requests the loan; only a new `modesChanged` resource 1
`entity` confirms it. A successful write/RTSP reply or `permanentEntity` is insufficient.
Transfer 4 returns it; CarPlay display/input resumes only after controller ownership
is confirmed, then requests a keyframe. Screen data EOF during a requested/granted loan
and auxiliary-screen EOF do not close the main control/audio session. Retired streams
cannot deliver into or tear down a successor, including across control sessions. See [Apple's resource-management explanation](https://developer.apple.com/videos/play/wwdc2016/723/).
Command delivery reconciles a synchronous stop or replacement request after the
current write completes; a reentrant callback cannot strand the required return or
new borrow. A fresh ownership notification remains necessary for output authority.
Low-frequency screen commands register their CSeq before writing and correlate
responses within the current event-channel generation. At most 16 requests are
retained; a five-second monotonic deadline retires diagnostic records, not the
control connection or resource owner. RTSP status and the response plist's
`status` remain distinct. Missing/malformed command status stays unknown; no
reply or timeout grants ownership or triggers automatic retransmission. Retiring
an event channel cancels its pending records. Old readers cannot apply ownership
notifications, clear the new cipher or close a successor connection; command
dispatch and replacement share an ordering boundary without holding the write
lock across application callbacks.

Session-level SETUP initializes one verified control session only once. An exact
retry with the same CSeq, path/protocol and body digest reuses the cached plaintext
response, encrypted with the control channel's next counter. Other repeated initial
SETUP requests return RTSP 455 without changing valid control/audio resources.
Stream-level SETUP remains independent. One verification epoch installs at most
one event cipher: counters must not restart under the same derived key. Event
recovery requires a new control session and fresh PairVerify, rather than guessing
cross-connection counters or changing the key derivation.
The single-initialization boundary matches
[WirelessCarPlay's existing-control-setup guard](https://github.com/45clouds/WirelessCarPlay/blob/51145ef55f8dd9f1cbadd58353cacb5e0ca215e9/source/Sources/AirPlayReceiverSession.c#L1761).

Unused event listeners retire if superseded before establishment. Accepted sockets,
UDP keepalive sockets and worker registrations have explicit retirement, including
close-during-accept and blocked writes. The timing port and sender are reused by
their clock owner; the clock cannot restart after session close.
Borrow/return delivery coalesces reentrant changes without holding state locks
across transport writes. A successful borrow still owes its return if readiness
changes during the write; a new readiness generation needs fresh ownership proof.

Browser output uses a controller/session/state ownership snapshot and rechecks it
after external callbacks. Retired grants cannot authorize a successor. Late
Active/Frame and casting Start/End notifications are rejected by identity or
generation; a missing primary stream remains recovery, even with retained control.

Sparse Debug semantic loan/close events are described in [Diagnostics](Diagnostics.md);
encrypted control bytes and a rolling TXT window cannot always reconstruct ownership.
Controller ownership without a usable main-screen stream does not complete display
recovery. After return, the host reuses its two-second reconnect interval before
recovering the missing stream with the retained wireless transport. A timely or
in-flight SETUP wins; a new loan cancels the old wait. Settings and browser absence
defer recovery until menu close or a fresh authenticated viewport. The conditional retirement
claim checks stream and ownership together, and cleanup runs outside ownership locks.
This interval is bounded software recovery, not an iPhone or vehicle timing guarantee.
The beta.12 capture confirms a mirror loan with the original control connection
preserved. Ownership returns, but that session receives no new main-screen SETUP;
the fallback starts after 2.007 seconds and actual browser drawing resumes after
5.119 seconds using a replacement projection/control session and retained wireless
transport. This validates recovery in one observed case, not seamless old-stream
return or optimal timing. Both URL takeovers also receive a confirmed loan, followed
by peer TEARDOWN/control EOF after 322/131 ms; stopping playback recovers CarPlay
through new sessions. Mirror, URL and photos share the same screen-loan request path;
no URL-specific local full-CarPlay-close branch was found. The iPhone icon is an
auxiliary user observation, not ownership/data proof or an explanation of iOS intent.

Pending loans retain CarPlay picture/input and release existing touches. Mirror SETUP
waits boundedly before supplying data ports so the initial keyframe is not lost.
URL video prepares but pauses/hides output; photos retain their resource while hidden.
Key/timing-only SETUP does not borrow the screen or prompt for an unknown media type.
Pure audio never requests a visual loan, keeps CarPlay picture/input/audio active and
survives display frame-rate/codec edits. Switching from existing visual media to
audio releases the earlier visual producer and returns its screen loan. Without valid
CarPlay, visual AirPlay can use the canvas directly. Takeover blocks background
CarPlay input/fit requests.

Keep valid CarPlay control, wireless resources, clocks and configuration. Block
restarts/resize renegotiation during casting; retries recheck ownership and resume
without an additional backoff after release. Stop, teardown or preemption releases
AirPlay output before returning the screen. Generations reject old callbacks and
preserve URL playback intent. Audio producers/epochs are independent; disabling
CarPlay audio leaves AirPlay sound enabled. Music can overlap; Bluetooth voice-route
muting has priority. iOS may actively end CarPlay or never start mirror media;
heartbeats and selected menu entries do not prove a usable picture.

A wireless bootstrap already in progress must recheck the ordinary-AirPlay lease
immediately before sending CarPlay StartSession. During the loan it keeps processing
authenticated control traffic and retains one pending availability response; release
resumes that response without another iPhone notification. The post-authentication
startup deadline excludes this wait. Authentication remains bounded, and ownership
changes reported by an already established CarPlay session remain authoritative.

For implementation comparison, GPL-3.0
[LIVI e0e07e89](https://github.com/f-io/LIVI/blob/e0e07e89d1deba369f2bc0d10f1e65c546a45a38/native/livi-helperd/crates/livi-cp/src/video_playback.rs#L55-L87)
builds borrow/return for integrated CarPlay `videoPlayback`. Its command parameters
also match the previously checked `f999f557` revision:

| Field | LIVI | TiPlay ordinary-AirPlay screen loan |
| --- | --- | --- |
| `resourceID` | 1 | 1 |
| `transferType` | 3 borrow / 4 unborrow | 3 borrow / 4 unborrow |
| `borrowID` | `VideoPlayback`, on both commands | `VideoPlayback`, on both commands |
| `transferPriority` | 500 on borrow | 500 on borrow |
| `unborrowConstraint` | 500 on borrow | 500 on borrow |

LIVI's [call path](https://github.com/f-io/LIVI/blob/e0e07e89d1deba369f2bc0d10f1e65c546a45a38/native/livi-helperd/crates/livi-cp/src/stack.rs#L1537-L1669)
borrows on `requestUI videoplayback:`, initial playback or enabling video; a video
`stop` attempts unborrow through the current event connection. It marks its local boolean
before writing, ignores the transport write result, and its `modesChanged` handler
processes app states rather than screen resource ownership. TiPlay's pending/
confirmed state therefore must not be replaced by that boolean. Screen-only
TEARDOWN preserves other resources in both implementations; control EOF ends
LIVI's session loop too. TiPlay aligns these command fields with LIVI while retaining
its fresh ownership confirmation and reentrant delivery guards. Parameter alignment
does not establish the cause of the capture's peer EOF or prove ordinary AirPlay URL
coexistence; actual borrowing, return and retained-control behavior still need device validation.

[Catplay](https://github.com/catplay-labs/catplay/blob/bc6edae49554f2d0160b18ed18fc7b7376353115/carplay/catplay_carplay/src/carplay_rx/sink/session_handle.rs#L146-L180)
separates borrow/unborrow, command results and ModesChanged; no license was found at
that revision, so no code is copied. The separately reviewed
[WirelessCarPlay command completion](https://github.com/45clouds/WirelessCarPlay/blob/51145ef55f8dd9f1cbadd58353cacb5e0ca215e9/source/Sources/AirPlayReceiverSession.h#L330-L342)
and [response status handling](https://github.com/45clouds/WirelessCarPlay/blob/51145ef55f8dd9f1cbadd58353cacb5e0ca215e9/source/Sources/AirPlayReceiverSession.c#L840-L870)
also distinguish command results from its
[ModesChanged callback](https://github.com/45clouds/WirelessCarPlay/blob/51145ef55f8dd9f1cbadd58353cacb5e0ca215e9/source/Sources/AirPlayReceiverSession.h#L155-L159).
That pinned revision is this review's reference: the earlier review did not retain
a WirelessCarPlay commit. Its root MIT license does not remove the SDK files'
MFi restrictions; no SDK implementation is copied. These comparisons do not
explain this iPhone's peer EOF or replace fresh ownership and actual-picture evidence.

HEVC sample-entry parsing accepts the sender's bounded terminal zero padding after complete
validated boxes. Truncated boxes and HDR/Dolby metadata remain rejected; padding cannot
hide an additional extension. Repeated mirror configurations/pause retain the decoder epoch and AES-CTR position;
paused transport still consumes ciphertext. Clean packet-boundary EOF permits same-peer
reconnect for five seconds; partial packets or expiry end the mirror. RTP/NTP anchors
map audio/video to one monotonic clock; bounded reordering/retransmission and FLUSH
preserve stream epochs. Missing synchronization is explicit arrival-playback fallback,
not source synchronization. Resize scales the current mirror; new dimensions apply
at the next SETUP. Keepalive tuning is not a recovery-time guarantee.

CarPlay buffered audio orders immediate `FLUSHBUFFERED` prefixes by its 23-bit
packet sequence, excluding the header marker; `until` is the first retained
packet. The same fence covers queued, forwarded and in-flight intake frames,
independently of unrelated track RTP origins. Immediate flush stops output,
clears the old anchor and waits for SETRATE. See the independently reviewed
[Shairport buffered reader](https://github.com/mikebrady/shairport-sync/blob/b991d91350e537c1f50dac98d9a3c836eceddcfc/ap2_buffered_audio_processor.c#L283)
and [immediate/deferred handling](https://github.com/mikebrady/shairport-sync/blob/b991d91350e537c1f50dac98d9a3c836eceddcfc/rtsp.c#L1430).
These are implementation references, not an Apple specification. Deferred
`[from, until)` range cancellation is explicitly unsupported: RTSP 501 leaves
current playback unchanged. Sender fallback and timestamp-only flushes across
unrelated origins remain [acceptance limits](Todo.md#browser-and-carplay-audio).

AAC mirror NoData access units occupy the negotiated number of source samples.
They pass through the same RTP ordering, duplicate rejection, retransmission and
FLUSH boundaries as other audio; dropping them before ordering creates false gaps.
The browser recognizes the exact marker only for mirrored AAC-LC/ELD and emits
the negotiated frame length as zero PCM in source order. These are explicit silence
samples, not evidence of network loss or a measurement of physical output.
Software AAC output consumes a bounded queue of submitted source-sample spans;
callbacks may split/merge samples or compact timestamps across silence. Source
coordinates come from those spans. NoData submission does not block later encoded
input and does not flush/reset codec overlap state. Only silence blocked by missing
earlier output starts the 2-second failure timer; new silence does not extend it.

An externally revoked display can still replace the browser decoder epoch. Ordinary
mirroring has no confirmed sender keyframe-request implementation, so the local
recovery callback cannot guarantee a new independently decodable frame. Continuing
prediction frames alone cannot restore a decoder whose initial keyframe was lost.
Read native RTP/Canvas evidence separately from URL buffering. The
[live diagnostics](Diagnostics.md#live-video-policy-evidence) distinguish current
receiver behavior from the retired application video policy.

## URL engine and captions

An accepted `/play` command is acknowledged before browser media readiness.
Senders may wait for this reply before completing FCUP resources through `/action`
on the same control connection; waiting for browser readiness there can block the
resource needed to become ready. Loading, readiness and failure remain asynchronous
through playback information and events.
The browser shows an accessible preparation indicator immediately, before its
resource probe, player import or source decoding. It hands off on actual playback,
ready paused controls or an autoplay gesture prompt. Errors, stop and replacement
retire the previous indicator; a pending CarPlay loan still hides AirPlay output.

URL video uses libmedia AVPlayer for HTTP reading, demuxing, decoding, compressed
and decoded queues, preloading, buffering, playback clocks and audio/video
synchronization. TiPlay keeps a thin media facade for the existing AirPlay and
Video.js controls. Its video output is Canvas; MSE and hidden video-element
playback are disabled. WebCodecs hardware decoding is preferred where the browser
supports it. Actual decoder selection and vehicle performance require runtime
evidence; requesting hardware acceleration does not prove hardware use.

AVPlayer owns VOD pause/resume, seeking, rate changes, stream selection and completion.
The facade maps those operations and events to the existing playback identity,
seek revisions, loading state and phone reports. A source replacement or stop
retires the old player and its IO/output resources; stale callbacks cannot update
the replacement. The resource proxy, authenticated session and CarPlay screen loan
remain separate owners. A prepared or paused player is not evidence of advancing
playback, and browser audio activation can still require a user gesture.

Upstream live playback has no ordinary pause operation. For a live URL, TiPlay
mutes and destroys the current player on pause, retaining only the source/control
identity. Resume reloads at the live edge; it does not preserve a time-shift buffer
or resume the old buffered position. A recreated AudioContext can require another
trusted gesture. VOD pause/resume retains the existing player. A 15-second
first-render deadline reports a startup timeout if output never begins; timeout
alone does not establish an unsupported codec.

The former Mediabunny-based engine, TiPlay decoded-video/PCM queues, serialized
256 KiB browser reader pool and custom URL PD/SoundTouch scheduling are retired.
Their 750/1500 ms startup/recovery watermarks, 32-frame/256 MiB video estimate,
2/3-second video/audio lookahead and 500 ms audio submission horizon are not
AVPlayer settings. Historical tests and beta.12 field observations of those limits
do not establish acceptance of the replacement.

The adapter configures `preLoadTime: 4`, `enableJitterBuffer: true`,
`lowLatency: false`, `jitterBufferMin: 1` and `jitterBufferMax: 4` (seconds where
applicable). Four-second VOD preloading and the live jitter watermarks are upstream
controls, not guaranteed decoded coverage, end-to-end delay or total memory caps.
AVPlayer has its own preloading and queue backpressure. Its live jitter controller
can adjust buffer watermarks and playback speed from queue/input statistics;
that policy is not WebRTC NetEq. Queue length or buffered duration is not a hard
total-memory bound. Browser network buffers, WASM memories, decoded pictures,
GPU textures and private hardware-decoder surfaces remain separate allocations.
Measure long playback, high-bitrate/4K material, repeated seeks, source replacement
and teardown on the intended vehicle before claiming a safe peak or lower CPU.

Video.js retains the default controls and Canvas media adapter, including
±10-second seek, rate, available tracks, preparation/buffering and Stop. The current upstream VOD rate
range exposed by this adapter is 0.5–2×. Live playback stays at manual 1×
and hides the rate button; unsupported sender rates cannot abort playback. Exact buffered TimeRanges are unavailable
from the upstream public queue statistics, so the facade leaves them empty rather
than converting packet counts into invented coverage. There is
no second HTML video clock. Pause retains the requested rate, including older APK
commands that omit it. Playback IDs and independent seek revisions reject stale
reports; iPhone queries may acknowledge a new seek target before actual playback
reaches it. Direct-to-proxy recovery preserves position/rate when no newer
directive supersedes it. Resource errors remain errors rather than a reason to
silently restore the old playback engine.

HLS metadata-open failures retain a fixed manifest phase, HTTP status and
allowlisted exception name through the IO worker. A request failure with status
zero is distinct from parsing a received HTTP 200 or 502 response. These fields
identify the failure boundary without exposing a URL or manifest; they do not
distinguish DNS, CORS, local-network permission and other browser fetch failures.
The upstream retries and preparation deadlines are unchanged.

Authenticated resources validate browser/playback/resource identity, preserve Range,
stream media and rewrite bounded HLS manifests/children/keys. Current-iPhone resources
may redirect directly, with authorized proxy fallback for failed CORS/reachability. Debug mode forces all media through Android, including nested playlists and redirects, and updates the browser directive so active playback reopens on the new route.
Inline `data:` resources are decoded locally after playback/resource validation;
they never enter the serialized iPhone loader. Percent escapes preserve literal `+`,
Base64 and MIME/charset metadata are validated, and decoded content is limited to
the existing 2 MiB playlist/metadata budget. Ordinary byte resources retain Range/416
semantics. Malformed or oversized inline resources fail explicitly without FCUP fallback.
This prevents embedded subtitle URLs from delaying unrelated media requests; it
does not change HTTP/FCUP deadlines or establish that a sender/CDN is reachable.

Neither makes an unreachable sender reachable. FCUP serializes exchanges with
session/peer/URL/request-ID checks; acknowledgement is not resource completion.
When Android HTTP fails and FCUP successfully serves the same resource, the current
playback item remembers that exact resource's fallback route across subsequent
byte ranges. This avoids paying the same failed HTTP attempt for every read unit.
It stores a route preference, not media bytes, and does not disable an entire origin.
Changed resource URLs and replacement playback items probe their own routes; the
first failing route can still add its connection/error wait before fallback succeeds.
Debug's forced proxy path and synchronous raw-capture writes can also change loading
costs, so captured admission times do not establish ordinary direct-path startup time.
Browser resource reads follow the player loader's prefetch, concurrency, retry
and cancellation policy. TiPlay does not add a second browser network queue or
media-byte cache. Android FCUP exchanges remain serialized and resource-specific
route preferences remain distinct from cached response bodies. Startup probes
request at most 64 KiB, including through FCUP, so a large video need not fit
inside the broker's whole-response limit merely to discover its type. Local
files and `skd` keys are excluded from the authenticated resource route.

FCUP sharing keys include the requested byte range. Range reaches both Android HTTP and
the iPhone loader; a validated partial response is passed through once. An FCUP sender that
returns a full body is sliced locally once; Android HTTP may legally return a full-body 200.
Complete HLS playlists are an exception: even when requested with Range, they are rewritten
and returned whole as 200 with an HLS content type. A partial playlist prefix is fetched
whole before rewriting. Applying byte offsets from the original
playlist after rewriting would corrupt it, and extensionless app URLs still require nested
resources to use the authenticated proxy.
Upstream denial is retained as a distinct
resource failure, including its route and status. Signed CDN query parameters are preserved:
the receiver cannot repair an unavailable or rejected signed source by deleting parameters.

Bilibili CDN media can require both the Bilibili site Referer and a browser User-Agent;
either header alone can still receive 403. Android HTTP and iPhone FCUP apply the same
host-scoped compatibility headers, reevaluating the destination after HTTP redirects
while preserving signed URLs and byte ranges.

AVPlayer owns subtitle loading, timing and rendering. TiPlay exposes available
subtitle descriptors through the existing menu. Registered AVC/HEVC SEI caption
data is copied at demux, decoded into changed display states, and scheduled by
AVPlayer's own SubtitleRender clock and ASS renderer. Embedded service IDs are
separate from HLS playlist indexes; selecting either route disables the other.
Seek clears decoder/display state while retaining discovered services; source or
video-stream replacement retires their metadata and callbacks. The caption bridge
has bounded event/text retention and acknowledged worker credits. Overload drops
caption observation and resets its epoch without blocking video or audio.

CEA-608 uses the pinned hls.js decoder. CEA-708 restores plain-text service/window
display changes; styles, positioning and complete command parity are outside that
decoder's contract. Caption support does not establish that a sender supplies
caption data. [Apple's AirPlay 2 TV guidance](https://developer.apple.com/streaming/hls-authoring-specification-for-apple-devices.html#amended-requirements-for-airplay-2-enabled-tvs)
specifies WebVTT. Desktop AVC fixtures verify this adapter's caption path; HEVC
extraction tests do not establish browser HEVC rendering or physical iPhone/Tesla
subtitle delivery.

The local AVPlayer 1.3.1 bundle includes the selected baseline audio decoder,
resampling and stretch resources. Video requires browser WebCodecs support; no
WASM video decoder restores an unsupported codec. Upstream 1.3.1 does not provide
the former URL ALAC software fallback, and its supported-codec set excludes ALAC.
This adapter rejects ALAC-only URL audio explicitly instead of silently playing
video without sound; an available supported alternate audio track is selected.
Live ALAC still uses its separate libav.js path. Runtime files are hosted with TiPlay rather than
loaded from an upstream CDN.

## Maintenance

| Contract | Source |
| --- | --- |
| Capability/format truth | [ReceiverCapabilities](../shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverCapabilities.kt), [audio formats](../shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverMirrorAudioFormat.kt) |
| Resource bounds/deadlines | [ReceiverResourceRequests](../shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverResourceRequests.kt), [proxy](../shared/src/main/java/com/shilapi/xcertplay/web/AirPlayVideoProxy.kt) |
| Engine/control ownership | [airplay-media.js](../site/play/airplay-media.js), [videojs-player.js](../site/play/videojs-player.js) |
| Dependencies/licenses/rebuild | [AVPlayer lockfile](../scripts/avplayer/package-lock.json), [player provenance](../site/play/vendor/libmedia/README.md), [controls bundle](../site/play/vendor/videojs/README.md) |
| UxPlay/playfair provenance | [notices](Third-party-notices.md), [native record](../shared/src/main/jni/airplay/README.md) |

Runtime dependencies are self-hosted. Asset changes update the complete Service Worker
manifest/cache identity. Diagnostics record redacted protocol/buffer/version metadata,
excluding media, keys and authentication payloads in Standard. Debug mode separately captures unredacted application traffic and media; see [Diagnostics](Diagnostics.md). Relevant checks include browser unit/E2E
playback and `python3 scripts/test_airplay_native.py`, alongside repository requirements.
Desktop fixtures do not establish iPhone compatibility, vehicle performance, acoustic
synchronization, long playback, subtitle alignment or expired-live recovery. Physical
acceptance remains in [Todo.md](Todo.md).

## CarPlay Video in Car in the browser

Phone + browser mode offers `videoPlayback` only when the iPhone proposes it in
initial SETUP. The same per-session negotiated state controls `/info`: its
`videoPlaybackInfo` and `playbackCapabilities` are top-level sibling dictionaries.
The former contains permission and the little-endian Base64 bitmap of actual
legacy capabilities; no unimplemented high feature bits are added. This restores
the capability declaration removed when browser VideoInCar was previously retired.
The reported permission is kept with the session and updated through the event
channel, together with playback status.

`BrowserVideoInCar` handles queue insertion, rate, seek, playback-info, properties
and `videoplayback:` UI requests through the existing AVPlayer URL pipeline and
iPhone `unhandledURL` resources. Unknown/retired remote stream IDs cannot control
a newer item. Settings, overlay, playback and iAP type-130 IDs retire independently;
a settings or overlay teardown must not end CarPlay or its iAP tunnel. Full
teardown releases listeners and workers even if the control socket remains open.

Video in Car and ordinary AirPlay each own their display token. A retired player
cannot return another producer's screen. The previous picture is revoked before
CarPlay resumes, and replacement/stop/failure callbacks are generation-checked.
URL audio-only playback returns the picture while retaining allowed audio; waiting
for a confirmed screen loan separately gates output. Returning to video obtains
a new confirmed loan. Raw AirPlay audio needs no display loan and cannot replace
a live URL/photo entry in the browser registry.

The protocol reference is [LIVI 187730f9](https://github.com/f-io/LIVI/blob/187730f99c14bbf75cf6cdf8dae53076a7d52cb7/native/crates/livi-cp/src/video_playback.rs),
reviewed alongside the earlier pinned e0e07e89 implementation. TiPlay retains
CMTime replies and measured browser playback state rather than LIVI's assumed
four-hour duration or seekable-as-buffered fallback. Unsupported assets report
an error; FairPlay video remains unsupported. No Android re-encoding is added.

Parking-state integration remains deferred by user instruction: the browser
listener permits playback without a gear signal. This is not evidence of P gear.
Current software and release verification is recorded in [Testing](Testing.md#current-release-source)
and [Build](Build.md#beta24-release); iPhone/vehicle playback remains a physical
acceptance check.
