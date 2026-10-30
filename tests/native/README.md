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
retains the SDK's adaptive startup and stream defaults; zero alone does not
enable source-rate transport. `--encoder-delay 40` can inject
a controlled delay before the real Java encoder callback; default zero leaves
the product callback timing unchanged. `--frames` selects the measured phase
length. `burst` is an additional stress control, not the normal producer policy.

The adaptive comparison's startup default is 32 Mbps. A 16 Mbps minimum constrains the estimate
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

## Source-rate request and observation

Use `--source-rate` only with the custom AAR built by
[`scripts/webrtc/build.py`](../../scripts/webrtc/build.py). It requests
`TiPlay-SourceRateVideo/Enabled/` on the sending video factory only. The receiver
retains the probe's existing trials. This request sets no peer startup/minimum/maximum bitrate
or sender maximum, including after source replacements. A positive
`--start-bitrate` is rejected; omitting it selects zero for this mode. The existing
adaptive modes remain available for comparison. Distinct result filenames prevent
source-rate runs from overwriting those controls.

Select an Android device or emulator whose ABI matches the custom AAR. For example,
an ARM64-only artifact cannot run in an x86_64 Android emulator:

```sh
python3 tests/native/rtc-video-probe.py build --work-dir /tmp/tiplay-source-rate \
  --webrtc-aar /path/to/tiplay-source-rate.aar --abi arm64-v8a \
  --fixture /path/to/high-profile.h264
python3 tests/native/rtc-video-probe.py run --work-dir /tmp/tiplay-source-rate \
  --source-rate --mode serial --frames 180 --expect-continuous
python3 tests/native/rtc-video-probe.py run --work-dir /tmp/tiplay-source-rate \
  --source-rate --mode bundle --frames 2400 --expect-continuous --expect-queue-epoch
```

`--expect-queue-epoch` requires the integrated custom sender API. It checks that
the sender has an epoch before its first frame and that each replacement retires
the previous sender and receives a distinct epoch while the control channel works.
It does not establish picture quality, audible output, or recovery after congestion.

The build record includes a matching adjacent `.provenance.json` when supplied by
the custom AAR builder and rejects a mismatched AAR hash. Results retain the actual
sender/receiver field-trial strings. These record selected inputs; they do not by
themselves prove that a native binary implements the trial. Results therefore use
`requestedRateControlMode` and always report `nativeRateControlVerified: false`.
A stock AAR can silently ignore the unknown trial. Even when `--expect-continuous`
passes, this script establishes the measured encoder-byte and RTP-count continuity
only. Native activation requires separate evidence from a matching custom binary
and an activation check or controlled feedback comparison; provenance alone is
insufficient.

For a custom AAR containing the native diagnostic schema, add
`--expect-native-activation` to a source-rate run. This first requires an adjacent
provenance record matching the selected AAR, pinned source and current native patch
hash. It then correlates actual native branch events with each measured sender's
SSRC and a nonzero, process-local transport ID. Missing events, zero IDs, or
events with a mismatched transport or SSRC cannot satisfy the check. This is
SSRC correlation, not a verified PeerConnection-to-transport binding:
`peerBindingVerified` remains false. A complete event chain from another peer
using the same SSRC cannot be distinguished by this schema. Adaptive comparison
runs with continuous assertions reject source-rate
branch events as a negative control.

`stream_attached` is emitted on every native sender construction. Codec setup
can retire and recreate a sender with the same transport and SSRC before its
first frame. The structural check collapses only fully identical attachment
observations and reports their count; the raw event list remains intact.
Different transports or limiter choices for a measured SSRC remain ambiguous
and fail. `attachmentInstanceIdentityVerified` remains false because these
identifiers do not distinguish successive sender objects.
The same boundary applies to `encoder_gate`: each recreated encoder has a fresh
once-per-state mask. Identical gate events retain their raw count but count as
one structural state. Conflicting allow results or a different transport for the
measured SSRC fail; distinct consistent states remain separate observations.
`gateInstanceIdentityVerified` remains false, and repeated allow observations
cannot establish the order or continuity of a network down/up cycle.

The bounded `TIPLAY_RTC_SOURCE_RATE` JSON events record a skipped controller,
stream attachment with its actual RTX limiter choice, first source-rate video
dispatch, and the encoder's actual binary gate checks. They contain no memory or
network addresses, keys, names or media bytes. SSRC and transport IDs can link events within the probe process
and session; keep these events and derived identifiers in the private native
probe artifacts, not the browser's readable diagnostic log. Dispatch does not prove a socket
write succeeded; RTP counters remain separate evidence. Gate checks log each
network/stream state at most once per encoder, so repeated allow events cannot
establish a down/up recovery cycle. `nativeStructuralActivation.verified` covers
these observed implementation branches only. `nativeRateControlVerified` remains
false: the fixture does not establish every feedback condition or all remaining
rate-control behavior.

