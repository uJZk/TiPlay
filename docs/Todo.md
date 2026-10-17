# Pending work and device acceptance

TiPlay supports Android phone + car browser only. These checks remain open; automated tests, desktop browser fixtures and older native-head-unit measurements do not mark them passed. Record exact APK/commit, Android and iOS versions, browser/vehicle firmware, transport, settings and diagnostic evidence. Keep local device captures and secrets outside Git.

## Engineering follow-up

- [ ] Evaluate user-adjustable browser navigation gain from upstream #752. The merged native AudioTrack slider does not affect browser output; TiPlay currently uses fixed 0.25 navigation amplitude on SCO. Adapt the real browser/SCO mixing path and setting semantics together before exposing a control; preserve the existing default and avoid double attenuation. See [upstream integration review](Upstream.md#integration-review).
- [ ] Run independent `:common:lintDebug`, investigate any remaining permission/API findings against the merged application's permission context, and decide whether to add it to [CI](../.github/workflows/android.yml). The previously named `bondedDevices` access now has a `BLUETOOTH_CONNECT` check; do not assume that old finding persists.
- [ ] Implement an independent AirPlay video queue and queue controls before advertising feature bit 33. A cached HLS playlist is not a queue. Audio redundancy bits 11/61 remain unadvertised until implemented.
- [ ] Decide whether the official browser page needs a custom domain; test first load in the target vehicle without a proxy. GitHub Pages hosting alone does not establish reachability.

## Connection, settings and browser

- [ ] Validate car-audio Bluetooth class/profile changes, permission loss and unknown-device hints on a physical phone. Stress Debug capture over USB and wireless with real media, storage pressure and process restarts; verify Standard TXT and Debug ZIP exports, per-session/channel reconstruction, process-start default-off, version/configuration markers, clear-while-capturing with saved ZIP preservation, error counters, interrupted-record recovery and live AirPlay proxy/direct switching. These captures observe application I/O, not Bluetooth air packets or USB bus signalling.

- [ ] Verify the single-page Permission checklist on a physical phone: no welcome/connection/audio steps or duplicate list in Advanced settings, missing-only runtime grants, denial and permanent-denial recovery, Bluetooth/battery settings, USB VPN consent, completion, rotation, Back and reopening from Main settings. Check spacing across the checklist, Main/Advanced settings and About on narrow screens and with large fonts, and state refresh after returning from system settings. Verify automatic hints stay under the status, explicit button results stay at their source, Root/Shizuku/VPN late results do not move or reappear, and unreadable SSIDs do not become false Wi-Fi failures. Confirm cold launch, USB, boot and Bluetooth events do not attempt an iPhone connection before an authenticated browser reports its dimensions and decoder support. Check the waiting title, heartbeat expiry and automatic HEVC/H.264 selection without a manual switch.

- [ ] On a physical phone and vehicle browser, verify short receiver titles and separate details during permission waits, USB enumeration, connection failure/recovery and AirPlay load/pause/buffering. Confirm browser errors can be closed without reappearing on status polls, while pairing-code and address errors remain beside Connect.
- [ ] Test cold launch/boot, wireless and USB startup, All-mode USB priority/removal, ordinary Android consent, Bluetooth arrival retry, disable/re-enable, repeated reconnects, background/resume and sustained use. Measure battery cost; no zero-power claim.
- [ ] Test valid/incomplete settings edits, recreation and Advanced-page return, rapid edits during recovery, FPS/HEVC/audio changes and CarPlay disabled state. Confirm immediate apply preserves the current settings page.
- [ ] Test hotspot method/address/port changes: phone applies immediately, browser stays on its saved endpoint until manual disconnect/edit/connect or a new pairing link; pairing code persists. Test Root/Shizuku re-add after hotspot restart and refusal recovery, current Android Shizuku authorization, VPN link-local reachability, VPN conflicts/revocation and concurrent wireless CarPlay.
- [ ] Test Existing Wi-Fi with Open, WPA2, transition and WPA3 networks, redacted SSID/security, dual-family reachability, network/address loss, iPhone online services and browser access. Extra hotspot addresses do not solve a joined router's browser restrictions.
- [ ] Test vehicle browser first pairing, permissions/local-network prompts, cached/offline reopen, long HTTP streams, touch/buttons, theme and viewport resize/shrink/restore. Confirm replacement first-frame recovery, no stale input and eventual resolution renegotiation during repeated resizes.
- [ ] Confirm physical end-to-end picture latency, acoustic A/V alignment and performance-monitor behavior. Capture real iPhone `Video config marker` evidence; configured hardware preference and synthetic decode benchmarks do not prove vehicle decoding.

