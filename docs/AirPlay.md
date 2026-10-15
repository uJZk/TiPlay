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
| Type-96 audio | RTP/decryption, packet order, RTP/NTP mapping | PCM conversion or WebCodecs decoding; AudioWorklet output |

No Android URL-video/photo encoder or ordinary audio decoder fallback exists.
The audio transport accepts PCM, ALAC, AAC-LC and AAC-ELD; negotiated combinations
are defined in the source below. Browser support is required, particularly for
ALAC/AAC-ELD. Network PCM defaults to big endian, pending real-sender confirmation;
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
is confirmed, then requests a keyframe. See [Apple's resource-management explanation](https://developer.apple.com/videos/play/wwdc2016/723/).

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

Repeated mirror configurations/pause retain the decoder epoch and AES-CTR position;
paused transport still consumes ciphertext. Clean packet-boundary EOF permits same-peer
reconnect for five seconds; partial packets or expiry end the mirror. RTP/NTP anchors
map audio/video to one monotonic clock; bounded reordering/retransmission and FLUSH
preserve stream epochs. Missing synchronization is explicit arrival-playback fallback,
not source synchronization. Resize scales the current mirror; new dimensions apply
at the next SETUP. Keepalive tuning is not a recovery-time guarantee.

## URL engine and captions

TiPlay owns one audio-leading clock, bounded queues, buffering, seek and rate;
silent video uses monotonic time. Underrun freezes both streams; playable buffers use
their intersection. HLS date-time is not media position. Video.js adapts this engine,
without a second HTML video clock. SoundTouch preserves pitch during rate changes.
Controls expose actual time/buffer/seek ranges, rate, available tracks, loading and
Stop, without volume/fullscreen. Pause retains rate, including older APK commands
that omit it. Playback IDs and independent seek revisions reject stale reports;
iPhone queries acknowledge new seek targets immediately while browser actual position
remains distinct. Replacement cancels requests/decoders/output. Live recovery is bounded.

Authenticated resources validate browser/playback/resource identity, preserve Range,
stream media and rewrite bounded HLS manifests/children/keys. Current-iPhone resources
may redirect directly, with authorized proxy fallback for failed CORS/reachability.
Neither makes an unreachable sender reachable. FCUP serializes exchanges with
session/peer/URL/request-ID checks; acknowledgement is not resource completion.
Interrupted requests may be reused only within their original deadlines. Expiry,
cancellation and replacement release the queue; consumed responses are not a live
manifest cache. Local files and `skd` keys are excluded.

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
never media, keys or authentication payloads. Relevant checks include browser unit/E2E
playback and `python3 scripts/test_airplay_native.py`, alongside repository requirements.
Desktop fixtures do not establish iPhone compatibility, vehicle performance, acoustic
synchronization, long playback, subtitle alignment or expired-live recovery. Physical
acceptance remains in [Todo.md](Todo.md).
