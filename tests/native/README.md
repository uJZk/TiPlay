# Android native RTP video probe

`NativeVideoProbe.java` exercises the published `io.github.webrtc-sdk:android:150.7871.01`
AAR and the compiled product `BrowserRtcVideoTrack` through two native
PeerConnections on an Android device or emulator. It captures actual native
encoder-queue and suspension messages, bridge counters, sender RTP statistics,
original-byte SHA-256 and receiver access-unit counts. The receiving test decoder
counts decoder input access units and emits tiny test buffers; it does **not**
decode H.264 pictures. This checks native transport and frame admission, not
browser rendering or physical vehicle performance.

Use JDK 25, an Android SDK with platform/build tools, the project's populated
Gradle dependency cache, Python 3 and an ADB device running API 28 or later.
`ffmpeg` with libx264 is required only to generate a synthetic fixture when no
`--fixture` is provided. Fixture generation is offline; the probe forwards its
original encoded bytes without runtime video encoding.

Build the current product classes before the probe:

```sh
./gradlew :shared:compileDebugKotlin
python3 tests/native/rtc-video-probe.py build --work-dir /tmp/tiplay-native-probe
```

The script reads `ANDROID_HOME`, `JAVA_HOME` and `GRADLE_USER_HOME`. Override
`--android-sdk`, `--java-home`, `--gradle-home`, `--product-classes`,
`--webrtc-aar` or `--kotlin-stdlib` when needed. Its default ABI is `x86_64`;
select `--abi arm64-v8a` for an ARM64 device. No APK installation is needed:
the DEX probe runs under `app_process` with a system context and a prepared
main Looper. Files stay under the chosen host work directory and
`/data/local/tmp/tiplay-native-probe` on the selected device.

Run one scenario at a time. Optional `--serial emulator-5554` selects a device;
`--adb-port 5038` supports a separate ADB server. The four controls distinguish
native input admission from bitrate bootstrap:

```sh
python3 tests/native/rtc-video-probe.py run --work-dir /tmp/tiplay-native-probe --mode paced --start-bitrate 0
python3 tests/native/rtc-video-probe.py run --work-dir /tmp/tiplay-native-probe --mode serial --start-bitrate 0
python3 tests/native/rtc-video-probe.py run --work-dir /tmp/tiplay-native-probe --mode paced --start-bitrate 24000000
python3 tests/native/rtc-video-probe.py run --work-dir /tmp/tiplay-native-probe --mode serial --start-bitrate 24000000
```

`paced` offers at the fixture's 60 fps cadence without waiting for encoder input
completion. `serial` waits for the product's native input completion barrier.
A positive startup bitrate also raises the sender encoding and peer ceiling to
64 Mbps. The minimum stays unset and the estimator is set only once. Zero
retains the SDK's startup and stream defaults. `--encoder-delay 40` can inject
a controlled delay before the real Java encoder callback; default zero leaves
the product callback timing unchanged. `--frames` selects the measured phase
length. `burst` is an additional stress control, not the normal producer policy.

Each run warms the real source/encoder, drains preroll at the receiver, then
reports measured counter differences. Compare `outputFrames`,
`releasedUnencodedFrames`, `sourceAdaptationDrops`, `nativeBlocked`, native
suspension messages and sender packet-send delay. Default native logging is
INFO and `nativeBlocked` is `null`, because its per-frame message uses VERBOSE.
Add `--native-verbose` to capture that reason. Verbose JNI logging can itself
increase the load of a software emulator; retain the chosen severity in results.
For a continuous repaired
phase, require all offered access units to leave the encoder, matching offered
and encoder-output SHA-256, no native input losses, and matching inbound-RTP `framesReceived` count. Add `--expect-continuous` to
enforce these assertions. The separate counting-decoder invocation count may be lower
when a software emulator misses receiver decode deadlines. A counting decoder
cannot establish picture correctness.
A software emulator's CPU throughput, packet scheduling or frame rate cannot
establish phone or vehicle performance.

The work directory retains `build.json`, per-scenario JSON results, combined
console logs and private native logs. The build record identifies the exact AAR,
product class bundle, DEX probe and fixture hashes. These generated files and
synthetic H.264 input belong outside Git.
