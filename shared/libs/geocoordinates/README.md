# geocoordinates Android

Vendored `geocoordinates-android.aar` from
[uJZk/geocoordinates-rs android-v0.14.2](https://github.com/uJZk/geocoordinates-rs/releases/tag/android-v0.14.2),
renamed `geocoordinates.aar` for the local Ivy artifact repository.

SHA-256: `ae679fb3c36325c3d328cd37ed5ac68fce39c9e7392b1671e6eb6e779caf710c`
(verified against the release's `SHA256SUMS`). Includes arm64-v8a,
armeabi-v7a, x86 and x86_64; Android API 23+, 16 KB page alignment.

Bindings require JNA 5.18.1 (Android AAR) and AndroidX annotations 1.9.1,
declared in shared/build.gradle. The AAR metadata requires core library desugaring
with desugar_jdk_libs 2.1.5, enabled in shared/common and their application consumers,
even though TiPlay's shipped apps already require API 28 or later.
No desktop JVM JAR is used.

Upstream: https://github.com/justin13888/geocoordinates-rs
Licensed under MIT OR Apache-2.0; both licenses are included here.
The conversion uses `gcj02ToWgs84Refined` and the library's `outOfChina` gate.
