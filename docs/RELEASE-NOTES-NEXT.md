# TiPlay next release notes

TiPlay is a fork of [DiPlay](https://github.com/shihabal3amri/DiPlay). Changes through DiPlay 0.2.13 are documented in [DiPlay 0.2.13 release notes](RELEASE-NOTES-0.2.13.md). Measured checks are in [VALIDATION.md](VALIDATION.md). Add future unreleased changes here.

## Rename

- The project is now called TiPlay, with the package `com.ujzk.tiplay`. It installs alongside DiPlay and does not reuse DiPlay's settings or pairing records.

## Browser receiver profile

- TiPlay applies the phone + browser profile when opening the app or CarPlay screen. There is no run-mode switch. The car browser shows CarPlay; BYD HUD/dashboard, ADB and wheel-key controls stay hidden.
- CarPlay's car button shows a neutral car icon instead of the BYD logo and the label "Tesla" while the saved name is still "BYD". Custom icons and names are kept. Applies at the next CarPlay connection.
- The profile selects car Bluetooth sound, browser light/dark appearance, no Android location reporting and split-screen areas. Existing sessions keep their negotiated configuration. The CarPlay settings menu retains frame-rate and experimental HEVC choices with **Save and reconnect**.

## Sound through car Bluetooth

- The browser profile selects the Carlinkit-style Bluetooth audio route: `/info` omits `audioFormats` while retaining audio latencies, feature bits and Bluetooth IDs. TiPlay declines audio streams the iPhone still opens and starts no audio output, microphone, echo canceller or audio focus. The complete iPhone-to-car Bluetooth audio flow still needs vehicle validation.
- The earlier audio-route choice and its alternative variant remain in source, but the current interface hides audio-routing controls and selects the standard route on entry.
- Diagnostic reports show the saved route, the audio declaration and each audio stream the iPhone requests.

## Connection reliability

- USBMUX accepts the bounded protocol-1 diagnostic frame with the four-byte trailer captured in [DiPlay issue #100](https://github.com/shihabal3amri/DiPlay/issues/100), including fragmented reads. Recovery still requires a validated preceding reply and a validated next frame; unknown data is rejected. This repairs that captured framing failure, without claiming the entire reported USB connection succeeds.
- Video uses SurfaceView when the attached app window lacks hardware acceleration. Hardware-accelerated windows retain TextureView. Letterboxing, view-area cropping and touch mapping share the same viewport. Picture color adjustments are unavailable on SurfaceView and the controls explain this; saved adjustments remain available for TextureView output.
- Bluetooth checks both RFCOMM streams before starting iAP2 and reports whether reading fails before any bytes arrive. Stream failures preserve their cause and close the socket once. Draining a full receive queue wakes the reader so it can continue.
- USB bulk-IN makes one 16 KiB queue attempt after an explicitly rejected larger request, remembering the smaller size only when it succeeds. Exceptions and timed-out requests are not retried this way. This compatibility path needs an affected-device retest; Android 9 normally supports the original larger sizes.

These changes retain Android 9 / API 28 as the APK minimum. Device acceptance and remaining failure families are tracked in [connection reliability validation](CONNECTION_RELIABILITY.md).
