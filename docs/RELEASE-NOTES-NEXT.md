# TiPlay next release notes

TiPlay is a fork of [DiPlay](https://github.com/shihabal3amri/DiPlay). The source includes DiPlay 0.2.19 and main fixes through `c30d3f0df`; see [upstream sync](UPSTREAM-SYNC-2026-10-14.md). Measured checks are in [VALIDATION.md](VALIDATION.md). Add future unreleased changes here.

## Browser player

- Migrate MP4/HLS playback to Video.js 10.1.0 and the official hls.js adapter. Retain Canvas rendering, iPhone playback state and commands, Bluetooth mute and captions; ship all assets and translations locally for offline opening.

## Source sync and audio reliability

- Fully merge upstream DiPlay source through `c30d3f0df`, preserving the merge history. Adopt USB framing, startup/reconnect, Bluetooth compatibility, address recovery, diagnostic crash records and inherited compatibility code; keep phone + browser product gates.
- Use separate RTP and decode rates for feedback and browser audio presentation. Retain immediate browser microphone startup, bound SCO empty-read/read-error recovery to three restarts, and use the upstream Opus encoder fallback.
- Preserve saved browser audio choices while separating their enum key from the new upstream Boolean setting. Add Japanese browser settings translations.
- Beta.3/versionCode 35 packages this integration as a signed prerelease draft; published beta.2 remains unchanged. Actual iPhone/vehicle acceptance remains required.

## Rename

- The project is now called TiPlay, with the package `com.ujzk.tiplay`. It installs alongside DiPlay and does not reuse DiPlay's settings or pairing records.

## Browser receiver profile

- TiPlay applies the phone + browser profile when opening the app or CarPlay screen. There is no run-mode switch. The car browser shows CarPlay; BYD HUD/dashboard, ADB and wheel-key controls stay hidden.
- CarPlay's car button shows the packaged TiPlay logo and the label "TiPlay" while the saved name is still "BYD". Custom icons and names are kept. Applies at the next CarPlay connection.
- The profile selects browser audio by default, browser light/dark appearance, no Android location reporting and split-screen areas. Valid advanced frame-rate, HEVC and driving-side changes save and apply immediately; TiPlay reconnects when new negotiation is needed and keeps the settings page open.

## Browser and car Bluetooth sound

- CarPlay music uses mandatory buffered audio in the browser. Recording demand switches Android capture and call/Siri/navigation playback to the car Bluetooth telephone channel, with navigation at fixed 25% gain; other audio is discarded until recording ends and browser playback resumes. Android microphone permission and a paired car telephone profile are required. No browser/handset microphone fallback or browser/software echo canceller is used. Vehicle validation remains pending.
- **Advanced settings → Disable CarPlay audio** leaves all sound and calls on the iPhone's Bluetooth connection to the car. In this mode `/info` omits `audioFormats` while retaining latencies, feature bits and Bluetooth IDs; TiPlay declines audio streams and opens no microphone. Select the iPhone for car audio/calls. This complete route also needs vehicle validation.
- The earlier alternative Bluetooth variant remains in source for upstream compatibility; the current interface exposes the audio opt-out.
- Diagnostic reports show the saved route, the audio declaration and each audio stream the iPhone requests.

## Connection reliability

- USBMUX accepts the bounded protocol-1 diagnostic frame with the four-byte trailer captured in [DiPlay issue #100](https://github.com/shihabal3amri/DiPlay/issues/100), including fragmented reads. Recovery still requires a validated preceding reply and a validated next frame; unknown data is rejected. This repairs that captured framing failure, without claiming the entire reported USB connection succeeds.
- The retained local renderer uses SurfaceView when the attached app window lacks hardware acceleration or smooth-video output is selected; other hardware-accelerated windows use TextureView. The phone + browser profile sends video to the browser without this local renderer. Letterboxing, view-area cropping and touch mapping share the same viewport. Picture color adjustments are unavailable on SurfaceView and the controls explain this; saved adjustments remain available for TextureView output.
- Bluetooth checks both RFCOMM streams before starting iAP2 and reports whether reading fails before any bytes arrive. Stream failures preserve their cause and close the socket once. Draining a full receive queue wakes the reader so it can continue.
- USB bulk-IN makes one 16 KiB queue attempt after an explicitly rejected larger request, remembering the smaller size only when it succeeds. Exceptions and timed-out requests are not retried this way. This compatibility path needs an affected-device retest; Android 9 normally supports the original larger sizes.

These changes retain Android 9 / API 28 as the APK minimum. Device acceptance and remaining failure families are tracked in [connection reliability validation](CONNECTION_RELIABILITY.md).

## Settings UX

- The browser product has native Android **Main settings** and **Advanced settings** pages. Main settings owns the iPhone chooser, CarPlay connection mode, browser pairing/link and network configuration. The editable hotspot endpoint supports an address and port; address/port edits apply immediately on Android without notifying or migrating the browser. Tap **Disconnect**, change **Android address** and tap **Connect** on the browser page, or open the updated pairing link. Pairing codes remain; bookmarks are not updated automatically.
- **CarPlay connection mode → All (USB first) / Wireless / USB** saves and applies immediately. All mode tries USB first and falls back to wireless; **Reconnect CarPlay** remains available for manual retry. Valid network edits apply automatically, while invalid/incomplete fields remain drafts. Enabled CarPlay continuously recovers and valid idle edits may resume preparation. **Start on boot** saves immediately and launches TiPlay after boot; **Disable CarPlay** independently blocks startup and retries. Android/OEM background restrictions can prevent startup.
- Network configuration exposes **Android hotspot** and **Existing Wi-Fi**. A saved Wi-Fi Direct choice maps to manual hotspot in the browser UI. Android controls hotspot activation and radio settings. Root mode exposes hotspot credential import; Shizuku reading remains in source, while current Main settings shows manual fields and Android hotspot settings in that mode; the bounded, detachable probe preserves concurrent typing.
- Advanced settings provides frame rate (30–60 fps; fresh-install default 60), HEVC (default on without a saved preference), driving side, diagnostic export and permissions, including battery optimization. Video/control changes save and apply immediately, automatically reconnecting when needed without leaving the settings page. Manufacturer, model, OEM label, MFi certificate and authentication controls are hidden.
- Use the supplied TiPlay logo for Android and CarPlay, including adaptive, round and monochrome Android icons. CarPlay reads the packaged PNG without runtime drawing or reencoding; saved custom icons and labels remain.

## Browser media and AirPlay

- Main settings and Advanced settings use compact native Android controls and system dialogs. HEVC, AirPlay and VPN titles intentionally omit experimental suffixes. Experimental AirPlay starts by default; **Advanced settings → Disable AirPlay** stops the receiver immediately. Mirroring or non-DRM URL video pauses the CarPlay picture and restores a still-connected session when casting ends.
- AAC-ELD mirroring companion audio (44.1 kHz stereo, requiring an Android AAC-ELD decoder), URL-video soundtracks and enabled HEVC mirroring are supported in source. Standalone audio-only AirPlay, ALAC/other mirror audio formats and DRM remain unsupported. Browser/device compatibility and physical iPhone/car acceptance remain pending.
- AirPlay URL video uses Video.js with authenticated Android resource proxying and direct iPhone resources. URL-video timing controls are removed. The current Debug overlay shows codec, current FPS and two signed presentation-offset averages over five seconds (the central 90% and highest 5%). These offsets depend on clock synchronization and are not measured end-to-end latency. Earlier URL-video timing records remain historical.
