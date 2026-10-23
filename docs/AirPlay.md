# AirPlay receiver

TiPlay's experimental receiver sends ordinary AirPlay mirroring, unprotected URL
video, photos and audio to the paired car browser. It starts when TiPlay opens,
subject to Android local-network permission. Its Bonjour name **TiPlay AirPlay**,
listener and pairing identity are separate from CarPlay's **TiPlay** entry.

## Use

1. Put the iPhone, Android phone and browser on a network that permits communication
   between devices, then open the paired [HTTPS browser page](Browser.md).
2. Select **TiPlay AirPlay** in Screen Mirroring or a compatible app's AirPlay menu.
3. Allow a new sender in the browser's upper-right notification within five seconds.
   Expiry or browser disconnection rejects the request.
4. End casting on the iPhone, or use browser Stop for URL video/photos. A still-valid
   CarPlay session returns after the iPhone confirms screen ownership.

Android Advanced settings can disable AirPlay immediately or forget trusted devices.
Disablement persists without reconnecting CarPlay. Forgetting trust affects future
connections and leaves the current cast running. Persistent trust requires a verified
pairing public-key fingerprint; legacy HTTP senders get connection-only approval.
IP/name is never trust, and approval cannot displace another active sender. Ordinary
AirPlay uses no PIN; browser pairing retains its separate code.

## Playback and limitations

| Input | Android | Browser |
| --- | --- | --- |
| Mirror | Authenticate/decrypt and relay H.264 or enabled HEVC | WebCodecs and Canvas |
| URL video | Protocol, authenticated resources and controls | Mediabunny/WebCodecs; TiPlay Canvas/Web Audio engine; Video.js controls |
| JPEG/PNG | Bounded original-image cache/resource | Native decoding, EXIF orientation, contain fitting |
| Type-96 audio | RTP/decryption, packet order, RTP/NTP mapping | PCM conversion, WebCodecs or software AAC-ELD decoding; AudioWorklet output |

