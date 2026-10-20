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

HEVC sample-entry parsing accepts the sender's bounded terminal zero padding after complete
validated boxes. Truncated boxes and HDR/Dolby metadata remain rejected; padding cannot
hide an additional extension. Repeated mirror configurations/pause retain the decoder epoch and AES-CTR position;
paused transport still consumes ciphertext. Clean packet-boundary EOF permits same-peer
reconnect for five seconds; partial packets or expiry end the mirror. RTP/NTP anchors
map audio/video to one monotonic clock; bounded reordering/retransmission and FLUSH
preserve stream epochs. Missing synchronization is explicit arrival-playback fallback,
not source synchronization. Resize scales the current mirror; new dimensions apply
at the next SETUP. Keepalive tuning is not a recovery-time guarantee.

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
| 96 MiB | Admission estimate for the current video queue plus retained picture, reserving the estimated next sample. It uses coded width × coded height × four bytes, not measured GPU allocation. An already decoded sample awaiting admission is reported separately. |
| 2 seconds | Video media-time lookahead checked before another sink read; sample granularity can cross the threshold. |
| 3 seconds | Audio media-time lookahead checked before another sink read; an admitted packet can cross the threshold. A single decoded audio packet longer than three seconds is rejected. |
| 12 MiB | Decoded PCM queue admission threshold checked before the next audio read, not a total PCM hard limit. An admitted packet or tempo output can append in full and cross it; incoming packets, processing and scheduled Web Audio copies are separate. |
| 16 MiB | Mediabunny's configured compressed resource cache; it does not measure decoder surfaces or all browser network storage. |
| 256 KiB | Ordinary serialized resource-read unit, not a complete-file size limit. Playlists and resource probes have their own bounds. |

Read admission includes the retained picture and anticipates a replacement rather
than requiring one more decoded frame to discover capacity pressure. Both pictures
must fit the estimate, so a single sample above 48 MiB is rejected. A finite-surface
regression demonstrates the failure this prevents: at 1080p/30, a pool holding thirteen
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
See [URL playback evidence](Diagnostics.md#airplay-url-playback-evidence) for the
observed stages and their limits.

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
Neither makes an unreachable sender reachable. FCUP serializes exchanges with
session/peer/URL/request-ID checks; acknowledgement is not resource completion.
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
