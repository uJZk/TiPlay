# Changelog

Release availability and APKs: [TiPlay releases](https://github.com/uJZk/TiPlay/releases).
Current behavior is described in the [documentation](docs/README.md); older implementation
and delivery records remain in Git history.

## 0.2.15

- Replace the four-step first-use wizard with a single Permission checklist and remove the duplicate permission list from Advanced settings.
- Report missing or unknown Android car Bluetooth audio connections using live A2DP/HFP evidence and the device class, excluding the selected iPhone.
- Turn Debug logging into unredacted application traffic capture for iPhone, browser, USB and Android audio output. Export channel-tagged, millisecond-timestamped records in one TXT; hide the clipboard action.
- Force AirPlay URL media through Android only while Debug mode is enabled; switch active playback routes when the policy changes and retain normal direct eligibility when disabled.

Verification: 1,971 shared, 1,556 common and 6 home unit tests; 229 browser tests; Android lint and debug builds; MP4 browser playback and live Debug route switching. Physical phone/vehicle, raw capture completeness and Bluetooth routing acceptance remain pending.

## 0.2.14

- Replace the informational first-use guide with connection, sound, startup and missing-permission setup, including current Android grant checks and system-settings links.
- Unify page, section, button and description spacing; adapt network choices for narrow windows and large text.
- Consolidate automatic hints below status and keep explicit operation results at their controls. Preserve independent blockers, distinguish unknown Wi-Fi facts and discard stale failures or asynchronous results.
- Remove the residual manual reconnect action; valid settings continue to save and apply automatically.

Verification: 1,967 shared, 1,552 common and 6 home unit tests; 229 browser tests; Android lint and debug builds. Physical phone/vehicle, system authorization and VPN acceptance remain pending.

## 0.2.14-beta.4

- Add a first-use guide on Android, with completion tracking and a Main settings entry to review it.
- Wait for an authenticated browser to report its viewport and decoder capabilities before starting or retrying an iPhone connection. Show **Waiting for browser connection** until ready.
- Select HEVC automatically from browser support, remove the manual codec switch and respect decoder canvas limits when offering Fit.
- Clear readiness on browser disconnect/replacement, expire stale heartbeats and retain already active sessions during short browser interruptions.
- Make the AirPlay resource-replacement test wait for the replacement loader to acquire its request before responding.

Source verification: 1,967 shared, 1,532 common and 6 home unit tests; 229 browser tests; Android CI lint/debug builds; public-source scan; 9 release-draft tests. Physical phone/vehicle acceptance remains pending.

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