## Location

- [ ] Validate cold-start drift, immediate GCJ-02 confirmation, WGS84 movement confirmation,
  browser-local cache/reload and cache clearing in the actual vehicle. Check high accuracy Android GPS
  location accuracy, precise permission and approximate-only refusal, phone screen off, GPS disabled, unavailable GPS
  provider and fallback before confirmation. Verify no external positions after opt-out and
  iPhone behavior after renegotiation; source selection is controlled by iOS.
- [ ] Check geocoordinates native loading on physical ARM devices, refined output in final iPhone
  navigation, geographic boundary crossings, Hong Kong/Macau, stale/reordered callbacks and
  browser ownership changes. Automated decision tests do not establish sensor accuracy.

## Browser and CarPlay audio

- [ ] Verify uninterrupted Apple Music and Xiaoyuzhou sound through batched real-time delivery, concurrent buffered music/mirroring and slow-browser recovery. Separate RTP loss, relay drops, decode stalls, HTTP jitter and browser underruns; verify bounded buffering during long playback, pause/seek and network variation.
- [ ] Validate implemented RTP sampling timestamp → `RtpAudioTimeline` → browser PCM scheduling, including anchors, drift, wraparound, reordering, missing packets, stream switches and independent music/navigation/call resets.
- [ ] Test microphone permission and demand-driven Android HFP/SCO switching, fixed navigation attenuation, Siri/calls, acoustic echo behavior and reconnect with the actual iPhone and vehicle. Verify audio opt-out consistently uses iPhone-to-car Bluetooth and re-enabling restores idle browser playback. See [browser audio](Browser.md).

## Ordinary AirPlay

- [ ] Verify discovery cold launch, CarPlay disconnect/reconnect, hotspot changes and AirPlay disable/re-enable; check service names, stale TXT and actual ports. Validate screen borrowing/return, sender preemption, mixed audio and iOS actively ending CarPlay. See [AirPlay contracts](AirPlay.md).
- [ ] With actual iPhone apps (including Photos, Bilibili and YouTube), test first/repeated cast and reconnect with and without active CarPlay. Distinguish native `PUT /photo` JPEG/PNG from type-110 mirroring; test `cacheOnly`/`displayCached`, cache-miss 412, EXIF orientation and stop cleanup. Slideshow scheduling is outside the advertised scope.
- [ ] Test first approval, reject, five-second timeout, browser disconnect and settings-page notification; verified-key trust, reconnect, forgetting, concurrent owners and stale callbacks. Legacy HTTP identity must not become persistent trust through a name/IP alone.
- [ ] Verify type-96 negotiation follows the current browser's native/software support: AAC-ELD remains available, prefers supported WebCodecs and falls back to the bundled decoder. Check ALAC/AAC-LC unsupported-format rejection, sender negotiation and browser replacement/disconnect. Verify PCM byte order assumptions, browser decoder compatibility/latency, RTP/NTP anchors, UDP 0x55/0x56 retransmission, wrap/reorder/loss, FLUSH isolation and independent audio stop. Confirm no persistent arrival-time fallback or leaked audio when switching mirror/URL playback.
- [ ] Test mirror HEVC configuration, H.264 fallback, pause/resume, orientation and viewport scaling (new dimensions on next SETUP), SDR HLS selection/no-SDR errors and mirror HDR rejection. Legacy AirPlay has no confirmed force-SDR request field.
- [ ] Test MP4/HLS URL playback decode, seek/pause/resume/rate, long playback, tail audio, buffering, bounded expired-live recovery and actual FCUP-proxy/iPhone-direct CORS reachability. Include MiniBili startup with app resources delivered after `/play` acknowledgement, loading-state queries and stop during resource preparation. Check optional `selectedMediaArray`/`textMarkupArray` sender schemas.
- [ ] Test WebVTT, HLS-TS CEA-608/708, MP4/CMAF `tx3g`/`wvtt`/`stpp`, encrypted WebVTT/fMP4 key rotation/IV/init segments, language/track selection, seek and live discontinuity alignment. Sidecars need the original media anchor; do not substitute normalized playback time. Apple TV/WebVTT delivery needs real sender verification. TTML images/complex layout, CEA-708 window styling and DRM authorization remain outside rendering scope.
