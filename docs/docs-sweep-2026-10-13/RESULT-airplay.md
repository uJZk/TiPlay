# AirPlay, browser media and network documentation recovery

- Date: 2026-10-13; recovered after the environment restart at baseline `1db90a7c`.
- Model: GPT-6, available model; technical source verification required.
- Scope: AIRPLAY, BUFFERED_AUDIO, BROWSER-MEDIA-2026-10-13, THIRD_PARTY_NOTICES, JNI airplay README, Video.js vendor README, EXISTING_WIFI and COMPATIBILITY.
- Status: complete. Restored fixes in six guides/notices; JNI/vendor provenance READMEs checked and preserved. Parent owns TASKS and all source/test/build/delivery changes.

## Checklist review

| Requirement | Evidence/result |
| --- | --- |
| Naming and canonical destinations | Current names use TiPlay; THIRD_PARTY_NOTICES maintenance URL now uses user-approved `https://github.com/uJZk/TiPlay`. Upstream DiPlay attribution and numbered PR references preserved. No entry README in this scope. |
| Concise labels and immediate application | Kept concise AirPlay/HEVC/VPN labels. EXISTING_WIFI now uses Choose iPhone, automatic valid-change saving/application, invalid draft retention and Reconnect CarPlay. Enabled idle edits may intentionally resume recovery; no obsolete no-start policy or conflict warning retained. |
| Manual endpoint contract | No scoped guide claims proactive endpoint notification or automatic migration. Existing Wi-Fi points to the Tesla browser guide for address/reachability. Android endpoint application and manual browser Disconnect/address-update/Connect remain the user-authorized contract. |
| Phone + browser boundary | COMPATIBILITY explicitly marks native head-unit files, opt-in buffering and physical vehicle evidence as historical/upstream compatibility; no second product or head-unit acceptance requirement added. Existing Wi-Fi current device checks include browser reachability/display. |
| Mandatory buffered audio and SCO | BUFFERED_AUDIO now states enabled audio always offers mainBuffered, negotiated type 103 is required, and no product toggle exists. Corrected blanket no-AudioTrack claim: buffered music remains browser PCM; verified SCO capture/voice/navigation uses Android output on demand, navigation fixed 0.25 gain, media discarded, no browser/handset fallback or software AEC. |
| URL video and companion mirror audio | AIRPLAY corrects stale Media3 PCM/player-release statements, retains Video.js/proxy/direct-peer resource limits, AAC-ELD 44.1 kHz stereo companion audio and enabled HEVC mirror support. Standalone audio-only/DRM remain unsupported. RTP/NTP mirror audio mapping is implemented, with missing-anchor fallback and physical synchronization limits. |
| Defaults and Debug | COMPATIBILITY now distinguishes fresh CarPlay HEVC/60 fps defaults, shared mirror frame rate and URL source frame rate. AIRPLAY and BROWSER-MEDIA describe codec/current FPS and signed middle-90%/top-5% presentation-offset means, not decoder timing/jitter or end-to-end acoustic latency. |
| Historical evidence, legal originals | Dated BROWSER-MEDIA validation as 2026-10-13 evidence; preserved counts/hashes/versions/device results. Preserved legal license texts, UxPlay pinned provenance, Video.js vendor version and Speex compatibility attribution. |
| Links and boundaries | Scoped Markdown local file links checked; all resolve. No source/code/test/configuration edits, commits or pushes. No new runtime test claims. |

## Source evidence

- `CarPlayHostActivity.phoneBrowserAirPlayConfig`, `AirPlayInfoPlist`, `AirPlaySession`, `BufferedAudioStream`, `BrowserBufferedAudioPolicy`: mandatory offer and negotiated type 103; bounded relay/preload and pause/flush ownership. `CarPlayMediaEngine` retains buffered-transition retirement barriers, removes ownership before potentially blocking closes, and prevents retired sessions reclaiming output.
- `BrowserAudioMediaSink`, `AndroidBluetoothVoiceChannel`, `BluetoothVoicePolicy`, `BluetoothVoiceMixer`, `WebAudioHub`, `airplay-controls.js`: demand-based verified SCO duplex, worker retirement/actual release, call priority, route epochs/revisions, browser/Video.js mute, navigation attenuation and no fallback.
- `AirPlayCastPlayer`, `AirPlayVideoPlayback`, `AirPlayVideoProxy`, `BrowserLinkServer`: browser URL decoding, photo-only encoding, session/playback/resource ID admission, bounded HLS rewrite, Range/redirect/scheme controls and exact iPhone-peer HTTP(S) bypass. Direct access still needs usable CORS/certificates/network paths.
- `ReceiverMirrorAudioTiming` and `AirPlayMirrorAudio`: mapped RTP/NTP presentation timestamps reach PCM records. `ReceiverMirrorCodec` accepts hvc1/H265 only with HEVC enabled; receiver service follows saved HEVC and FPS settings. Browser hardware/codec support remains required.
- `ReceiverBonjour`, `ReceiverDiscoveryInterfaces`, `BonjourMdnsCleanup`, `CarPlayBonjour`: interface publication/discovery and cleanup ownership remain separate from media stop/restore. No doc promises Bonjour success proves media receipt or network reachability. Parent restores/validates additional remote-discovery fixes.
- `fps-window.js.formatDebugFps`: codec, currentFps, presentationOffset90 and presentationOffsetHigh5 fields. `BrowserPlaybackMode` contains CarPlay and mirror only; URL video owns its browser media clock.
- `BrowserMainSettingsMenu`, `BrowserConnectionDraft`, `CarPlayHostActivity.applyBrowserSettings`, English string resources, `ExistingWifiManager`, `AirPlayPersistence` and `AirPlayDisplaySettings`: settled valid edits, immediate host recovery, selected station/security/address rules, Choose iPhone/Reconnect CarPlay labels and fresh HEVC/60 fps defaults.

## Verification limits

No tests were rerun by this worker during recovery; parent owns all current verification. Earlier lost-environment test outcomes are not presented as new passes. Physical iPhone FCUP/HLS/direct resources, router security modes, mirror AAC-ELD/HEVC support, browser latency, Apple Music continuity and car HFP/SCO/AEC/background behavior remain unverified device checks. Historical native-car evidence does not validate current phone + browser playback.
