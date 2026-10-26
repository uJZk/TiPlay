# Original encoded audio over native WebRTC

`libdatachannel.so` transports source-encoded Opus access units. It does not contain an Opus encoder/decoder and never opens an Android microphone. The small `rtc_audio_jni.c` bridge uses only upstream's versioned C API: independent Opus tracks, packetization with original RTP sample timestamps, DTLS-SRTP, sender reports and bounded NACK history. Existing libWebRTC video and authenticated reliable DataChannels remain separate.

## Source and licensing

The native library contains unmodified libdatachannel v0.24.6, Mbed TLS 3.6.7, and the exact libdatachannel libjuice/usrsctp/libsrtp/plog submodule revisions. `sources.lock.json` records every source commit, download URL and archive SHA-256. No private libWebRTC C++ ABI, encoder substitution or payload-encryptor hook is used.

`licenses/` contains the corresponding upstream licenses. Android packages identical notices, `sources.lock.json`, `artifacts.json` and a source availability notice under `assets/licenses/rtc-audio/`; `build.py --verify` also checks these copies. libdatachannel and libjuice use MPL-2.0, usrsctp/libsrtp use BSD licenses, plog uses MIT, and Mbed TLS is used under its Apache-2.0 option. This directory's JNI bridge is TiPlay GPL-3.0-only code. Source archives are retrievable with the checked-in build script; retain their upstream license files and this source provenance when distributing binaries.

`include/rtc.h` and `include/version.h` are copied from the exact libdatachannel revision. `artifacts.json` records the packaged library checksums. NDK 28.2.13676358, CMake 3.31.6 and Ninja 1.13.0 built arm64-v8a, armeabi-v7a, x86 and x86_64; all ELF LOAD segments use 16 KiB alignment. Each transport statically links its dependencies and C++ runtime; the JNI module is C and preserves the project's `APP_STL := none` setting.

## Rebuild and verification

Use Python 3.12+, NDK 28.2.13676358, CMake and Ninja:

```sh
python3 scripts/rtc-audio/build.py --ndk "$ANDROID_NDK_HOME" --work-dir /tmp/tiplay-rtc-audio
python3 scripts/rtc-audio/build.py --verify
```

`--abi` may be repeated to rebuild selected architectures. The source archive checksums are always verified. `export-c-api.map` exports only the stable `rtc*` C surface and hides static C++/crypto symbols from the separate libWebRTC library in the same process. The work directory holds downloads/build intermediates; only stripped shared libraries and their manifest are written into this directory. Byte-identical output across different compiler versions or source paths is not claimed.

Mbed TLS's default configuration disables DTLS-SRTP. Both dependencies and libdatachannel are compiled consistently with `MBEDTLS_SSL_DTLS_SRTP`. Android builds retain a 16 KiB linker page-size setting. The host build groups static crypto archives to satisfy GNU ld's archive ordering; Android lld handles the same dependency graph directly.

For host/browser interoperability checks, build the same product JNI source with `--host`, after compiling the Kotlin classes with a targeted shared-module task:

```sh
python3 scripts/rtc-audio/build.py --host --work-dir /tmp/tiplay-rtc-audio
RTC_AUDIO_HOST_DIR=/tmp/tiplay-rtc-audio/build/host node tests/web-e2e/rtc-audio-native.mjs
```

`JAVA_HOME`, `GRADLE_USER_HOME`, `CHROMIUM`, and optionally `KOTLIN_STDLIB` identify the local test tools. The independent native transport oracle verifies two tracks with eighty original Opus packets each, matching every payload byte and source RTP timestamp through the product Kotlin/JNI sender and real DTLS-SRTP:

```sh
python3 scripts/rtc-audio/test_native.py --host-dir /tmp/tiplay-rtc-audio/build/host --kotlin-stdlib /path/to/kotlin-stdlib.jar
```

Host native verification is not Android device or vehicle acceptance. The Chromium interoperability check requires usable host ICE candidates; if the execution environment produces none for ordinary browser audio/video/DataChannel peers, the script reports that limitation explicitly rather than treating it as a codec or packetizer result.

## Boundaries

The receiver offers at most sixteen receive-only Opus audio sections. MID and payload type are parsed from SDP; numeric MID positions are not assumed. Offers and answers are bounded to 48 KiB. There are no STUN/TURN servers or proxy configuration, and remote candidates must be host candidates. Signaling travels over the already authenticated application control channel.

Each slot is bound to a single source mode/type/epoch per RTC generation. Slots are never recycled in the same generation. Exhaustion requests a replacement audio peer and retains the next source's bounded beginning until that peer is negotiated. Unsupported source codecs remain on the existing encoded-data path. Every bound slot waits for authenticated `audio-track-ready` with its exact MID, RTC generation and source mode/type/owner epoch before releasing RTP. The receiver sends it only after binding the Worklet owner and connecting the audio graph; local SCTP admission alone is not that barrier. EOS before readiness retains queued media. Before negotiation and remote graph readiness, source queues are bounded globally and per stream; after negotiation the native send queue remains bounded and does not block fallback decoding.

Native answer gathering waits at most five seconds and supports cancellation. Cleanup unregisters synchronized native callbacks, explicitly deletes track handles, and deletes the peer off the callback stack. No SDP, credentials or source payloads are logged by the native backend. Diagnostic source capture remains owned by the application record boundary.
