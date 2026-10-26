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

## Zstandard diagnostic compression

[zstd-jni](https://github.com/luben/zstd-jni/tree/v1.5.7-4), pinned to 1.5.7-4,
provides Android AAR JNI binaries and the desktop JNI test runtime. Bindings use
BSD-2-Clause; the bundled [Zstandard](https://github.com/facebook/zstd) library is
dual BSD-3-Clause/GPL-2.0. TiPlay uses its BSD-3-Clause option. Upstream license
texts are packaged with the dependency and available in its source distribution.
JNI class names are preserved by the shared consumer rules.

## Runtime dependencies

- AndroidX and Jetpack Compose — Android Open Source Project; Apache License 2.0.
- Kotlin standard library — JetBrains; Apache License 2.0.
- Bouncy Castle 1.79 — The Legion of the Bouncy Castle Inc.; Bouncy Castle license (MIT-style).
- JmDNS 3.6.3 — JmDNS contributors; Apache License 2.0.
- WebRTC Android SDK `io.github.webrtc-sdk:android:150.7871.01` — Chromium M150
  DataChannels; [binary notices and exact provenance](#android-webrtc-datachannels)
  are retained in APK assets, including bundled component licenses.
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

The C/C++ WASM libraries also link WASI libc/musl, dlmalloc and LLVM
compiler-rt/libc++/libc++abi runtime code. Complete MIT, BSD, CC0 and
Apache-2.0-with-LLVM-exceptions notices, contributor credits and exact source
revisions are retained in
[linked-runtime notices](../site/play/vendor/wasm-runtime/README.md).
The freestanding audio core links no standard runtime archives.

- libsoxr (SoX Resampler Library): LGPL-2.1-or-later, used for native Android SCO resampling. Its complete source,
  licenses and pinned build provenance are under
  [native source inputs](../scripts/soxr/vendor/README.md); the source tree also includes
  the adapter and reproducible rebuild script. Android SCO playback/capture uses
  the same patched C engine directly through JNI; its generated native sources
  and licenses are in [native libsoxr](../shared/src/main/jni/soxr/README.md).
  No JS or WASM runtime is used by that Android library. Keep those materials with binary
  distributions so users can rebuild and replace the library.
- libav.js 6.10.9 / FFmpeg 9.0 staged audio builds: LGPL-2.1-or-later FFmpeg,
  with ISC libav.js components and upstream emfiberthreads support. Generated
  module headers retain complete component notices; corresponding source archives,
  checksums and reproducible portable/SIMD build configuration are in
  [vendor/libav](../site/play/vendor/libav/README.md).
- AAC-ELD software decoding uses the same FFmpeg/libav.js distribution above.
  The former FDK runtime, source bundle and build adapter were removed. Synthetic
  ELD fixtures were originally generated with FDK 2.0.3; their retained generator
  and source provenance are documented under
  [test fixtures](../tests/web/fixtures/aac-eld/README.md). FDK is not a runtime dependency.
- Video.js native controls, skin and media adapter helpers: Apache-2.0, self-hosted under
  `site/play/vendor/videojs/` with license texts and retained bundle notices.
- SoundTouch 2.4.0: LGPL-2.1-or-later, built from complete unmodified C++ source
  for SIMD WASM tempo processing. Portable builds remain available for reproduction
  and comparison. Sources, ABI adapter, license and provenance are under
  [vendor/soundtouch](../site/play/vendor/soundtouch/README.md).
- Mediabunny and the no-SIMD SoundTouchJS tempo backend: MPL-2.0. hls.js WebVTT and CEA-608 parsing helpers: Apache-2.0 with
  retained notices for their Mozilla-derived parser. The media bundle, full dependency
  licenses and source provenance are under `site/play/vendor/mediabunny/`; the source
  packages and their integrity are pinned in `scripts/videojs/package-lock.json`.
- Retained native SpeexDSP 1.2.1 compatibility code: BSD-style licence under
  `shared/src/main/jni/speexdsp/COPYING`. The browser ships no Speex/WASM AEC.

## Android WebRTC DataChannels

The pinned `io.github.webrtc-sdk:android:150.7871.01` AAR supplies Chromium M150
WebRTC/SCTP, from [webrtc-sdk/android](https://github.com/webrtc-sdk/android/tree/v150.7871.01).
TiPlay uses reliable ordered DataChannels; it does not create WebRTC native media
tracks. WebRTC uses BSD-3-Clause, the publisher repository uses MIT, and bundled
components retain their individual licenses. The unmodified publisher notices,
source URLs, AAR SHA-256 and ABI sizes are retained under
[licenses/webrtc](../shared/src/main/assets/licenses/webrtc/PROVENANCE.txt)
and included in APK assets with binary distributions.

## Browser SRP pairing

The benchmark-only LibTomMath 1.3.0 candidate uses the Unlicense. Its full source,
license and WASM adapter are retained under `tests/bench/srp/`; Chromium measurements
rejected it for production. Browser pairing retains native BigInt and WebCrypto.

The browser vendors `tssrp6a` 3.0.0 for browser SRP-6a arithmetic and WebCrypto
hashing. Its distributed LICENSE is MIT; the package metadata has an inconsistent
Apache-2.0 label, retained and disclosed in the vendor provenance. The identity/evidence
adapter matches the existing Bouncy Castle 1.79 padded proof convention. See
[vendored license](../site/play/vendor/tssrp6a/LICENSE) and
[provenance](../site/play/vendor/tssrp6a/README.md).

## Diagnostic summary QR codes

The independent ChatGPT audio-clock test page uses qrcode-generator 1.4.4 by
Kazuhiko Arase under the MIT license. The QR implementation is self-hosted; only
its module export wrapper is adapted. See the retained
[license](../site/play/chatgpt/vendor/QR-LICENSE.txt) and pinned
[source provenance](../site/play/chatgpt/vendor/provenance.json).

## NetEq live audio

The browser uses official libWebRTC NetEq and its Opus/L16 decoders. WebRTC is
BSD-3-Clause with the upstream PATENTS grant; libopus retains its BSD-style
license and Abseil is Apache-2.0. Exact source revisions, checksums, build adapter
and license texts are in [vendor/neteq](../site/play/vendor/neteq/README.md).
NetEq DSP/controller sources are unmodified; TiPlay supplies WASI services and
the C ABI. This is not the independent Rust NetEq-inspired implementation.