Statistics use the active `RtpSender` or `RtpReceiver` selector, rather than the
last RTP entry in a peer-wide report. Sender samples retain the RTC statistics
timestamp, monotonic sample time, SSRC, source input bytes/frames and original
RTP byte counters. `rateWindows` computes deltas only within one source phase and
active RTP stream. It reports source input rate, RTP payload rate and, when the
counter exists, payload rate excluding retransmissions. Required statistics,
identity or timestamps missing during measurement cause failure; only startup
warmup may wait for an RTP record that has not appeared yet. Optional counters
remain missing. Per-generation and final baselines must retain the same stats ID
and SSRC and show the expected frame count plus advancing byte/packet counters.
Final-stage rate coverage is checked separately from earlier generations.
Source Annex B framing and RTP packetization overhead differ; these
rates are not expected to be byte-for-byte identical. The final drain has its own
sample and must not be treated as continued source input. Neither an absent BWE
estimate nor a matching average rate proves that every control path is disabled.

`videoNegotiations` records each generation's actual transceiver MID after both
peers apply the descriptions, requiring the sender and receiver MIDs to agree.
The hosted High proof validates each offer/answer pair against that recorded MID,
including its direction, identical H264 payload number, exact SPS profile and
packetization mode. An old video line cannot satisfy a replacement's check.
A zero-port `bundle-only` offer must name an accepted BUNDLE transport; a
zero-port answer is rejected. The answer must keep the target's offered BUNDLE
membership and tag, and cannot move members from another group. Bundle scenarios
require an offered and answered group for every recorded target MID.
Run `verify_high_proof_sdp.py --fixture <fixture>
--result <scenario.json>` before another scenario replaces its SDP files.

The hosted source-rate positive scenarios retain the 10 Mbps High fixture.
Branch-negative controls use a separately generated 200 kbps High fixture in
separate work directories; their SPS, dimensions, 180-frame cadence and paired
SDP checks remain identical. `--max-average-bitrate 300000` rejects accidental
use of the high-rate positive fixture for these controls. Both negative controls
still require exact frame counts and original encoder-byte hashes and must emit
no source-rate native events. Their smaller input isolates branch activation;
it does not compare adaptive and source-rate throughput.

Offline fixture checks need no Android runtime:

```sh
python3 tests/native/test_video_probe.py
python3 tests/native/check_video_probe.py --work-dir /tmp/tiplay-probe-api-check \
  --webrtc-aar /path/to/selected.aar --android-sdk "$ANDROID_HOME" \
  --java-home "$JAVA_HOME" --kotlin-stdlib /path/to/kotlin-stdlib.jar
```

Run local compilation through Wlsc. The second check compiles against the selected
AAR's real public Java APIs but uses isolated product signature stubs. Its JVM
checks cover echo ownership and source bookkeeping only; it does not compile the
product Kotlin or verify Android/JNI, AAR rate control or transmitted video.

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

The probe warms each source and sends 60 measured original access units before
each of three video bridge replacements, checking RTP reception before retiring
that source. It stops every retired video transceiver while keeping the DataChannels.
It verifies that all three
channels are open at both peers and exchanges control echoes after initial
negotiation, every replacement, each 300-frame interval and the final drain.
An independent control heartbeat runs throughout video generation checks,
replacements and the final measured phase. Replies are matched by unique message
identity so heartbeat and stage checks cannot consume each other's responses.
Each generation retains source and encoder-output SHA-256 values. Reception is
still count-only, explicitly reported as `receiverContentVerified: false`; matching
encoder bytes do not establish receiver payload integrity or picture correctness.
Results retain completion counts and control samples grouped by source/replacement
phase. Each measured/replacement phase needs a completed control observation.
The echo wait uses the existing five-second timeout. This proves sampled,
timeout-level availability, not continuous low latency; results explicitly retain
`controlLowLatencyVerified: false`. A fast replacement may have boundary checks
but no heartbeat within the replacement itself, and phase counts expose that gap.
The channels
named `audio` and `video` do not carry real audio or compressed-video payloads;
this probe cannot establish independent audio playback under video load.
The measured original-AU phase uses the same input-completion barrier and
selected adaptive or source-rate request as the ordinary serial mode. The result retains BUNDLE
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
this feedback timeout is fixed. The adaptive `bundle` comparison must preserve
all original output bytes, RTP reception and control continuity with adaptive
feedback enabled. Source-rate transport is a separate explicit mode of the same scenario.

Both modes use the counting test decoder. They establish native RTP/admission and
DataChannel continuity, not picture correctness, acoustic output, high-rate
capacity or physical vehicle smoothness.
