# Changelog

Release availability and APKs: [TiPlay releases](https://github.com/uJZk/TiPlay/releases).
Current behavior is described in the [documentation](docs/README.md); older implementation
and delivery records remain in Git history.

## Unreleased

- Merge DiPlay through `c30d3f0df` while retaining Android phone + car browser scope and upstream ancestry.
- Apply valid settings immediately and reconnect when needed without closing settings. Support All (USB first), Wireless and USB, with independent CarPlay opt-out and continuous recovery while enabled.
- Make Start on boot optional, subject to Android background restrictions.
- Play buffered CarPlay audio in the browser; use the car's HFP/SCO route for requested Siri/call capture, or opt out to use iPhone-to-car Bluetooth audio. Align audio feedback/presentation with negotiated clocks and recover stalled microphone reads.
- Add ordinary AirPlay mirroring, audio-only playback, original JPEG/PNG photos and unprotected URL media, with device approval in the browser.
- Use Mediabunny/WebCodecs with Video.js 10 controls for URL MP4/HLS, seeking, audio tracks, tempo and captions. Keep dependencies self-hosted.
- Borrow and return the browser display for AirPlay while retaining CarPlay and its mixed-audio contract. Enforce SDR and codec compatibility limits.
- Apply phone address/port edits without migrating the browser. Retain pairing codes and require a manual browser endpoint update.

Real iPhone/vehicle compatibility, complete Bluetooth audio routing and sustained performance acceptance remain pending.

## Published history

TiPlay began as a fork of DiPlay for Android phone + car browser use. It has its own
application ID (`com.ujzk.tiplay`) and does not take over DiPlay settings or pairing records.
See [TiPlay releases](https://github.com/uJZk/TiPlay/releases) for published version notes,
artifacts and checksums.

Inherited DiPlay release history and contributor references are available at
[upstream releases](https://github.com/shihabal3amri/DiPlay/releases). They describe the
upstream product, including native head-unit features outside TiPlay's scope.
