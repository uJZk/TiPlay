# Upstream maintenance

TiPlay is a GPL-3.0 derivative of [DiPlay by shihabal3amri](https://github.com/shihabal3amri/DiPlay), formerly xcertplay. Its supported product is Android phone plus car browser. Preserve original copyright, license and provenance notices; see [third-party notices](Third-party-notices.md).

## Tracked components

| Upstream | Role and baseline |
| --- | --- |
| [DiPlay](https://github.com/shihabal3amri/DiPlay) | CarPlay/shared Android source; full merge ancestry through `1b1ac5f2` (0.2.20 plus main fixes). |
| [Video.js](https://github.com/videojs/video.js) | Browser controls/media adapter; [pinned inputs and update procedure](../site/play/vendor/videojs/README.md). |
| [libmedia](https://github.com/zhaohappy/libmedia) | AVPlayer URL playback engine: IO, demuxing, decoding, buffering, synchronization and Canvas rendering. [Pinned inputs, local resources and licenses](../site/play/vendor/libmedia/README.md) accompany the vendored player. |
| [libsoxr](https://github.com/chirlu/soxr) | Native Android SCO resampling; [native source inputs](../scripts/soxr/vendor/README.md) and [Android C/JNI subset](../shared/src/main/jni/soxr/README.md). |
| [UxPlay](https://github.com/FDH2/UxPlay) | Ordinary AirPlay protocol reference and native transport-key modules; `ec203121355220dd90278a369eeabb0b8ba4f14a`, [native provenance](../shared/src/main/jni/airplay/README.md). |
| [WebRTC Android SDK](https://github.com/webrtc-sdk/android) | Pinned M150 source and TiPlay source-rate AAR for local transports; component notices and [exact provenance](Third-party-notices.md#android-webrtc-datachannels) accompany the APK. |

Review security, protocol, playback and lifecycle changes since each baseline. Update adopted code, pins, provenance, licenses and validation together. Source ancestry and the runtime identity selected for an APK are separate; see [Build](Build.md#runtime-identity).

## WebRTC build maintenance

Minimize changes to dependency source and reuse maintained upstream configuration,
build scripts and GitHub Actions where available. Keep the current original-codec,
source-rate video behavior while reducing the build maintenance surface. Replacing
the AAR must not silently restore adaptive video rate control or introduce encoding.

The Android distribution repository publishes AARs; its native producer is
[webrtc-sdk/webrtc-build](https://github.com/webrtc-sdk/webrtc-build).
TiPlay's build wrapper uses its fixed M150-compatible revision
`06e3410d8f67d08202e26f55225705596b60778e`: the Android environment setup,
common GN arguments, Android warning policy and three upstream compatibility
patches. Only the source-rate patch is applied on top. The old
combined `publisher-compat.patch` remains an input fingerprint for the committed
AAR; it is not the compatibility patch source for new builds. Upstream sets
`treat_warnings_as_errors=false` for Android, so its unchanged Java compiles
without a local generic-type patch. The original and legacy-patched factory
produce identical Java class bytes; this does not establish an identical AAR.
The upstream policy also leaves production native compiler warnings nonfatal;
focused host tests retain their existing strict configuration.

The upstream workflow uses a dedicated runner and has no `workflow_call` entry.
TiPlay therefore keeps a small Android-only workflow on `ubuntu-24.04`, reusing
the upstream setup and WebRTC's `build_aar.py`. Preserve the existing bounded
checkout, build concurrency, focused native tests and artifact provenance; the
upstream full build also produces static libraries that TiPlay does not need.
See the [AAR build entry](../shared/libs/webrtc-source-rate/README.md).

Every remaining native patch needs a concrete product requirement or reproduced
fault. Prefer existing APIs and configuration before adding another native API.
Verify a rebuilt AAR and its actual APK packaging before replacing the committed
artifact. Source configuration checks do not establish a successful native build
or physical phone/browser playback.

The local vendor modules must resolve exclusively from their pinned Ivy source;
checking an unused local AAR is insufficient. Release packaging also verifies
the final APK against the pinned native artifact. Future native producers retain
line information before stripping and index matching symbol files by ABI, Build
ID and digest. Symbol-only durable archives remain private draft Releases, so
they do not replace driver APK releases in the public download list. Historical
missing symbols cannot be reconstructed by applying a new build's addresses.
See [Robustness](Robustness.md) for the recovery and verification boundaries.

## Preserve merge compatibility

- Updates flow from DiPlay into TiPlay only: no upstream patches/PRs; disable upstream pushes and tag fetching.
- Prefer new files for TiPlay features and small hooks in inherited files. Do not rename, move, reformat or delete inherited source/identifiers. Remove unused TiPlay-owned code.
- Keep packages/classes/resources, preference and browser-storage keys, log/thread names, intent actions, `DIPLAY_AUTH_ASSETS_DIR` and `rootProject.name`. This includes `com.shilapi.xcertplay`, `com.shihab.diplay.action.EMBED_MAP` and `com.shihab.diplay.DISCONNECT`. Application ID remains `com.ujzk.tiplay` (`.hudtest` for debug).
- User-facing names use TiPlay; retain DiPlay in credits, historical records and source comments. Keep numbered upstream issue/PR/commit links on their original repository. Current project links use `https://github.com/uJZk/TiPlay` and `https://ujzk.github.io/TiPlay/`.
- Preserve phone/browser session, media, permission and connection contracts. Gate retained native behavior and hide its settings. The page is hosted over HTTPS; do not restore APK page assets or a local `/play/` route.
- Keep TiPlay strings separate and translated in every locale. Browser HEVC, AirPlay and VPN titles intentionally omit experimental suffixes; retain inherited locale text unless explicitly changed.

## Audio fixes with similar symptoms

Upstream [clock drift #788](https://github.com/shihabal3amri/DiPlay/pull/788)
adjusts Android `AudioTrack` playback rate from a smoothed buffer level; its
[stale backlog #814](https://github.com/shihabal3amri/DiPlay/pull/814) bounds
sustained compressed-music congestion. Retain those inherited implementations,
but do not substitute them for browser audio timing. In phone + browser mode,
`TeslaBrowserLink.tee` selects `BrowserAudioMediaSink`; browser output uses
48 kHz AudioWorklet sample counts and official NetEq, with libav.js conversion
for supported fallback formats. Live video uses independent native WebRTC RTP
timing into Canvas; it does not follow browser audio timestamps. The Android controller cannot control that
output device. The browser implementation costs more CPU and needs sustained
vehicle verification; similar symptoms alone do not establish interchangeable fixes.

## Integration review

The current review covers merge `f497f7dd` (`16c8c32f` plus upstream
`1b1ac5f2`, common base `c30d3f0d`) and TiPlay's following browser adaptations.
The merge changes 118 files: 42 production Kotlin files, eight resource files,
63 test files, two build files, two inherited documents and one maintenance tool.
The complete upstream tip is an ancestor of TiPlay; no incoming upstream commit
was omitted. This proves source inclusion, not that every upstream feature runs
in the browser product. The incoming range changes no `site/play/` files.
The merge's remerge diff was also reviewed: production conflicts were confined
to `CarPlayHostActivity`, `DiPlayActivity` and `CarPlayController`; their TiPlay
mode, settings-lifecycle and recovery hooks survive alongside upstream additions.

| Area | Effective phone/browser behavior and decision |
| --- | --- |
| Music drift and sustained stale backlog (#788, #814) | Android music renderer is bypassed. Keep browser NetEq/libav conversion, bounded queues, independent live timing and buffered-stream backpressure; do not run both controllers or copy the native packet-drop policy into ordered music. |
| Queue policy for music versus calls | Upstream shares a 192-packet hard queue bound, but media rebuffer/clock trim and the 1.5-second sustained-lag guard are music-specific. TiPlay's SCO queue now bounds both summed packet duration and RTP span to 160 ms, using actual PCM/AAC/Opus duration; an independent 256-packet safety cap bounds pathological tiny packets. Drop oldest complete compressed access units, or retain a bounded PCM tail. Preserve original arrival/decode leases; reject expired input/output and PCM at render time using anchored presentation +125 ms, or a 160 ms arrival fallback. Include AudioTrack queued frames and resampler lookahead in deadline accounting. RTP/decoded gaps, trimming and underrun use 5 ms in-place blends. These are software bounds, not an acoustic latency guarantee. |
| Shared browser/native resampling | SCO playback and microphone capture now build the browser's patched float32 vr32/HQ C engine directly with NDK/JNI. Each stream keeps its own filter/phase state and never flushes on temporary shortage. Remove the old Kotlin FIR/linear converter. This retains the native DSP and continuity/recovery principles; current browser playback uses NetEq/libav instead. SCO hardware timing remains separate. |
| Audio thread scheduling (#740) | Shared UDP receive priority already reaches TiPlay. Extend the same guarded audio-priority request to TiPlay's SCO microphone, speaker and speech decoder; leave buffered network prefetch at its normal priority. |
| Navigation gain (#752) | Native adjustable -20…0 dB gain has no browser setting or output connection. TiPlay already applies a fixed 0.25 amplitude to navigation on SCO. A user-adjustable browser gain is a useful enhancement, not an adopted feature; see Todo. |
| Audio focus resume (#804), earpiece fallback (#797), microphone source (#770) | These control native Android playback/capture. Browser music and TiPlay's verified HFP/SCO route have separate owners; do not enable loudspeaker fallback or native phone-audio mode for them. |
| USB framing and device visibility (#744, #793, #830) | `UsbMuxFrameBuffer`, USB host enumeration and controller diagnostics are shared and active for supported transports. Preserve these upstream fixes without a parallel parser. |
| Startup permissions and cause reporting (#795, #824) | Shared classification remains active. Browser checklist/status notices and continuous retry policy remain TiPlay-owned; the native finite retry budget is gated. |
| P2P 5 GHz selection and scan pause (#740, #768) | Inherited P2P capability fix is present. TiPlay's current connection draft selects manual hotspot or existing Wi-Fi, so it does not use P2P; scan suspension remains gated to native mode. |
| Automatic hotspot control and off-report override (#748, #789) | Phone tethering belongs to Android's system controls. Imported native preferences must not start reflection/ADB tethering or override the phone's current AP state; gate both controller and legacy launch paths. |
| Wheel remapping/double Siri, masks and temporary system bars (#813, #823, #811, #818) | Native service has an early phone-mode bypass; new foreground media remapping and native display hooks also need explicit mode guards. Rectangular browser negotiation remains separate. |
| Ambient idle behavior and decoded music lighting | Media callbacks bypass native audio, but constructing the retained Android sink previously still opened ambient control. Create that lifecycle sink without an Android audio context in phone mode. |
| Crash diagnostics and safe own-screen starts (#827) | Keep the shared improvements; they complement process-scoped TiPlay capture and do not replace it. Native settings helpers and maintenance tools stay outside browser navigation. |
| AirPlay borrowing and URL resources | Admission lease checks, authenticated resource routing and deferred recovery remain TiPlay-owned. URL buffering, decoding and scheduling now belong to AVPlayer; the incoming Android range added no competing browser engine. |

Four boundary gaps were corrected: native sink initialization, automatic hotspot
control, foreground media remapping and native display hooks. Sink/hotspot startup
exposure predates this merge; newer upstream ambient-idle/tethering behavior made
that exposure more consequential. Foreground media remapping and the native
display hooks arrived in this merge. These are conditional problems with restored
or retained settings, not evidence that they caused reported vehicle stutter.
Existing source tests and focused phone-mode regression cases cover the guards;
physical scheduling and interoperability acceptance remain open. Keep future
reviews on this stable record and distinguish source ancestry, reachable code,
equivalent TiPlay behavior and useful features still awaiting adaptation.

## DiPlay merge procedure

Configure the one-way remote once:

```sh
git remote add upstream https://github.com/shihabal3amri/DiPlay.git
git remote set-url --push upstream DISABLED
git config remote.upstream.tagOpt --no-tags
```

At releases or short regular intervals, start from a clean worktree, fetch origin/upstream, review the changelog and changes since the common base, then create an integration branch from `origin/main` and merge `upstream/main` with `--no-ff`.

Keep upstream improvements and reapply TiPlay hooks. Inspect configuration, preference/resource collisions, teardown, product gates, branding and locales even without conflicts. Preserve TiPlay's root documentation, application identity and hosted browser delivery. Record the adopted version and validation in [Changelog](../CHANGELOG.md).

Retain the merge commit and put product adaptations in separate commits. Do not squash, cherry-pick or rebase the upstream merge. After validation, fast-forward `main` to the integration branch and push only to origin.

## Browser and receiver updates

For Video.js and bundled media dependencies, select explicit releases and verify npm integrity using [pinned build inputs](../scripts/videojs/package.json) and lockfile. Rebuild self-hosted bundles, translations and license notices. Keep runtime dependencies pinned without a CDN. Check MP4/HLS, seeks, buffering, subtitles, authenticated resources, iPhone controls and offline assets.

For UxPlay, port relevant protocol fixes into Android adapters, preserving native licenses and reply-table provenance. Exclude desktop/GStreamer rendering. Verify pairing, transport keys, discovery, mirroring/audio, HTTP video and CarPlay borrow/return isolation. Transport-key exchange does not supply FairPlay Streaming licenses or DRM support.

Run [required source checks](Build.md#check-the-source-build), applicable [browser/device checks](Testing.md), and `python3 scripts/test_airplay_native.py` for native AirPlay changes. Regenerate changed site outputs. Record actual iPhone/car evidence and untested behavior separately.
