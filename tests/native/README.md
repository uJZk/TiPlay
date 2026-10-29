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
python3 tests/native/rtc-video-probe.py run --work-dir /tmp/tiplay-native-probe --mode paced --start-bitrate 32000000
python3 tests/native/rtc-video-probe.py run --work-dir /tmp/tiplay-native-probe --mode serial --start-bitrate 32000000
```

`paced` offers at the fixture's 60 fps cadence without waiting for encoder input
completion. `serial` waits for the product's native input completion barrier.
A positive startup bitrate also sets the sender encoding and peer ceiling to
128 Mbps and the peer minimum to 16 Mbps. The estimator is set only once. Zero
retains the SDK's startup and stream defaults. `--encoder-delay 40` can inject
a controlled delay before the real Java encoder callback; default zero leaves
the product callback timing unchanged. `--frames` selects the measured phase
length. `burst` is an additional stress control, not the normal producer policy.

The current startup default is 32 Mbps. A 16 Mbps minimum constrains the estimate
even when real network feedback indicates less capacity; it can increase queueing
and loss on a constrained link and does not establish vehicle capacity. The published
beta.27 native measurements used 24 Mbps with the rate limits from that revision;
use that revision to reproduce its configuration. Passing `--start-bitrate 24000000`
here changes only the startup prior within the current rate limits. Positive startup
values outside those limits are rejected, as is a failed peer bitrate configuration.

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

## Sparse High-profile startup

`--mode bootstrap --expect-bootstrap` covers a source that sends its initial
High-profile IDR and three dependent frames, then becomes static. Both factories
and the receiver offer advertise Baseline before High. The sender applies the
production High + RTX codec preferences before creating its answer, and the
bridge reads that actual answer. The test does not rewrite SDP or relax source
profile admission. It delegates the production encoder selector through the
native AAR factory.

A separate source callback models the existing 500 ms keyframe-request rate
limit, primed by the setup request. Accepted requests asynchronously return the
fixture's original High IDR bytes. The existing one-second `pollFailure()`
heartbeat drives recovery while the source is otherwise quiet. Results retain
initial/final codec diagnostics, native factory allocations, request attempt and
acceptance times, source/recovery events, original-byte checks and RTP reception.

Use a genuine High-profile fixture; the default ultrafast continuous fixture can
use Baseline despite the encoder's maximum permitted profile. For example:

```sh
ffmpeg -f lavfi -i color=c=red:size=1568x1080:rate=60 -frames:v 180 -an \
  -c:v libx264 -preset veryfast -profile:v high -level:v 4.2 -bf 0 \
  -b:v 500k -minrate 500k -maxrate 500k -bufsize 500k \
  -x264-params 'aud=1:repeat-headers=1:keyint=60:min-keyint=60:scenecut=0:nal-hrd=cbr:filler=1' \
  -f h264 /tmp/tiplay-high.h264
python3 tests/native/rtc-video-probe.py build --work-dir /tmp/tiplay-bootstrap \
  --fixture /tmp/tiplay-high.h264
python3 tests/native/rtc-video-probe.py run --work-dir /tmp/tiplay-bootstrap \
  --mode bootstrap --start-bitrate 32000000 --expect-bootstrap
```

The assertion requires matching source, negotiated and current High formats,
a ready encoder, accepted retries, original access-unit bytes and actual RTP
reception. With the pinned M150 AAR, the old implementation can remain on its
initial Baseline encoder after the first IDR is released: all initial requests
fall inside the 500 ms gate, no more source frames arrive, and selection times
out. Keep request timing when comparing revisions; if slow emulation permits an
initial request after 500 ms, that run has not reproduced the same starvation.
The receiver still uses the counting test decoder, so this does not validate
H.264 picture decoding or physical startup timing.

## Sustained BUNDLE feedback

`--mode bundle` creates the control/video/audio DataChannels, sets a private
data-only pending local offer, then adds the receive-only video transceiver and
updates that pending offer. Only the final data + video offer is applied to the
sender. This makes the application section BUNDLE's canonical first section
without editing SDP, publishing a separate handshake or rolling back. It retains
the production's one-active-video admission and High-profile selection.

The probe then replaces the video bridge three times, stopping every retired
video transceiver while keeping the DataChannels. It verifies that all three
channels are open at both peers and exchanges control echoes after initial
negotiation, every replacement, each 300-frame interval and the final drain.
The measured original-AU phase uses the same input-completion barrier and
one-time startup bitrate as the ordinary serial mode. The result retains BUNDLE
tag/application MID, negotiated transport-wide feedback, channel/control checks,
native counters, packet-send delay and original-byte hashes. SDP files remain in
the private work directory.

Use the High-profile fixture from the preceding example and an explicit
**2,400 frames** for at least 40 seconds at the nominal 60 fps cadence:

```sh
python3 tests/native/rtc-video-probe.py run --work-dir /tmp/tiplay-bootstrap \
  --mode bundle --frames 2400 --start-bitrate 32000000 --expect-continuous
python3 tests/native/rtc-video-probe.py run --work-dir /tmp/tiplay-bootstrap \
  --mode bundle-video-anchor --frames 2400 --start-bitrate 32000000
```

`bundle-video-anchor` is the historical failure control: it starts with video as
the BUNDLE tag and retains that first video transceiver as inactive during
replacement. On M150 the sustained control can lose usable transport feedback,
back off by 0.8 per second to 30 kbps, then suspend native inputs despite zero RTP
packet loss. It is not expected to satisfy continuous assertions. The ordinary
180-frame default remains unchanged; a three-second run cannot establish that
this feedback timeout is fixed. `bundle` must preserve all original output bytes,
RTP reception and control continuity with real adaptive feedback enabled.

Both modes use the counting test decoder. They establish native RTP/admission and
DataChannel continuity, not picture correctness, acoustic output, high-rate
capacity or physical vehicle smoothness.
