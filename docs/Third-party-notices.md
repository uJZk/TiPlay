# Credits and license notices

## TiPlay

TiPlay is a modified version of [DiPlay by shihabal3amri](https://github.com/shihabal3amri/DiPlay), licensed under GNU GPL version 3. It was renamed from DiPlay to TiPlay in October 2026 and is maintained at https://github.com/uJZk/TiPlay. Historical DiPlay releases retain their original name in Git and upstream releases. Tesla is a trademark of Tesla, Inc. TiPlay is not affiliated with or endorsed by Tesla, Inc.

## Receiver

TiPlay's ordinary AirPlay receiver follows the legacy pairing, AES-CTR mirroring and HTTP video
protocol in [FDH2/UxPlay](https://github.com/FDH2/UxPlay), pinned at
`ec203121355220dd90278a369eeabb0b8ba4f14a` (2026-10-11). The native `playfair/`
transport-key module is copied from that revision with its GPL-3.0 license retained.
Juho Vähä-Herttua's FairPlay transport reply tables are LGPL-2.1-or-later;
the license and provenance are in `shared/src/main/jni/airplay/`.
The Android control, discovery and browser adapters are TiPlay additions.
This is not the UxPlay desktop application or its GStreamer renderer, and it does not
provide FairPlay Streaming licenses for protected video.

DiPlay, and therefore TiPlay, is a modified version of [xcertplay by shilapi](https://github.com/shilapi/xcertplay). The upstream receiver is licensed under GNU GPL version 3; the full text is in [LICENSE](../LICENSE). Original project attribution is available at the linked upstream repository and in Git history.

Upstream credits [LIVI](https://github.com/f-io/LIVI) and [Showcase](https://github.com/amineross/showcase) for protocol research. Existing source comments and attribution are preserved.

## Receiver protocol review

The 2026-10-14 protocol review also references
[jqssun/android-airplay-server](https://github.com/jqssun/android-airplay-server)
commit `c8defdd70d7e6a04f4f1b71d353653682d594106` and UxPlay commit `462153392f2e30937424922039ff9f0cda5e7b1a`. Receiver behavior was compared;
the Android application/player was not copied into TiPlay.

## Home and settings UI

`common/src/main/java/com/shilapi/xcertplay/DiPlayActivity.kt` adapts the palette, visual arrangement and interface copy of the [DiAuto project](https://github.com/shihabal3amri/DiAuto). DiAuto's source is licensed under AGPL version 3. The UI file is marked AGPL-3.0-only; its license text is included in `docs/licenses/DiAuto-AGPL-3.0.txt`.

## CarPlay icon

The unmodified icon was obtained from Apple's developer site at:

https://developer.apple.com/assets/elements/icons/carplay/carplay-96x96_2x.png

CarPlay and the CarPlay icon are Apple Inc. marks/assets. This asset is not covered by the project's open-source code license. Its use here does not imply Apple approval or certification.

## Runtime dependencies

- AndroidX and Jetpack Compose — Android Open Source Project; Apache License 2.0.
- Kotlin standard library — JetBrains; Apache License 2.0.
- Bouncy Castle 1.79 — The Legion of the Bouncy Castle Inc.; Bouncy Castle license (MIT-style).
- JmDNS 3.6.3 — JmDNS contributors; Apache License 2.0.
- geocoordinates-rs 0.14.2 — geocoordinates-rs contributors; MIT OR Apache-2.0. The Android AAR is from [uJZk/geocoordinates-rs](https://github.com/uJZk/geocoordinates-rs/releases/tag/android-v0.14.2), with upstream [justin13888/geocoordinates-rs](https://github.com/justin13888/geocoordinates-rs). Licenses, checksum and artifact provenance are in [shared/libs/geocoordinates](../shared/libs/geocoordinates/README.md).
- JNA 5.18.1 (Android AAR) — JNA contributors; LGPL-2.1-or-later OR Apache-2.0; used under Apache-2.0 for the geocoordinates UniFFI bindings. [Project](https://github.com/java-native-access/jna/tree/5.18.1), [license selection](licenses/dependencies/JNA-LICENSE.txt) and [Apache-2.0 text](licenses/dependencies/JNA-APACHE-2.0.txt).
- SLF4J — QOS.ch; MIT license.
- Shizuku API 13.1.5 (`dev.rikka.shizuku:api`, `:provider` and their `aidl` and `shared` modules) — Copyright (c) 2021 RikkaW; MIT license, text in `docs/licenses/dependencies/Shizuku-API-LICENSE.txt`. Used only by the Shizuku hotspot address method (`docs/Hotspot-address.md`).

Gradle dependency declarations and version catalog accompany the source. License files available in the resolved artifacts are included under `docs/licenses/dependencies/`.

## Native call echo cancellation

DiPlay vendors a subset of [SpeexDSP 1.2.1](https://github.com/xiph/speexdsp/tree/SpeexDSP-1.2.1) from Xiph.org Foundation and its contributors, including the acoustic echo canceller, preprocessor and FFT/filterbank support. It is compiled into `libspeex_echo.so` for the optional experimental **Call echo cancellation** feature.

SpeexDSP uses a BSD-style three-clause license. The full copyright notices, redistribution conditions and disclaimer are retained in [the vendored COPYING file](../shared/src/main/jni/speexdsp/COPYING). Component source headers retain their additional notices, including KISS FFT's Mark Borgerding attribution. The [vendoring notes](../shared/src/main/jni/speexdsp/README.md) identify the source version and build configuration.

## Software Opus microphone encoder

DiPlay vendors [Concentus](https://github.com/lostromb/concentus), Logan Stromberg's pure-Java port of the Opus reference library from Xiph.Org Foundation, Skype Limited, Microsoft Corporation and other contributors. It encodes the CarPlay microphone on head units whose Android has no MediaCodec Opus encoder.

Concentus uses the Opus BSD-style license. The full copyright notices, redistribution conditions and disclaimer are retained in [the vendored LICENSE file](../shared/src/main/java/org/concentus/LICENSE). The [vendoring notes](../shared/src/main/java/org/concentus/README.md) identify the source commit.

## Experimental authentication data

The public preview APK includes an accessory certificate/key pair recovered from public Carlinkit C2Air Allwinner V821 firmware during the owner's local investigation. These data are not newly generated Apple-issued credentials for DiPlay or TiPlay and are not relicensed as project source code. They are bundled in the preview APK to reproduce the offline experiment; continued acceptance and suitability for general distribution are unresolved. The source archive does not contain the private key, and the separate Android APK-signing key is never distributed.

## Download website

The static site layout, CSS and generator adapt DiAuto (AGPL-3.0). The AGPL license text is included with the source.

## BYD HUD maneuver icons

Required Notice: Copyright AndyShaman (https://github.com/AndyShaman/BYDMate)

The maneuver PNGs under `shared/src/main/assets/byd-hud-icons` were imported from BYDMate. Its PolyForm Noncommercial 1.0.0 terms and required notice are included alongside the assets. These files are separate from the project code license; upstream describes them as donor assets and their original provenance is not independently established. The validated DiLink5.1 windshield path uses factory turn codes rather than these images.

## Browser media

- Video.js native controls, skin and media adapter helpers: Apache-2.0, self-hosted under
  `site/play/vendor/videojs/` with license texts and retained bundle notices.
- Mediabunny and SoundTouchJS: MPL-2.0. hls.js WebVTT and CEA-608 parsing helpers: Apache-2.0 with
  retained notices for their Mozilla-derived parser. The media bundle, full dependency
  licenses and source provenance are under `site/play/vendor/mediabunny/`; the source
  packages and their integrity are pinned in `scripts/videojs/package-lock.json`.
- Retained native SpeexDSP 1.2.1 compatibility code: BSD-style licence under
  `shared/src/main/jni/speexdsp/COPYING`. The browser ships no Speex/WASM AEC.