No Android URL-video/photo encoder or ordinary audio decoder fallback exists.
The audio transport implements PCM, ALAC, AAC-LC and AAC-ELD. The current paired
browser reports a per-format capability mask: PCM uses JavaScript conversion;
AAC-ELD is always offered through the bundled software decoder, with WebCodecs
preferred when the actual configuration is supported. Software decoding runs in an
independent Worker and retains the stream's clock and epoch. ALAC and AAC-LC require
bounded WebCodecs probes using the actual configuration, sample rate, bit depth and
supported frame lengths. Only reported formats appear in the receiver's offers or
pass SETUP, including codec-only requests. Unknown browser capabilities offer no audio.
Reports belong to the current browser session and are never restored from a saved
viewport; changes constrain the next SETUP without interrupting current media.
Sender negotiation and actual sound still require iPhone validation.
Network PCM defaults to big endian, pending real-sender confirmation;
24-bit input becomes PCM16 output. Standalone type-96 audio is supported, without
`_raop`, AirPlay 2 buffered audio or microphone transmission. CarPlay buffering is
[a separate protocol](Browser.md#audio-and-microphone).

Unprotected MP4, HLS-TS and CMAF/fMP4 HLS require decodable, accessible resources.
Recognized HDR is rejected; there is no tone mapping or confirmed sender SDR-request
mechanism. Legacy FairPlay transport-key negotiation enables mirroring, not FairPlay
Streaming licenses, SAMPLE-AES or DRM playback. Photo display has Stop, not a timeline
or slideshow scheduler. iOS may send photos through mirroring instead of `PUT /photo`.
Remote volume/artwork/song-text capabilities are disabled; compatibility volume
replies do not change gain. Content already drawn into video remains visible.

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
Standalone audio returns a provisional visual loan. Without valid CarPlay, AirPlay
can use the canvas directly. Takeover blocks background CarPlay input/fit requests.

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

For implementation comparison, GPL-3.0 [LIVI](https://github.com/f-io/LIVI/blob/f999f55735278acd76f0fa207218cac00a739047/native/livi-helperd/crates/livi-cp/src/video_playback.rs#L55-L82)
builds borrow/return for integrated CarPlay `videoPlayback`; its checked mode handler
only handles app states, not resource-owner confirmation. This does not establish
ordinary AirPlay URL coexistence. [Catplay](https://github.com/catplay-labs/catplay/blob/bc6edae49554f2d0160b18ed18fc7b7376353115/carplay/catplay_carplay/src/carplay_rx/sink/session_handle.rs#L146-L180)
separates borrow/unborrow, command results and ModesChanged; no license was found at
that revision, so no code is copied. These comparisons do not explain this iPhone's
peer EOF or replace fresh ownership and actual-picture evidence.

HEVC sample-entry parsing accepts the sender's bounded terminal zero padding after complete
validated boxes. Truncated boxes and HDR/Dolby metadata remain rejected; padding cannot
hide an additional extension. Repeated mirror configurations/pause retain the decoder epoch and AES-CTR position;
paused transport still consumes ciphertext. Clean packet-boundary EOF permits same-peer
reconnect for five seconds; partial packets or expiry end the mirror. RTP/NTP anchors
map audio/video to one monotonic clock; bounded reordering/retransmission and FLUSH
preserve stream epochs. Missing synchronization is explicit arrival-playback fallback,
not source synchronization. Resize scales the current mirror; new dimensions apply
at the next SETUP. Keepalive tuning is not a recovery-time guarantee.

AAC mirror NoData access units occupy the negotiated number of source samples.
They pass through the same RTP ordering, duplicate rejection, retransmission and
FLUSH boundaries as other audio; dropping them before ordering creates false gaps.
The browser recognizes the exact marker only for mirrored AAC-LC/ELD and emits
the negotiated frame length as zero PCM in source order. These are explicit silence
samples, not evidence of network loss or a measurement of physical output.
Native AAC output consumes a bounded queue of submitted source-sample spans;
callbacks may split/merge samples or compact timestamps across silence. Source
coordinates come from those spans. NoData submission does not block later encoded
input and does not flush/reset codec overlap state. Only silence blocked by missing
earlier output starts the 2-second failure timer; new silence does not extend it.

An externally revoked display can still replace the browser decoder epoch. Ordinary
mirroring has no confirmed sender keyframe-request implementation, so the local
recovery callback cannot guarantee a new independently decodable frame. Continuing
prediction frames alone cannot restore a decoder whose initial keyframe was lost.
Read live policy, source-clock freshness and capacity-drop evidence separately from
URL buffering; the [live diagnostics](Diagnostics.md#live-video-policy-evidence)
describe the measured windows and remaining tuning limits.

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

Startup diagnostics separate dependency loading, video/audio selection, audio-menu
discovery, metadata and first decoded samples from readiness and actual `playing`.
The browser's source-engine elapsed time freezes at the first actual playback;
later seeks do not restart that measurement. It excludes the preceding resource
type probe. Initial zero-position directives reuse already prepared frames;
nonzero initial positions and later explicit seeks still rebuild at their target.
Audio-menu discovery currently checks alternative renditions before selected-track
decoding starts. A slow unused rendition can therefore still delay preparation;
moving those reads into playback requires scheduling that cannot starve active media.

TiPlay owns one audio-leading clock, bounded queues, buffering, seek and rate;
silent video uses monotonic time. The shared URL-casting profile favors smoothness:
750 ms startup / 1500 ms recovery are target playback-time watermarks, not guaranteed
decoded coverage. The corresponding media-time target is multiplied by playback rate.
Short-resource EOF, a limiting application budget or a bounded pending-read wait can
permit playback from smaller real coverage; diagnostics distinguish these decisions.
These defaults require vehicle tuning. Underrun freezes both streams; playable buffers
use their intersection. HLS date-time is not media position. Video.js uses its official default skin with ±10-second seek controls and a
matching casting-end button, and adapts this engine,
without a second HTML video clock. SoundTouch preserves pitch during rate changes.
Controls expose actual time/buffer/seek ranges, rate, available tracks, loading and
Stop, without volume/fullscreen. Pause retains rate, including older APK commands
that omit it. Playback IDs and independent seek revisions reject stale reports;
iPhone queries acknowledge new seek targets immediately while browser actual position
remains distinct. Direct-to-proxy error recovery preserves the current position/rate
when no newer playback directive supersedes it. Replacement cancels requests/decoders/output.
Live recovery is bounded.

The URL engine has separate admission limits; they must not be added or described as
one total-memory or total-GPU limit:

| Limit | Scope |
| --- | --- |
| 32 frames | Application queue of decoded video samples waiting for presentation; the retained canvas picture is separate. |
| 256 MiB | Current URL video admission estimate for queue plus retained picture, reserving the next sample; changed from beta.12's 96 MiB at the user's request. Coded width × coded height × four bytes estimates ownership, not GPU allocation. Already decoded samples awaiting admission are separate. |
| 2 seconds | Video media-time lookahead checked before another sink read; sample granularity can cross the threshold. |
| 3 seconds | Audio media-time lookahead checked before another sink read; an admitted packet can cross the threshold. A single decoded audio packet longer than three seconds is rejected. |
| 12 MiB | Decoded PCM queue admission threshold checked before the next audio read, not a total PCM hard limit. An admitted packet or tempo output can append in full and cross it; incoming packets, processing and scheduled Web Audio copies are separate. |
| 16 MiB | Mediabunny raw-byte cache eviction threshold. It can retain the one entry crossing this soft threshold; it does not measure decoder surfaces or all browser network storage. |
| 256 KiB | Ordinary serialized resource-read unit, not a complete-file size limit. Playlists and resource probes have their own bounds. |

Read admission includes the retained picture and anticipates a replacement rather
than requiring one more decoded frame to discover capacity pressure. Both pictures
must fit the estimate, so a single sample above 128 MiB is rejected with the current
256 MiB budget. Under the earlier 96 MiB setting, a finite-surface regression showed
this failure: at 1080p/30, a pool holding thirteen
application samples could stop at about 433 ms before the former next-frame budget
check, while fourteen allowed startup. This is a controlled code-level failure model;
the browser's actual hardware pool capacity was not measured in field evidence.
Pending reads can also reflect resource or decoder waiting. A
`read-progress-fallback` starts from existing playable coverage after the normal
startup/recovery wait; it does not assert that hardware buffers are full.

Mediabunny also owns internal decoded samples and decoder/reference buffers outside
the application queue. Its current sink has no public decoded-prefetch-size option;
holding fewer application pictures does not establish a total surface bound. The
canvas retains one sample, and an incoming sample or orientation/render resources can
coexist with it. Application sample receipt/close counters cannot measure vendor
decoder output or physical surface release. Likewise, a supported codec and requested
hardware/latency hint do not establish the decoder's actual hardware implementation.
The beta.12 field/oracle evidence used 96 MiB, about three 4K/30 pictures or
67–100 ms. The requested current 256 MiB estimate holds about eight, roughly 267 ms;
actual coverage can be smaller. The separate 32-frame queue cap remains; the held
picture counts toward bytes but not those 32 queued frames. At 1080p/30 the joint
limits cover roughly one second, not several seconds. These remain estimates, not
vehicle calibration or private decoder-pool capacity. Audio submission is bounded by
the common continuous A/V coverage
and existing 500 ms horizon, so ready PCM cannot compensate for missing video or a
blocked shared animation-frame tick. The beta.12 user's 4K playback was itself
non-continuous; it cannot establish the cause of steady-playback clicks. The
controlled scheduling baseline does not identify actual vehicle decoder throughput.
An audio-master change was not adopted because sustained slow decoding could leave
video unboundedly behind. Worker isolation, a source-provided lower-cost representation
and measured hardware throughput remain options requiring explicit ownership,
synchronization and slow-progress acceptance. Only the URL video byte budget changes
this round; CarPlay/mirror remain at 64 MiB, while DSP, watermarks, the 500 ms audio
horizon and synchronization stay unchanged. No acoustic improvement is established. See
[URL playback evidence](Diagnostics.md#airplay-url-playback-evidence).

Readiness and play intent are distinct from an advancing clock. With audio, a suspended
AudioContext or pending resume can leave decoded media ready without actual playback;
user activation may be required. Seek, rate and audio-track changes retire the old
generation and rebuild both queues at the shared position. A retained video picture
covers the interval until its successor's presentation timestamp, including still-image
and variable-frame-rate gaps; this does not fabricate missing audio coverage.
Decoded audio durations and scheduling cursors use integer PCM-frame counts.
Continuous packet timestamps are aligned only within half a source sample;
initial seek trimming and genuine gaps/overlaps remain distinct. Partial scheduling
advances by the samples actually submitted rather than a floating-point target.
The URL AudioContext requests the decoded source rate and verifies that the browser
honors it. This keeps short source nodes on one sample grid; the browser converts
the complete context stream to the output device's rate. Same-format generations
reuse the context, while a changed audio format retires it before preparing the
replacement. Unsupported context rates fail explicitly. Requested/context rates
do not measure the physical device's oscillator or speaker output.
Failures preserve the available state before cleanup and report actual ownership
afterwards separately. A canvas-retained picture can remain held until it is closed;
queue cleanup alone does not establish that all samples or vendor surfaces were released.

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
Browser media and caption discovery serialize actual network reads. Range-capable media
uses bounded byte-range units. When Range is ignored, a sequential body is reused per
resource identity: URL, headers excluding Range and fetch credentials/mode/redirect.
Different identities can retain separate readers. Interleaved audio/video reads from
the same URL and identity still retire that reader on a backward logical range and may
download the prefix again; `resourceBackwardRestarts` and `resourceRangeIgnored` expose
these observations without recording the URL. The
LRU pool holds at most four readers and 4 MiB of application-retained network chunks;
these bounds do not measure the browser's internal network buffers. Backward seeks,
owner cancellation, eviction and five seconds of inactivity retire readers, awaiting
cancellation before reusing their slots. FCUP exchanges remain serialized. Startup probes
request at most 64 KiB, including through FCUP, so
a large video need not fit inside the broker's whole-response limit just to discover its type.
Track ranking uses master metadata;
SDR/decoder validation probes candidates one at a time and skips unavailable alternatives.
Interrupted requests may be reused only within their original deadlines. Expiry,
cancellation and replacement release the queue; consumed responses are not a live
manifest cache. Local files and `skd` keys are excluded.

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

Captions support WebVTT, AVC/HEVC CEA-608/708 text, HLS fMP4 `wvtt`/`stpp` and MP4
`tx3g`/`wvtt`/`stpp`. Identity AES-128 segments support rotating keys, explicit/sequence
IVs and encrypted initialization maps, without DRM authorization. Cues follow the
engine clock through seek/discontinuity/origin changes; lookahead cannot show them
early. Independent source offsets need a real media anchor; lost live overlap anchors
stop that track. Bounded discovery never blocks video, disabled sidecars do not
continuously fetch, and caption failure cannot terminate playback. Only parsed tracks
expose controls. Output is plain text, excluding TTML images/complex layout and
CEA-708 window styling. [Apple's AirPlay 2 TV guidance](https://developer.apple.com/streaming/hls-authoring-specification-for-apple-devices.html#amended-requirements-for-airplay-2-enabled-tvs)
specifies WebVTT; broader support does not prove sender delivery.

## Maintenance

| Contract | Source |
| --- | --- |
| Capability/format truth | [ReceiverCapabilities](../shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverCapabilities.kt), [audio formats](../shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverMirrorAudioFormat.kt) |
| Resource bounds/deadlines | [ReceiverResourceRequests](../shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverResourceRequests.kt), [proxy](../shared/src/main/java/com/shilapi/xcertplay/web/AirPlayVideoProxy.kt) |
| Engine/control ownership | [airplay-media.js](../site/play/airplay-media.js), [videojs-player.js](../site/play/videojs-player.js) |
| Dependencies/licenses/rebuild | [lockfile](../scripts/videojs/package-lock.json), [media bundle](../site/play/vendor/mediabunny/README.md), [controls bundle](../site/play/vendor/videojs/README.md) |
| UxPlay/playfair provenance | [notices](Third-party-notices.md), [native record](../shared/src/main/jni/airplay/README.md) |

Runtime dependencies are self-hosted. Asset changes update the complete Service Worker
manifest/cache identity. Diagnostics record redacted protocol/buffer/version metadata,
excluding media, keys and authentication payloads in Standard. Debug mode separately captures unredacted application traffic and media; see [Diagnostics](Diagnostics.md). Relevant checks include browser unit/E2E
playback and `python3 scripts/test_airplay_native.py`, alongside repository requirements.
Desktop fixtures do not establish iPhone compatibility, vehicle performance, acoustic
synchronization, long playback, subtitle alignment or expired-live recovery. Physical
acceptance remains in [Todo.md](Todo.md).
