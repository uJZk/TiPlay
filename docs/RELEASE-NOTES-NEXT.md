# TiPlay next release notes

TiPlay is a fork of [DiPlay](https://github.com/shihabal3amri/DiPlay). Changes through DiPlay 0.2.13 are documented in [DiPlay 0.2.13 release notes](RELEASE-NOTES-0.2.13.md). Measured checks are in [VALIDATION.md](VALIDATION.md). Add future unreleased changes here.

## Rename

- The project is now called TiPlay, with the package `com.ujzk.tiplay`. It installs alongside DiPlay and does not reuse DiPlay's settings or pairing records.

## Browser receiver profile

- TiPlay applies the phone + browser profile when opening the app or CarPlay screen. There is no run-mode switch. The car browser shows CarPlay; BYD HUD/dashboard, ADB and wheel-key controls stay hidden.
- CarPlay's car button shows the packaged TiPlay logo and the label "TiPlay" while the saved name is still "BYD". Custom icons and names are kept. Applies at the next CarPlay connection.
- The profile selects car Bluetooth sound, browser light/dark appearance, no Android location reporting and split-screen areas. Existing sessions keep their negotiated configuration. Advanced settings retains frame-rate and HEVC choices, saved for the next connection; **Return and apply** reconnects a running session.

## Sound through car Bluetooth

- The browser profile selects the Carlinkit-style Bluetooth audio route: `/info` omits `audioFormats` while retaining audio latencies, feature bits and Bluetooth IDs. TiPlay declines audio streams the iPhone still opens and starts no audio output, microphone, echo canceller or audio focus. The complete iPhone-to-car Bluetooth audio flow still needs vehicle validation.
- The earlier audio-route choice and its alternative variant remain in source, but the current interface hides audio-routing controls and selects the standard route on entry.
- Diagnostic reports show the saved route, the audio declaration and each audio stream the iPhone requests.

## Connection reliability

- USBMUX accepts the bounded protocol-1 diagnostic frame with the four-byte trailer captured in [DiPlay issue #100](https://github.com/shihabal3amri/DiPlay/issues/100), including fragmented reads. Recovery still requires a validated preceding reply and a validated next frame; unknown data is rejected. This repairs that captured framing failure, without claiming the entire reported USB connection succeeds.
- The retained local renderer uses SurfaceView when the attached app window lacks hardware acceleration or smooth-video output is selected; other hardware-accelerated windows use TextureView. The phone + browser profile sends video to the browser without this local renderer. Letterboxing, view-area cropping and touch mapping share the same viewport. Picture color adjustments are unavailable on SurfaceView and the controls explain this; saved adjustments remain available for TextureView output.
- Bluetooth checks both RFCOMM streams before starting iAP2 and reports whether reading fails before any bytes arrive. Stream failures preserve their cause and close the socket once. Draining a full receive queue wakes the reader so it can continue.
- USB bulk-IN makes one 16 KiB queue attempt after an explicitly rejected larger request, remembering the smaller size only when it succeeds. Exceptions and timed-out requests are not retried this way. This compatibility path needs an affected-device retest; Android 9 normally supports the original larger sizes.

These changes retain Android 9 / API 28 as the APK minimum. Device acceptance and remaining failure families are tracked in [connection reliability validation](CONNECTION_RELIABILITY.md).

## Settings UX

- The browser product has native Android **Main settings** and **Advanced settings** pages. Main settings owns the iPhone chooser, CarPlay connection mode, browser pairing/link and network configuration. The editable hotspot endpoint supports an address and port; changing it also requires updating the Android address on the browser page.
- **CarPlay connection mode → Wireless / USB** follows the connection draft and explicit **Save and reconnect**. Older separate launch-mode choices migrate to this saved mode. **Connect automatically after boot** saves immediately and requests a connection after boot, independently of the retained connect-on-open preference; Android/OEM background restrictions can prevent startup.
- Network configuration exposes **Android hotspot** and **Existing Wi-Fi**. A saved Wi-Fi Direct choice maps to manual hotspot in the browser UI. Android controls hotspot activation and radio settings. Root/Shizuku users can import hotspot credentials; the bounded, detachable probe preserves concurrent typing.
- Advanced settings provides frame rate (30–60 fps; fresh-install default 60), HEVC (default on without a saved preference), driving side, diagnostic export and permissions, including battery optimization. Video/control changes save immediately for the next connection. **Return and apply** reconnects a running session; ordinary Back does not. Manufacturer, model, OEM label, MFi certificate and authentication controls are hidden.
- Use the supplied TiPlay logo for Android and CarPlay, including adaptive, round and monochrome Android icons. CarPlay reads the packaged PNG without runtime drawing or reencoding; saved custom icons and labels remain.
