# AirPlay receiver improvements, 2026-10-14

This change implements the receiver review requested after comparing TiPlay with
[jqssun/android-airplay-server](https://github.com/jqssun/android-airplay-server)
(`c8defdd70d7e6a04f4f1b71d353653682d594106`) and [UxPlay](https://github.com/FDH2/UxPlay) (`462153392f2e30937424922039ff9f0cda5e7b1a`).
It applies to the Android phone + car browser product. Sources were compared;
the reference Android player and its display/audio output were not imported.
The pre-existing `playfair` transport-key source remains pinned to its recorded revision.

## Photo, display and session behavior

| Area | Implemented behavior |
| --- | --- |
| Photo capability | Advertises photo caching (bit 13), matching the implemented cache protocol; slideshow/queue bits remain off. |
| Photo protocol | `PUT /photo`, bounded JPEG/PNG bodies, `cacheOnly`, `displayCached`, cache miss 412, separate photo-category events and explicit stop/cache retirement. |
| Photo output | Original JPEG/PNG bytes use the authenticated browser resource endpoint. Native image decoding retains EXIF orientation and fits the viewport. Android photo surfaces/re-encoding were removed. |
| Photo bounds | 16 MiB per image, eight cached entries, 64 MiB cache budget, bounded keys; browser validates dimensions and total pixels before decode. |
| Display size | CarPlay and AirPlay use the same viewport × DPR size planner. Actual browser H.264/HEVC support and measured size limits are reported to Android. |
| Resize | An active mirror scales in the browser. Updated negotiated dimensions apply at the next mirror SETUP, preserving the active encrypted stream. |
| Capability fallback | Browser codec probing tries supported size/configuration choices; an explicitly unsupported browser does not retain a false mirror declaration. Photos, URL video and audio remain separate capabilities. |
| Mode ownership | Mirror, photo, URL video and standalone audio switch through the current authorized owner; default IDs or matching IP addresses alone cannot transfer authority. |
| Playback probe | Before playback, `/playback-info` returns a valid empty state. `/play` waits for real browser readiness with a bounded ten-second deadline. |
| Disconnect/stop | Abandoned not-ready/paused plays get bounded cleanup, stop is idempotent with a short tombstone, and late old callbacks cannot stop a replacement. |
| Mirror reconnect | Clean EOF at a complete packet boundary permits same-peer reconnect to the original port for five seconds. Cipher byte position and decoder epoch survive; partial packets do not resume. |
| CarPlay restoration | Release current AirPlay output before restoring CarPlay; request/display generations reject delayed callbacks from previous playback. |

The photo change fixes the receiver's independently implemented photo path. It does
not establish that every version of the Photos app will select `PUT /photo`:
iOS can also send a photo presentation over type-110 mirroring. Real iPhone checks
must distinguish those paths from whole-screen fallback.

## URL resources, playback and native controls

| Area | Implemented behavior |
| --- | --- |
| Request bounds | Photo bodies permit 16 MiB; bounded `/action`/FCUP exchanges permit 32 MiB. Oversized declared bodies receive 413 before allocation. |
| FCUP | Session/peer/URL/request-ID checks, one active exchange, inflight deduplication, playlist priority, original bounded dispatch deadlines and automatic expiry. Consumed live manifests are not cached across loads. |
| Phone resources | Preserve Range and authenticated child-resource rewrites. Direct phone resources that fail CORS/reachability can fall back to the authorized Android proxy. |
| HLS formats | Real HLS-TS and CMAF/fMP4 HLS are demuxed by Mediabunny and decoded with browser WebCodecs. |
| Live recovery | Expired live resources have bounded resynchronization; a replacement source cannot receive stale recovery work. User playback intent and track choice are retained. |
| Decode fallback | Hardware preference is used only when the exact decoder configuration supports it. Software/default WebCodecs configurations remain usable. |
| Audio choice | Video.js native audio-track menu switches usable tracks on the existing playback clock. Its button appears only when more than one usable choice exists. |
| Subtitle choice | Video.js native subtitle controls appear after actual supported text/caption tracks are parsed. Absent/unsupported text does not expose an empty button. |
| Properties | Typed playback-property reads and strictly validated selected-track/text-markup changes bridge the receiver and browser. Unknown mutation payloads do not pretend to apply a selection. |
| Clock | Video and URL audio stay under the existing browser playback clock, including seek/rate/pause and short tails. |

`selectedMediaArray` and `textMarkupArray` have only the implemented, validated
schemas. Actual Apple application payloads still need device verification;
these optional endpoints do not imply universal sender track-control compatibility.

## Embedded and encrypted subtitles

- HLS WebVTT supports ordinary AES-128 whole-segment encryption, explicit IV or
  media-sequence IV, rotating keys (including repeated URIs with a new declaration), byte ranges, encrypted initialization maps,
  bounded fetches/cache and cancellation. Keys stay in memory for the active source.
- CMAF/fMP4 subtitle renditions support `wvtt` and text `stpp` samples, initialization
  segments, fragment sample timing and byte ranges.
- Embedded MP4 supports text `tx3g`, `wvtt` and `stpp`, with sample timing/edit lists
  and bounded ranged sample retrieval.
- HLS-TS and fragmented media observe encoded packets/segments for AVC/HEVC
  CEA-608/708 captions. Caption output uses media time, bounded packet queues and
  reset on source/seek; future prefetched captions do not alter the visible cue early.
- Cue text is safe text; markup/styles are restricted. Complex TTML image/layout
  and CEA-708 visual window styling are outside the text renderer.

Apple's AirPlay-2-to-TV authoring guidance requires WebVTT subtitle renditions;
general HLS also allows fragmented MP4 subtitle formats. Implementing both does
not prove that every AirPlay sender exposes them to this legacy receiver.
AES-128 transport encryption is distinct from DRM: SAMPLE-AES/FairPlay Streaming
licenses and protected-content playback are not implemented.

## Full declared ordinary audio formats

`/info` retains the output mask `0x3fffffc`, bits 2–25. SETUP must select one
supported format; a multi-bit mask is not a selected codec. Explicit codec/rate/
channel/bit-depth fields must agree with that choice.

| Codec | Supported declared input |
| --- | --- |
| PCM | 8/16/24/32 kHz, 16-bit, mono/stereo; 44.1/48 kHz, 16/24-bit, mono/stereo |
| ALAC | 44.1/48 kHz, 16/24-bit, stereo |
| AAC-LC | 44.1/48 kHz, stereo; 960/1024 samples per frame |
| AAC-ELD | 44.1/48 kHz, stereo; 480/512 samples per frame |

All ordinary AirPlay decoding is performed in the browser. Android receives and
decrypts type-96 RTP, orders packets and maps RTP/NTP timestamps, then forwards
encoded payloads and their negotiated configuration to the authenticated browser
audio stream. Browser code handles network PCM 16/24-bit conversion or uses
`AudioDecoder` for compressed formats. The browser AudioWorklet owns output. Packed 24-bit input is converted to the
existing PCM16 worklet contract; 24-bit input support does not mean lossless
24-bit output.
URL video audio remains demuxed/decoded by the browser's URL player.

PCM type-96 defaults to network big endian, supported by RFC 3551 L16 and the
legacy uncompressed shairport-sync implementation; a real sender capture still
needs to confirm this transport assumption.

The mask describes formats that the transport and browser decoder adapter accept;
actual compressed playback depends on `AudioDecoder.isConfigSupported` for the
negotiated codec/profile/rate. In particular, ALAC and AAC-ELD are not widely
supported across browser WebCodecs implementations. An unsupported decoder is
reported explicitly; there is no Android codec fallback and no bundled software
codec. Documenting this limit does not make unsupported formats playable.

Audio transport includes bounded jitter/reordering, RTP/NTP timing, no-data marker
handling, 0x55 retransmit requests/0x56 replies, frame-size-aware configuration, and
FLUSH of transport/browser decoder/output epochs. A source or format replacement
cannot receive old decoder output. AudioRedundant bit 11 and RFC2198 bit 61 stay
off; on-demand retransmission is not a redundant encoding implementation.

CarPlay idle AAC/Opus/LPCM audio is also forwarded for browser decoding, with
independent media/navigation decoder state and the existing fixed music buffer.
On microphone demand, browser output is muted/flushed and Android decodes the
permitted voice/navigation streams for vehicle HFP/SCO. Android's Bluetooth stack
owns mSBC/CVSD negotiation/encoding; TiPlay supplies PCM through the owned SCO route.
Ending microphone demand waits for actual route release before returning to browser
decoding. Packet/publication/decoder epochs prevent late output crossing that boundary.
Phone microphone capture/encoding remains on Android.

## Volume, trust and SDR

Remote volume remains disabled: ordinary AirPlay bit 3 and bit 32 are clear.
CarPlay bit 3 stays clear; its bit 32 identifies CarPlay, so it is retained.
No sender volume command changes gain. Music artwork and song-text capabilities are disabled in
the phone/browser profiles; related iAP2 fields are not requested and unsolicited
artwork/text is discarded. Playback state/progress and controls are retained. The fixed `GET_PARAMETER volume` reply and
validated no-op `SET_PARAMETER volume` response are needed protocol compatibility,
not a remote volume implementation. Browser/vehicle local volume remains available.

First-device approval appears at the paired browser's upper right, with a Liquid
Glass notification style. It expires after five seconds and defaults to rejection.
Only successfully verified pairing public-key fingerprints can be remembered.
Legacy HTTP without a verified identity gets current-connection approval; bounded
same-peer strong session IDs associate its related connections. IP/name is never
persistent trust. Authorization cannot preempt another active device. Android
Advanced settings can forget all trusted devices; the current cast is retained
and later connections require approval. All existing Android locales include this copy.

HLS masters prefer explicit SDR renditions and drop PQ/HLG/Dolby Vision choices
before variant media requests. URL track metadata and decoded frame color information
are checked. Mirror SPS/VUI and recognized HDR metadata are validated before forwarding;
HDR that cannot be rendered as SDR is rejected instead of relabeled. No HDR tone mapping
is claimed. The reference receiver's `enforceSdr` changes local MediaFormat properties,
not sender negotiation. No confirmed legacy AirPlay SDR-request field was found, so
sender compliance cannot be guaranteed by declaring an invented flag.

## Validation and acceptance boundaries

- Browser suite: 214 tests passed on the final browser implementation, including
  per-stream decoding, output sequence uniqueness and same-URI AES key rotation.
- Real Chromium 151: HLS-TS and CMAF frames decode; absent-choice buttons hide;
  two audio tracks switch; embedded `tx3g` cue displays; EXIF-rotated JPEG dimensions,
  viewport fitting, notification placement/approval/expiry and actual PQ/HLG frame
  recognition were exercised. This is browser validation, not a vehicle test.
- Real Chromium browser audio: AAC-LC produced 10 decoded frames / 20,480 channel
  samples, all retained by the actual PcmTimeline; Opus produced 11 frames with
  unique output sequences and nonzero tone samples. PCM16/24 conversion, independent
  stream epochs, bounded buffered music and unsupported-format handling have unit
  regressions. This Chromium reports ALAC and AAC-ELD unsupported. No Android
  software audio decoder or codec vendor library is included.
- FairPlay transport JNI boundary, public-tree and release-draft checks pass.
- The required full Android command executed 3,442 tests (1,922 shared, 1,514
  common, six home), all three required application lints and all three debug APK
  builds. Lints and APK builds passed. That full run reported fixture/framework
  issues in three test classes, plus earlier time-sensitive assertions; the source
  fixtures were corrected without relaxing production ownership/routing checks.
  The final affected-class rerun passed all 29 tests, including the unchanged
  USB cancellation class. This is full-run coverage plus targeted retesting;
  an unfiltered green run after the final test-only edits was not repeated.
- Android artifacts were inspected: no `libtiplay_audio_codecs.so` or FFmpeg decoder
  library is packaged. The existing FairPlay transport and non-codec native libraries
  remain. These are implementation-stage results; final remote integration and
  delivery are recorded in [the October 15 tie-up](AIRPLAY-TIE-UP-2026-10-15.md).

Real Photos-app selection, sender-specific optional properties/subtitle delivery,
long-running live HLS, ordinary audio negotiation/latency and CarPlay coexistence
still require iPhone + Android + vehicle verification. Those acceptance tasks remain
in [todo.md](todo.md); generated browser fixtures cannot establish them.
