# TiPlay documentation

Start with the [English README](../README.md) or [简体中文](../README.zh-CN.md).

## Using TiPlay

- [Install and connect](Install.md): APK, permissions, first connection and sound.
- [Connection setup](Connection-setup.md): Android hotspot, Existing Wi-Fi and USB.
- [Hotspot address](Hotspot-address.md): Tesla reachability and Standard/Root/Shizuku/VPN methods.
- [Browser](Browser.md): pairing, controls, picture, audio and browser restrictions.
- [AirPlay](AirPlay.md): casting, device approval and supported media.
- [Diagnostics](Diagnostics.md): exporting reports and interpreting the performance monitor.
- [Privacy](Privacy.md): stored data, permissions and local-network protection.

## Development

- [Build](Build.md) and [Windows containers](Wlsc.md): toolchain, runtime identity, signing and updates.
- [Audio evidence](Audio-evidence.md): Debug trigger/waveform capture, extraction and CPU attribution limits.
- [Audio tempo](Audio-tempo.md): live audio buffering, decoder priority, AVPlayer URL playback ownership and verification limits.
- [Browser WASM](Browser-wasm.md): execution boundaries, module ownership, complete upstream libraries and performance verification.
- [Settings](Settings.md): drafts, immediate apply and connection recovery.
- [Geolocation](geolocation.md): browser coordinate evidence, Android conversion and detection and iPhone forwarding.
- [Testing](Testing.md) and [Todo](Todo.md): automated checks and pending physical acceptance.
- [CarPlay DataChannel contract](CarPlay-DataChannel.md): reliable WebRTC transport, SRP-authenticated SDP binding, framing/credit and independent timing.
- [WebRTC roadmap](WebRTC-roadmap.md): formal root deployment, four playback profiles, preserved experimental playback/source-cadence evidence and remaining physical acceptance.
- [Upstream](Upstream.md): dependencies, provenance and merge policy.
- [Third-party notices](Third-party-notices.md): credits, licenses and experimental authentication data.
- [README presentation](Readme-presentation.md): bilingual feature list, screenshots, source notes and verification boundaries.
- [Contributor instructions](../AGENTS.md), [changes](../CHANGELOG.md) and [security](../SECURITY.md).

Keep one stable page per topic. Filenames start with a capital, use hyphens, and omit dates;
conventional entry files and legal/vendor names are exceptions. Only the [latest sweep](docs-sweep-2026-10-15/README.md)
is retained. Earlier implementation notes, validation logs and release diaries remain in Git;
[upstream releases](https://github.com/shihabal3amri/DiPlay/releases) describe the separate upstream product.
