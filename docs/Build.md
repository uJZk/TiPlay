# Build TiPlay

Build the `:mobile` Android phone receiver for the car browser. Other applications remain for upstream compatibility. Run commands from the repository root; Windows uses `gradlew.bat`. See [Windows containers](Wlsc.md) for that environment.

## Toolchain and source checks

Use the Gradle wrapper and the JDK, Node and Android SDK/NDK packages in the [Android workflow](../.github/workflows/android.yml). Set `JAVA_HOME` and `ANDROID_HOME`, or put `sdk.dir=/absolute/sdk/path` in untracked `local.properties`. Android Studio must use the same Gradle JDK and the `mobile` run configuration.

The Android/browser product version comes from `tiplayVersionName` and
`tiplayVersionCode` in [gradle.properties](../gradle.properties). Published artifacts
and their provenance are available on the [releases page](https://github.com/uJZk/TiPlay/releases).
Run `python3 scripts/build_site.py` after a version change to regenerate `app-version.js`.
The browser diagnostic/cache revision is independent of the product version and is
defined in [browser-diagnostics.js](../site/play/browser-diagnostics.js) and
[sw.js](../site/play/sw.js). Live video uses original-codec WebRTC RTP and negotiated audio.
Earlier SoundTouch/libsoxr browser implementations are historical; current playback
boundaries are in [Audio tempo](Audio-tempo.md). Software checks are in
[Testing](Testing.md#webrtc-integrated-acceptance).
The deployment replaces `https://ujzk.github.io/TiPlay/` and deletes the
independent `/webrtc/` subsite without an alias or redirect; the APK defaults to the
root. Use the release and workflow links above for current provenance. Every
language's download entry opens the GitHub Releases index without a version-specific
URL. Debug APK metadata retains its diagnostic suffix.

### Browser v86 release

Historical v86 added held SoundTouch catch-up and passed 919 browser tests plus
cache/public-tree/deployment checks. Android CI was skipped at the user's request
for this web-only release; the beta.17/code59 APK retained its published bytes.
The [Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/40159166211)
succeeded for `d9af73b082afc8db094c11ecdae9475d53501828`.

### Beta.17 verification

The [frozen verification record](https://github.com/uJZk/TiPlay/blob/81adbf35d564649113cf3d9ae61f139c358e73fc/docs/Build.md#beta17-verification)
retains beta.17's 914 browser tests, capture replay, historical DSP measurements,
runner Android/signing checks and evidence limits. Its retired PD/SoundTouch
implementation does not describe the current audio path in [Audio tempo](Audio-tempo.md).

### Check the source build

Run the checks defined in the [Android workflow](../.github/workflows/android.yml): browser tests, public-tree scan, release-draft tests, Android unit tests, lint and debug builds. Retained `home`/`maphost` checks protect upstream compatibility. Optional Chromium checks are in [Testing](Testing.md).

CI limits concurrent JVMs and periodically retires test workers using the workflow's
Gradle arguments and [CI memory policy](../gradle/ci-memory.init.gradle). Robolectric,
Mockito and native graphics can retain SDK/resource state beyond the Java heap;
heap limits alone do not prevent exhaustion or long stalls in a full run. Module
test settings may override the policy's default heap. Keep this isolation in CI
rather than changing application behavior or omitting tests.
The same CI init script directs Robolectric's separate SDK downloader to
`https://repo.maven.apache.org/maven2`; Gradle's `mavenCentral()` does not configure
that downloader.

Build the phone app with:

```sh
./gradlew :mobile:assembleDebug
```

The output is `mobile/build/outputs/apk/debug/mobile-debug.apk`. Debug uses `com.ujzk.tiplay.hudtest`; release uses `com.ujzk.tiplay`. Ordinary source builds contain no accessory identity and cannot establish standalone CarPlay without one. See [mobile configuration](../mobile/build.gradle.kts) for SDK and version requirements.

Run source-only checks before supplying authentication assets. Avoid simultaneous Gradle builds in one output directory. `git archive` exports committed source only; use a separate copy that includes intended working-tree edits when testing uncommitted work. Run the public-tree checker in the originating Git checkout, against the same source input.

### Managed cloud certificate trust

Gradle's automatically provisioned JDK can have a different certificate store from
system Java and `curl`. Behind an HTTPS session proxy, plugin resolution may report
"plugin not found" when the underlying failure is `SSLHandshakeException` /
`PKIX path building failed`. Confirm the plugin URL with both clients before
changing dependency versions.

Use the environment's trusted CA store and proxy configuration for the provisioned
JDK and forked test JVMs. On this Linux environment the system Java trust store is
`/etc/ssl/certs/java/cacerts`; passing
`-Djavax.net.ssl.trustStore=/etc/ssl/certs/java/cacerts` through command-local
`JAVA_TOOL_OPTIONS`, together with the session's HTTP/HTTPS proxy properties,
allows Gradle and Robolectric downloads while preserving TLS verification. Keep
these paths, SDK locations, proxy settings and caches outside committed build
configuration. Set `ANDROID_HOME` to the locally installed SDK; the required
packages are defined by the Android workflow.

## Browser WASM build

The historical browser **v89** introduced official NetEq, libav.js decoder/resampler Workers and the
fixed-memory audio core for realtime audio. WebCodecs audio and libsoxr are removed
from that realtime revision. Current URL playback uses libmedia AVPlayer; its dependency build is separate from the WASI helper.
AudioContext and NetEq both use 48 kHz. [Audio tempo](Audio-tempo.md) records the
final decoder order, memory bounds, lifecycle and remaining device acceptance.
The v89 rollout skipped CI and APK compilation; those release records remain
historical. The current beta release follows the source and signed-artifact checks.
See [execution boundaries](Browser-wasm.md), including measured cases that retain
native browser APIs or JavaScript.

URL casting uses the separately pinned libmedia AVPlayer build. Its local modules,
audio WASM, same-origin Worklets, compatibility patches and integrity checks are
documented in [vendor/libmedia](../site/play/vendor/libmedia/README.md). Rebuild it
with `npm ci && npm run build` from `scripts/avplayer/`; the Video.js controls build
remains separate under `scripts/videojs/`. Regenerate the offline manifest with
`python3 scripts/update_browser_cache.py` after changing browser resources.

The shipped binaries build from complete corresponding sources with WASI SDK 34
(Clang 23.1.0), Binaryen 132, CMake 4.1.2 and Ninja 1.13.0. Git, Python 3.12+, `patch`
and the pinned tools are required. On Linux x86_64:

```sh
python3 -m pip install cmake==4.1.2 ninja==1.13.0
python3 scripts/soxr/prepare-toolchain.py work/wasm-toolchain
python3 scripts/build_wasm.py --check \
  --sdk work/wasm-toolchain/wasi-sdk-34.0-x86_64-linux
```

The downloader verifies toolchain archive hashes before extraction. `--check`
builds into a temporary directory and compares every WASI artifact built by this helper, without
changing production files. Omit it to replace the artifacts intentionally;
individual build entry points are in `scripts/soxr/`,
`scripts/neteq/` and `scripts/build_audio_core.py`. CI reproduces all modules
independently of Android compilation.
NetEq fetches WebRTC from its official Git repository with fixed commit and tree
IDs, checks object integrity and extracts a local archive. Gitiles-generated tar
timestamps vary between downloads; they cannot provide a stable compressed-byte
pin. Opus and Abseil retain their release-archive SHA-256 checks. See
[NetEq provenance](../site/play/vendor/neteq/README.md).

The libav.js portable/SIMD pair uses **Emscripten 4.0.7**, separately
from the WASI helper above. Activate that SDK and Node 22, then run
`python3 scripts/libav/build.py --output /tmp/libav-check`. The pinned source
archive, full corresponding sources and artifact hashes are documented in
[vendor/libav](../site/play/vendor/libav/README.md). Both generated loaders and
both WASM binaries were independently rebuilt byte-for-byte. The
[performance report](../tests/bench/libav/README.md) records gains, regressions
and the corrected AAC-ELD parameter diagnosis; the historical URL audio fallback used these builds. Current URL playback uses AVPlayer resources; the component benchmark is not release provenance.

After changing runtime assets, run `python3 scripts/update_browser_cache.py` and
bump `PAGE_VERSION`/the Service Worker revision together. CI checks the generated
manifest, which precaches runtime files rather than source archives. GitHub Pages
serves `.wasm` as `application/wasm`; loaders also accept a correct module served
as an ordinary binary. Production CSP requires `'wasm-unsafe-eval'`; JavaScript
evaluation remains disabled. Run the browser suite, site assembly/public-tree
checks and the production-CSP media-clock/AAC worker checks before delivery.

## Runtime identity

Keep runtime inputs outside Git in this layout:

```text
runtime-assets/offline-mfi/identity.pk8
runtime-assets/offline-mfi/certificate.p7b
```

Supply only these two nonempty files:

```sh
DIPLAY_AUTH_ASSETS_DIR=/absolute/path/to/runtime-assets ./gradlew :mobile:assembleStandaloneDebug
```

This produces the same debug APK path. The standalone task rejects missing/empty authentication files; APK asset checks reject unexpected credential containers. Tests create synthetic identities and do not require a private identity in source.

For the experimental upstream identity, select the APK and its published SHA-256 together from [DiPlay releases](https://github.com/shihabal3amri/DiPlay/releases), verify the hash, and extract only `assets/offline-mfi/identity.pk8` and `assets/offline-mfi/certificate.p7b` into the layout above. The [release workflow](../.github/workflows/android-release.yml) contains the current pinned APK, hash and extraction procedure. Selecting its runtime assets does not merge that version's source.

Runtime identity and Android signing are separate. Never place a signing keystore in APK assets. The supplied runtime identity is extractable from the distributed APK; the Android signing private key must stay private. Read the [experimental authentication notice](Third-party-notices.md#experimental-authentication-data) before distributing it.

## Signed release

After the intended commit passes the Android workflow, run **Actions → Build signed TiPlay release APK**. The [release workflow](../.github/workflows/android-release.yml) is authoritative for signing, pinned runtime identity, APK verification and artifact creation. It requires these repository secrets:

- `ANDROID_KEYSTORE_BASE64`: complete `.p12` or `.jks` keystore, Base64 encoded.
- `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

It verifies the pinned upstream APK and packages its two runtime files, runs release lint/build, then creates `TiPlay-<version>.apk`, the matching committed source ZIP and `SHA256SUMS.txt`. Its Actions artifact lasts 14 days. The separate upload job creates or updates a prerelease draft; it does not publish a release. Signing/runtime temporary inputs are deleted after the build. This workflow does not replace the Android unit and browser checks.
Preflight runs `scripts/rtc-audio/build.py --verify`; all four audio prebuilts
and packaged notices must match the recorded source-patch identity before signing.

For an in-place device update without a release draft, dispatch with
`create_draft=false` and use the signed Actions artifact. Keep the declared version
unless a version change is intended; compare package, signing identity and runtime
assets with the installed APK before installation. The default still creates a draft.

For a local release, provide `DIPLAY_AUTH_ASSETS_DIR` plus `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`, then run:

```sh
./gradlew :mobile:lintRelease :mobile:assembleRelease
```

The output is `mobile/build/outputs/apk/release/mobile-release.apk`. Confirm the keystore alias is a `PrivateKeyEntry`; keep passwords in configured secret environment variables. Use SDK Build-Tools `apksigner verify --verbose --print-certs` and `aapt dump badging` on the APK. Check package/version/minimum SDK against the mobile configuration and signing fingerprint against the intended key. Compare both packaged runtime files byte for byte with the selected inputs and reject all extra credential containers, as the workflow does.

Use the version already declared by the build; changing it requires an intentional version-name/code update. Source archives must match the exact build commit and exclude credentials, configuration and build outputs. The [draft uploader](../scripts/publish_release_draft.py) validates the three attachments and checksums, records build commit/runtime provenance, refuses published releases, replaces draft attachments and verifies remote sizes/digests. Review device-validation limits before publishing.

<a id="beta60-release"></a>
### Beta.60 release

[0.2.20-beta.60](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.60),
code 102/browser v131, was built from `fe3ae19ec46b529563e2233beaf744e31407304a`.
[Android CI](https://github.com/uJZk/TiPlay/actions/runs/45312444589),
[signed build](https://github.com/uJZk/TiPlay/actions/runs/45318577047) and
[Pages](https://github.com/uJZk/TiPlay/actions/runs/45312444646) passed.
The original signing certificate SHA-256 is
`abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`.
The APK SHA-256 is `faa01c46390bc8a4d17e5ed3f5278e16f6e9a2e397bbd4eff744f9a7f5422516`;
the source ZIP SHA-256 is `1f7af0e557b4f810c3a19c6462bfcdc7f60dab953fe416e20f0a865f07c588cb`.
Both downloaded draft assets matched `SHA256SUMS.txt`; the published release API,
public checksum file and beta.60 site version were checked. These checks do not
establish physical first-attempt AirPlay, vehicle audio or microphone behavior.

At the user's request, 67 earlier releases and symbol drafts were removed; Git
tags remain. This also removed the producer symbol drafts required by
`scripts/archive_native_symbols.py`, so the next signed workflow will fail its
symbol archive job until the referenced WebRTC and RTC-audio producer drafts are
restored and verified. The session retained a hash-verified `TiPlay-symbol-backup`
directory in its workspace, including metadata, indexes and archives for 26 drafts;
it is workspace-local and may not persist. Restore the referenced drafts with their
original tags, matching indexes and ZIPs before the next release; do not make private
symbol archives public. If the backup is unavailable, recover matching producer
archives from their original build provenance instead. Earlier release links in
historical records no longer imply downloadable assets.

<a id="beta30-release"></a>

## Beta.30 release

Beta.30/code72/browser v105 was published from
`964d176baba161e369c0696f0abe3c1078b22d26`. Its
[frozen release record](https://github.com/uJZk/TiPlay/blob/68ba158f0b4d0dc7995b36ffaf1e6feac781e07f/docs/Build.md#beta30-release)
retains rate settings, artifact hashes, source checks and signed run `40471221589`,
with independently matched public assets. The 2,500 shared/617 browser checks and
signed packaging belong to that source; full Android CI was waived.

The actual Android AAR control reproduced bitrate collapse after replacement when
video owned the inactive BUNDLE anchor. Application-first local priming and retired
transceiver cleanup restored all 2,400 original AUs in a 40-second replacement run,
with six DataChannels and thirteen control roundtrips. Counting-decoder/RTP results
do not establish pictures, vehicle throughput or timing. Real Chromium verified
SDP lifecycle; its managed UDP policy still blocked browser transport. Production
contracts remain in [desktop RTP integration](Testing.md#desktop-rtp-integration).
The separate URL path gained bounded IO-worker HLS failure evidence; Chromium
MP4/HLS/Canvas/audio checks passed, while the reported device's metadata-open failure
remained unresolved. These controls do not prove vehicle URL recovery.

<a id="beta29-release"></a>

## Beta.29 release

[Beta.29](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.29), code 71, adds idle key-frame recovery. The [original verification record](https://github.com/uJZk/TiPlay/blob/f00d2b69edd0fb0881a1795fe4dddb97b138b190/docs/Build.md#beta29-release) remains in Git history.

<a id="beta28-release"></a>

## Beta.28 release

[Beta.28](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.28) and its [original verification record](https://github.com/uJZk/TiPlay/blob/f00d2b69edd0fb0881a1795fe4dddb97b138b190/docs/Build.md#beta28-release) remain available.

<a id="beta27-release"></a>

## Beta.27 release

Beta.27/code69/browser v102 source and signed run `40449501357` are preserved in
the [frozen release record](https://github.com/uJZk/TiPlay/blob/86cbff4cc6f55e33789ae6a1ac99ef5ef3587f90/docs/Build.md#beta27-release), including
all artifact hashes, exact source archive, original signer/runtime and 51-library
checks. Its 2,489 shared JVM/613 browser passes and emulator original-AU replay
are historical results. The replay established input-completion serialization,
not H.264 picture correctness or vehicle throughput. Production now retains the
user-requested 128 Mbps ceiling, 16 Mbps minimum and one-time 32 Mbps prior;
beta.27's recorded native test used 24 Mbps. Preserve real feedback, overload
guards and the [native replay evidence boundary](../tests/native/README.md).

<a id="beta26-release"></a>

## Beta.26 release

Beta.26/code68/browser v101 source `a4cae7f30aee1fd263506e4a80b5f9d2967c2a40` and signed run `40444777485`
remain in the [frozen release record](https://github.com/uJZk/TiPlay/blob/86cbff4cc6f55e33789ae6a1ac99ef5ef3587f90/docs/Build.md#beta26-release),
with all artifact hashes, exact source archive, signer/runtime/native continuity
and 2,481 shared JVM/613 browser results. Its removal of raw-frame drop policy did
not eliminate native cadence/pacer losses; beta.27's later replay separates those
boundaries. Original compressed AUs, feedback, pacing and reference recovery
remain required; historical source checks do not establish vehicle continuity.

<a id="beta25-release"></a>

## Beta.25 release

Beta.25/code67/browser v100 was published from
`41c03970e95763f9fc62df395658c1df8f5871ce`. Its
[frozen release record](https://github.com/uJZk/TiPlay/blob/68ba158f0b4d0dc7995b36ffaf1e6feac781e07f/docs/Build.md#beta25-release)
retains all artifact hashes, signed run `40439215287`, signer/runtime continuity,
51-library/16 KiB checks and exact public assets. Its first complete local Android
command passed 4,346 cases plus required lint/build targets; 613 browser cases
passed. The repeated Android run was stopped and full CI waived by the user.

It disables raw-frame bitrate dropping for original compressed video and activates
native Opus through one peer-owned permanently muted playout anchor, while preserving
strict codec admission and the common audible Worklet mix. Actual Chromium/native
checks covered seventeen owners, sixteen slots, replacement and cleanup; see
[media regressions](Testing.md#current-media-regression-checks). Resource counters
and desktop output do not establish physical sound. The subsequent field report
still showed suppressed video; beta.26 records that separate follow-up.

## Current browser deployment

### Browser v129

Browser/cache **v129**, product **0.2.20-beta.57/code99**, comes from
`179a4953972f1138cef953a9b7f9d975f21b6884`. Same-source Pages `44461225290` attempt 1 is
completed/success, confirmed through a fresh API response. Local cache/public-tree
checks pass. Anonymous verification passes all 226 files (37,828,528 bytes),
twenty routes (18 HTTP200/two expected404), eight languages and 21 MIME classes
on every first request with zero retries; the site validator exits0. Final
independent offline public review passes without blockers. The separate release phase passes three public asset/full-byte checks and
two anonymous APIs on every first request with zero retries. These release-phase
results do not pre-judge site acceptance. See [beta.57](#beta57-release).

### Browser v128

Browser/cache v128, product beta.56, was deployed by Pages `44291624092` attempt 1
from `94a983186935c84c3d4c2faf2b81df01c74ee3b7`. The
[frozen deployment record](https://github.com/uJZk/TiPlay/blob/86cbff4cc6f55e33789ae6a1ac99ef5ef3587f90/docs/Build.md#browser-v128) retains
226 files (37,828,528 bytes), 21 MIME classes/eight languages and twenty routes
(18 HTTP200/two expected retired404), all passing first request with zero site
retries. The separate GitHub API 503→200 retry qualifies combined delivery and
leaves strict first-request acceptance false. The latest phone capture actually
reports browser v127 with beta.56/code98; published v128 bytes do not establish
which browser revision that phone used.

### Browser v127 reference

Browser/cache v127, product beta.55, was deployed by Pages `44223600106` attempt 1
from `6db3fa9d2bf444ce034c15ec2ca9fd410b852352`. Its
[frozen deployment record](https://github.com/uJZk/TiPlay/blob/0233d5128e6e610e9f59004152abfe3457174d5b/docs/Build.md#browser-v127)
retains 226 files/twenty routes passing every first request with zero retries.
That verifies deployment bytes, not ordinary mirror connectivity. The later
beta.55 field report identifies a full connection regression before browser consent.

### Browser v126 reference

Browser/cache v126, product beta.54, was deployed by Pages `44065088740` attempt 1
from `dbd2b61dabd18c5daa1b6825fb283e0b4f59b5ac`. Its
[frozen deployment record](https://github.com/uJZk/TiPlay/blob/9d37aada3b1229573d414a3201528a8acae893b9/docs/Build.md#browser-v126)
retains all 226 first-request file checks, twenty route checks and zero retries.
Those observations belong to v126, not a fresh v127 deployment.

### Browser v125 reference

Browser/cache v125, product beta.53, was deployed by Pages `43863549457` from
`a3e2e2f342458c9e3eef0994f0b2ec513407d8e3`. Its
[frozen deployment record](https://github.com/uJZk/TiPlay/blob/fc1f41401259d4d7619fdf8094480788f15a7fd2/docs/Build.md#browser-v125)
retains all 226 first-request file checks, twenty first-request route checks and
zero retries. Those observations belong to v125, not a fresh v126 deployment.

### Browser v124

Browser/cache v124, product beta.52, was deployed by Pages `43799862350` from
`f0d0b7f0fdc573edf1e07cbea8d4c66a9e582357`. Its
[frozen deployment record](https://github.com/uJZk/TiPlay/blob/be09f17e52840fbf41a7cc6f22a459c41dcbde89/docs/Build.md#browser-v124)
retains the qualified retired-route first503/second404 and strict first-request
failure. That exception belongs to beta.52; beta.53's first requests all pass.

### Browser v123

Browser/cache v123, product beta.51, was deployed by Pages `43690324936` from
`9a03b85c61385e616c5cbbf714a60ea3bfe3e101`. Its
[frozen deployment record](https://github.com/uJZk/TiPlay/blob/68ba158f0b4d0dc7995b36ffaf1e6feac781e07f/docs/Build.md#browser-v123)
retains the original complete zero-retry file/route verification; those observations
belong to beta.51 and do not describe beta.52 delivery.

### Browser v122

Beta.50/v122 used Pages `43590151476` from
`ec68c4e4c6c10793e218aa5908689b08a7f60484`; the
[frozen deployment record](https://github.com/uJZk/TiPlay/blob/7b5cfb9364412317fa4bb97ee3faf5e5615e6366/docs/Build.md#browser-v122)
retains its full public-byte checks.

### Browser v121

Browser/cache v121, product beta.49, was deployed by
[Pages run 43571756114](https://github.com/uJZk/TiPlay/actions/runs/43571756114)
from `95850493cb6bab562992862087cde87fc94b2e0e`.
The [beta.49 record](#beta49-release) retains its verification.

### Browser v120

Browser/cache v120, product beta.48, was deployed by
[Pages run 43560789648](https://github.com/uJZk/TiPlay/actions/runs/43560789648)
from `eccd1f6f6762574974c698a400426761cfe68faf`.
The [beta.48 reference](#beta48-release) retains its verification.

### Browser v119

Browser/cache v119, product beta.47, was deployed from
`83634d299052291c02afc6aa0c221b85d7a3b035` by
[Pages run 43407418670](https://github.com/uJZk/TiPlay/actions/runs/43407418670).
All 226 files and 20 routes matched; retired update paths remained 404.

### Browser v118

Browser/cache v118, product beta.46, was deployed from
`924700b0aae374991c1682cbe6313bf961546bff` by
[Pages run 42780860513](https://github.com/uJZk/TiPlay/actions/runs/42780860513).
All 226 files and 20 routes matched; `/update/` remained 404.

### Browser v117

Browser/cache v117, product beta.45, was deployed from
`9245a36423263f883e543faf9a6380d98eaf64e2` by
[Pages run 42591587017](https://github.com/uJZk/TiPlay/actions/runs/42591587017).
Public checks matched 226 files and 19 routes; its later APK source has identical site inputs.

### Browser v116

Browser/cache v116 was deployed from `9963fbb3816c49d5caa74693c309397354705748`
by [Pages run 41874214446](https://github.com/uJZk/TiPlay/actions/runs/41874214446).
It removed the one-time update entry; 693 web and Chromium lifecycle checks passed.

### Browser v115

Browser/cache v115 was deployed from `7027555a9e1ef811519f488af1478c37f7a9510c`
by [Pages run 41817076243](https://github.com/uJZk/TiPlay/actions/runs/41817076243).
It introduced page-load update checks and automatic reload after complete installation.
Git history retains the full earlier validation records.

<a id="beta59-release"></a>
### Beta.59 historical release

The removed 0.2.20-beta.59/code101/browser v131 release removed
the withdrawn A/B/C/D settings and implements the [four architecture
fixes](AirPlay-startup-audit.md#remediation). Existing device identity/trust and
working Bluetooth microphone, Siri and navigation routing are preserved.

Source is [`d7277c2d`](https://github.com/uJZk/TiPlay/commit/d7277c2ddea29b1056e2759a8a514e13b55e070a);
[manual original-signing run 45154847336](https://github.com/uJZk/TiPlay/actions/runs/45154847336)
attempt 1 passed Release lint/build and all three release jobs. Product release
ID is `455268123`; its source ZIP matches the exact committed Git archive.
Full CI was waived. [Focused checks](Testing.md#beta59-source-preparation) passed
589 JVM cases/59 suites, 98 browser and 27 Python cases, with zero final JVM
failures/errors/skips or uncaught thread headers.

Actual APK checks passed the 12 base groups, original certificate/v2 verification
on API28/33/37 (min28/target37), retained MIC24/speech33/shared-receiver43 selected
definitions and code checks, baseline native route, 16 license assets, original
Actions/durable native-symbol identity and exact signing run/attempt binding.
The independent startup supplemental checks current AA1/AA2/AA3 definitions,
fields and selected calls; it is static evidence, not a dynamic lock/lifetime
proof. A/B/C/D types, references, fields/actions, resource keys and source entry
points are absent from the signed APK/source. The same removal checker rejects
the actual old beta.58 APK for its retired types and resources with version
checks bypassed. Native inventory retains 51 libraries/32 matching symbol pairs;
19 inherited libraries remain outside available debug-symbol coverage.

Original certificate SHA-256:
`abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`.
APK is 114,697,068 bytes, SHA-256:
`fc0c9dc2387670780342b18a69806f28f1546e1d27254f7bfc47e1bcb5e622e3`.

[Pages run 45160628160](https://github.com/uJZk/TiPlay/actions/runs/45160628160) deployed
the same source. Fresh anonymous public checks matched all three release assets,
226 site files (37,831,824 bytes),
all 20 routes and eight download languages. All first-request
checks passed without retries. Its native-symbol draft was later removed.

Four independent defects are fixed and verified within the stated software
scope. The physical CarPlay → first AirPlay attempt/retry result is still open;
signature, source and public-byte checks do not establish that causal repair.

<a id="beta58-release"></a>
### Published beta.58 reference

[Beta.58/code100/browser v130](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.58)
was published **2026-11-20 11:24:25 (UTC+8)** as `452217328`, from
`fec67c3530c8ba9237acf6acdb07afb7ebff1e08`. Its
[frozen complete record](https://github.com/uJZk/TiPlay/blob/61855464c5e2fa06ffdbdd7b4e4f83dfd22d3cdb/docs/Build.md#beta58-release)
retains signed run `44664150597` attempt1, private JNI draft `452217179`, original
certificate, native/notices/MIC24/speech33/receiver41/mode29 and80 resource checks,
and all artifact hashes. The modes are withdrawn in beta.59.

The 114,693,340-byte APK has SHA256
`9c38a11d04e8ba7ae527daf688f54e5db919496c5e32ab9287f03579de75f7a7`.
Three complete public assets/two APIs passed every first request. Same-source
Pages `44667649812` finally matched226 files/37,828,528 bytes, with a single vendor
README HTTP503→200 retry. Strict first-request acceptance stayed false; independent
qualified product delivery stayed true. The frozen record preserves this precise
qualification and its reports; it is not a beta.59 delivery result.

<a id="beta57-release"></a>
### Published beta.57 reference

[Beta.57/code99/browser v129](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.57)
was published **2026-11-19 12:51:37 (UTC+8)**, release `450887195`, from
`179a4953972f1138cef953a9b7f9d975f21b6884`. Its
[frozen publication record](https://github.com/uJZk/TiPlay/blob/8e9791c868ea513eedf572175aefb7175f775433/docs/Build.md#beta57-release)
retains exact APK/source/checksum hashes, signing run `44459111940` attempt 1,
private JNI draft `450886965`, original-certificate/native/notices/MIC24/speech33/
receiver41 acceptance and same-source Pages `44461225290`. Three full-byte assets,
two anonymous APIs and226 site files/twenty routes passed every first request,
zero retries, with final independent public review. Its native inventory has51
libraries/32 matching symbol pairs and19 historical gaps.

Source checks passed 233 cases/24 suites with zero XML failures/errors/skips and 52
selected compiled classes, qualified by four uncaught shutdown headers accepted
nonblocking for the response-only change. Browser62/Python27/RTC/cache/public-tree
passed. [Testing](Testing.md#beta57-source-preparation) preserves the qualification.
These are beta.57 results, not fresh beta.58 checks.

Beta.57 omits optional nested info only from successful unpaired FairPlay mirror
control SETUP with valid encrypted key/IV, no pairing and `streams` absent; normal
GET/info returns the profile. Other paths retain combined behavior. The actual
beta.57 capture confirms that fallback executes but still has no first type110;
retry reaches remembered approval and247 mirror frames. Earlier c1 waits388.093
seconds without type110. [AirPlay](AirPlay.md#mirror-startup-evidence) retains the
standalone-user control, discovery and iOS-causation limits. Earlier screen-loan
work was withdrawn without build/publication. No beta.57 delivery check proved a
physical first-attempt repair.

<a id="beta56-release"></a>
### Published beta.56 reference

[Beta.56/code98/browser v128](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.56)
was published **2026-11-18 19:06:09 (UTC+8)** as release `449857203`, from
`94a983186935c84c3d4c2faf2b81df01c74ee3b7`. The
[frozen complete publication record](https://github.com/uJZk/TiPlay/blob/86cbff4cc6f55e33789ae6a1ac99ef5ef3587f90/docs/Build.md#beta56-release)
retains exact APK/source/checksum sizes and SHA-256 values, signed run
`44289047781` attempt 1, original-certificate v2, formal receiver40/42-edge,
MIC24/speech33 and source/attempt/frozen-source/native/notices checks. Private JNI
draft `449856611` retains the 51-library inventory, 32 matched symbol pairs and
nineteen historical gaps. It does not contain symbols for all libraries.

The [frozen verification record](https://github.com/uJZk/TiPlay/blob/86cbff4cc6f55e33789ae6a1ac99ef5ef3587f90/docs/Testing.md#beta56-source-preparation)
retains 227 fresh distinct JVM/Robolectric cases/24 suites, zero failures/errors/
skips, 62 browser/27 Python cases, RTC/cache/local-public-tree checks and independent
source review. These belong to beta.56. Same-source Pages `44291624092` attempt 1
succeeds; three public assets match signed bytes and all 226 site files/twenty
routes pass first request with zero site retries. One anonymous GitHub API request
returns 503 then 200: one total retry, qualified delivery accepted, combined strict
first-request acceptance false and original strict validator exit1 preserved.
The exception concerns historical hosting, not APK functionality. Later physical
beta.56 evidence now establishes endpoint and remembered-hit recovery while
first-attempt startup still fails; the captured browser is v127.

<a id="beta55-release"></a>
### Published beta.55 reference

Beta.55/code97/browser v127 was published **2026-11-18 10:28:52 (UTC+8)**,
release `449440387`, from `6db3fa9d2bf444ce034c15ec2ca9fd410b852352`. Its
[frozen complete record](https://github.com/uJZk/TiPlay/blob/0233d5128e6e610e9f59004152abfe3457174d5b/docs/Build.md#beta55-release)
retains exact APK/source/checksum hashes, signed run `44220793369` attempt 1,
Pages `44223600106` attempt 1, private JNI draft `449440237`, existing-certificate
v2, actual MIC/speech/receiver code gates, source/attempt/native/notices and all
first-request public checks. The isolated 184 JVM/Robolectric/62 browser/27 Python
passes did not establish fixed-endpoint protocol continuity. The subsequent user
reports complete mirror connection failure; two raw attempts confirm empty
FairPlay replies on the wrong pipeline. Published-byte acceptance remains historical
and does not convert this known physical regression into functional acceptance.

<a id="beta54-release"></a>
### Published beta.54 reference

[Beta.54/code96/browser v126](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.54)
was published **2026-11-17 18:27:12 (UTC+8)**, release `448442652`, from
`dbd2b61dabd18c5daa1b6825fb283e0b4f59b5ac`. Its
[frozen complete record](https://github.com/uJZk/TiPlay/blob/9d37aada3b1229573d414a3201528a8acae893b9/docs/Build.md#beta54-release)
retains exact APK/source/checksum hashes, signed run `44061134348` attempt 1,
Pages `44065088740` attempt 1, private JNI draft `448442346`, signer/runtime,
24 MIC/33 speech-output code contracts, native/notices and source/attempt binding.
The source passes 186 focused JVM/Robolectric, 88 browser and 27 Python cases.
Three anonymous assets/two API requests, 226 site files and twenty routes pass
every first request with zero retries. Full CI was waived. These identities and
results belong to beta.54. The user's later current-combination audio recovery
report is qualitative evidence; publication checks alone do not measure speakers.

<a id="beta53-release"></a>
### Published beta.53 reference

Beta.53/code95/browser v125 was published **2026-11-16 20:06:19 (UTC+8)**,
release `446974835`, from `a3e2e2f342458c9e3eef0994f0b2ec513407d8e3`. Its
[frozen complete record](https://github.com/uJZk/TiPlay/blob/fc1f41401259d4d7619fdf8094480788f15a7fd2/docs/Build.md#beta53-release)
retains exact APK/source/checksum hashes, signed run `43860786678`, Pages
`43863549457`, JNI archive `446974559`, all native/notice identities and strict
first-request public verification. Its checks belong to that source. The later
beta.53 field capture now records MIC samples and UDP sends; physical output during
MIC demand remains the separate [playback issue](Robustness.md#microphone-and-call-period-output).

<a id="beta52-release"></a>
### Published beta.52 reference

Beta.52/code94/browser v124 was published from
`f0d0b7f0fdc573edf1e07cbea8d4c66a9e582357`. Its
[frozen complete record](https://github.com/uJZk/TiPlay/blob/be09f17e52840fbf41a7cc6f22a459c41dcbde89/docs/Build.md#beta52-release)
retains signed run `43798314175`, all asset hashes, Pages `43799862350`, license/native
verification and actual helper proof. The recorded outcome is qualified product
delivery: `/update.html` first503 then expected404, strict first-request failure
preserved across 21 route events. Native inventory includes 32 matching symbol pairs
and nineteen historical gaps. The API36 helper does not prove production Host
integration, AudioRecord, Bluetooth or physical MIC/Siri success. These remain
beta.52 results; rollback and new admission require their own source checks.

<a id="beta51-release"></a>
### Published beta.51 reference

[Beta.51/code93/browser v123](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.51)
was published **2026-11-15 15:31:14 (UTC+8)** from
`9a03b85c61385e616c5cbbf714a60ea3bfe3e101`. The
[immutable complete record](https://github.com/uJZk/TiPlay/blob/68ba158f0b4d0dc7995b36ffaf1e6feac781e07f/docs/Build.md#beta51-release)
retains all asset byte counts/hashes, signed run `43688533019`, release `445878797`,
Pages `43690324936`, anonymous public verification and sixteen license notices.
Durable JNI archive `445878583` inventories 51 native identities (43 Build IDs/eight
confirmed no-ID), with 32 matching symbol pairs and nineteen historical symbol gaps.
[Beta.50](#beta50-release) preserves pinned-producer provenance. The separate
[beta.51 source/runtime reference](Testing.md#beta51-source) and
[v123 deployment](#browser-v123) retain their evidence boundaries; physical
TiPlay/Siri sound and capture remain unverified.

<a id="beta50-release"></a>
### Published beta.50 reference

Beta.50/code92/browser v122 was published **2026-11-14 19:27:50 (UTC+8)** from
`ec68c4e4c6c10793e218aa5908689b08a7f60484`. The
[immutable complete record](https://github.com/uJZk/TiPlay/blob/7b5cfb9364412317fa4bb97ee3faf5e5615e6366/docs/Build.md#beta50-release)
retains all three artifact byte counts/hashes, signed run `43588682542`, Pages
`43590151476`, public downloads, 51 native identities and 32 matching symbol pairs;
19 historical libraries lack symbols. Its unchanged libdatachannel producer
[43578453616](https://github.com/uJZk/TiPlay/actions/runs/43578453616) comes from
`e7a71d0ddabe805c984b84642e4e972b08ce6e92`, adopted in
`aafbf7bb302b7d266e8cbc98a64f84a43616c297`. The source lock, minimal IPv4LL patch,
official archive digests and matching Build IDs remain release provenance;
[source-patch metadata](../scripts/rtc-audio/source-patches.json) and
[ICE evidence](Robustness.md#ipv4-link-local-ice) retain their contracts. Producer,
adoption, proof and APK commits are distinct. The explicit emulator/NAT proof
does not establish vehicle routing or physical output. Full CI was waived.

<a id="beta49-release"></a>
### Published beta.49

[Beta.49/code91/browser v121](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.49)
was published **2026-11-14 15:34:45 (UTC+8)** from
`95850493cb6bab562992862087cde87fc94b2e0e`.
[Signed run 43570628422](https://github.com/uJZk/TiPlay/actions/runs/43570628422)
and [Pages run 43571756114](https://github.com/uJZk/TiPlay/actions/runs/43571756114)
passed. The [immutable complete record](https://github.com/uJZk/TiPlay/blob/7e01eb29e6af24ed30e438af95697369841d7f49/docs/Build.md#beta49-release)
retains all asset hashes, the 51-library identity inventory in draft `445111467`, twelve
artifact gates, source/hosted proof and public byte checks. It fixes diagnostic
export loss and unfinished Bluetooth cleanup; vehicle causes and physical media
remained unverified. Full CI was waived.

<a id="beta48-release"></a>
### Published beta.48 reference

[Beta.48/code90](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.48)
and browser/cache v120 were published **2026-11-14 13:29:24 (UTC+8)** from
`eccd1f6f6762574974c698a400426761cfe68faf`.
[Signed workflow 43560786980](https://github.com/uJZk/TiPlay/actions/runs/43560786980)
passed; twelve artifact checks, all 51 native identities, anonymous downloads and
the 226-file/20-route public site matched. Matched symbols remain in draft `445038679`.
It introduced best-effort Android playback, independent microphone readiness and
durable runtime-cache ownership while preserving browser call suppression.
Full CI was waived. The [immutable verification record](https://github.com/uJZk/TiPlay/blob/43e4e0954774f054f4959148421e9d81f69a140d/docs/Build.md#beta48-release)
retains all artifact sizes/hashes and earlier test evidence. Its diagnostic
export completeness was corrected only in the later source; vehicle ICE,
mirror picture and physical playback/capture were not established.

<a id="beta47-release"></a>
### Published beta.47 reference

[Beta.47/code89](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.47)
was published from `83634d299052291c02afc6aa0c221b85d7a3b035` with full CI waived.
It fixed missing-CSeq mirror replies and cold encoder IDR loss; actual vehicle
picture remained unverified. The [immutable record](https://github.com/uJZk/TiPlay/blob/43e4e0954774f054f4959148421e9d81f69a140d/docs/Build.md#beta47-release)
retains signed run `43407413026`, test/artifact evidence and all 51 native
identities in symbols draft `444086720`.

<a id="beta46-release"></a>
### Published beta.46 reference

[Beta.46/code88](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.46)
was published from `924700b0aae374991c1682cbe6313bf961546bff` with full CI waived.
It introduced audio packet-age isolation, combined SETUP diagnostics and phone
Bluetooth startup gating. The [immutable record](https://github.com/uJZk/TiPlay/blob/43e4e0954774f054f4959148421e9d81f69a140d/docs/Build.md#beta46-release)
retains signed run `42780854356`, verification and symbols draft `440100070`.
Its following field capture establishes mirror media SETUP, not picture, native
Opus ICE or SCO routing.

<a id="beta45-release"></a>
### Published beta.45 reference

[Beta.45/code87](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.45)
was published at **2026-11-09 09:40:49 UTC** from
`db558c4e97674b4f7ca57d835c20cf1fafb50ff1` by
[signed workflow 42593488156](https://github.com/uJZk/TiPlay/actions/runs/42593488156).
Focused validation passed 138 shared and 700 browser tests; full CI was waived.
Independent artifact checks and anonymous downloads matched the APK, exact source and
checksums; matching native symbols remain in a separate persistent draft.
Mirror force-key commands, original-AU readiness gating, duplicate-PTS recovery
and native-audio/Bluetooth recovery were introduced with physical interoperability
still pending. Git history preserves the full artifact hash table.

<a id="published-beta44"></a>
### Published beta.44

[Beta.44](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.44), code 86,
was built from `34f1d730d433ca8b9a9e8adeda6ca4be233effdc`.
[Full Android CI](https://github.com/uJZk/TiPlay/actions/runs/42465135050) and
[signing](https://github.com/uJZk/TiPlay/actions/runs/42465136735) passed.
Its [immutable complete record](https://github.com/uJZk/TiPlay/blob/7e01eb29e6af24ed30e438af95697369841d7f49/docs/Build.md#published-beta44)
retains artifact hashes and local checks. It adds the legacy mirror event socket
and diagnostics while retaining v116; vehicle media and Bluetooth routing remained
unverified.

<a id="published-beta43"></a>
### Published beta.43

[Beta.43](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.43), code 85,
was built from `47cf959ce3741bd15c00f3c9202daac81b65c759`.
[Full Android CI](https://github.com/uJZk/TiPlay/actions/runs/42373342720) and
[signing](https://github.com/uJZk/TiPlay/actions/runs/42375059777) passed.
Its [immutable complete record](https://github.com/uJZk/TiPlay/blob/7e01eb29e6af24ed30e438af95697369841d7f49/docs/Build.md#published-beta43)
retains artifact hashes, retry and local checks. It removes the mirror key-frame
cache and adds video recovery/diagnostics while retaining v116; vehicle picture
and Bluetooth routing remained unverified.

<a id="published-beta42"></a>
### Published beta.42

[Beta.42](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.42), code 84, was published from `8da4eabd8e6b2d8fcbc6334fc09babeaf8a1db89` on 2026-11-07. It retains browser v116 and buffers the mirror key-frame chain during video track replacement. It also resets native audio negotiation deadlines and records Bluetooth route and uplink diagnostics without device addresses or audio content. Physical testing is needed to validate mirroring and investigate the first native audio failure and Bluetooth microphone routing; see [AirPlay](AirPlay.md) and [Diagnostics](Diagnostics.md).

[Full Android CI](https://github.com/uJZk/TiPlay/actions/runs/42327130495) and the [signed release workflow](https://github.com/uJZk/TiPlay/actions/runs/42327370603) passed. The published APK was independently downloaded and matched the signed artifact. The package is `com.ujzk.tiplay`, the signing certificate matches beta.41, the source ZIP matches the build commit, and 16 KiB ZIP alignment passes.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `TiPlay-0.2.20-beta.42.apk` | 114,531,151 | `d33b20cdb9c6b3addba0d5d7624ab77b0a4b119ed3b85201ec1fea056da8f12a` |
| `TiPlay-0.2.20-beta.42-source.zip` | 70,191,071 | `1d242bfb6d8a5c3f8271840dd5346acdcd94809dd7c0a1868deac279df810d94` |
| `SHA256SUMS.txt` | 191 | `c7b76daaf22681c4432caa52fb4309c9d2d0a734ee6d65eabb799dab12456adc` |

### Published beta.41

[Beta.41](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.41), code 83,
was published from `424ed6c8fa8a44349183364c69f975a3fb2dadd6` at
2026-11-05 10:53:21 UTC. It accepts an initial legacy SETUP containing both FairPlay key
material and NTP timing, matching iPhone requests observed on beta.40. Previously
TiPlay rejected those requests with `mixed audio transport setup` before media
started. Local Android checks and 693 browser tests pass. [Full Android CI](https://github.com/uJZk/TiPlay/actions/runs/42008614328)
passed, including WASM reproduction, native checks, unit tests, lint and builds;
WASM was retried after an upstream TLS download interruption. The Android CI
timeout is 45 minutes so post-job cleanup can finish after substantive checks.
[Signed release](https://github.com/uJZk/TiPlay/actions/runs/42012960238) passed.
The APK has package `com.ujzk.tiplay`, version code 83 and the previous signing
certificate `abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`;
16 KiB ZIP alignment passes. The source ZIP matches `git archive` of the build
commit, and all three published assets match the signed workflow artifacts.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `TiPlay-0.2.20-beta.41.apk` | 114,514,767 | `82e4940d136d1849c6e22b598f0e4d35d9d82aede7836dfa635b5073f8b6f301` |
| `TiPlay-0.2.20-beta.41-source.zip` | 70,186,511 | `17d3bf6e703e853e44883c67ac0c384a435dfb8871af1f302a4c963d0deec134` |
| `SHA256SUMS.txt` | 191 | `efe55d615514e6f66d7f48c4ca8a6560108d8283625d9157f1e95f6729ec79e9` |

Physical iPhone mirroring, video casting and sound remain to be verified. Only the
Android APK was published; generated site version metadata was not deployed.

### Published beta.40

[Beta.40](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.40), code 82,
was published from `8eb3e46655d9d6c7c89970f900fe015e63cedb4c` at
2026-11-04 14:55:46 UTC. It selects legacy FairPlay negotiation when mirroring is available,
including unpaired transport-key handling, and exposes the existing AirPlay trust
reset in the phone's advanced settings. Transient AirPlay 2 audio remains available
when mirroring is unavailable. Local Android unit tests, lint and debug builds pass;
all 693 browser tests pass. [Android checks](https://github.com/uJZk/TiPlay/actions/runs/41838540471)
passed all substantive checks, including WASM and native DSP, but the overall run was
cancelled at its 30-minute limit during Gradle's post-job cleanup.
[Signed release](https://github.com/uJZk/TiPlay/actions/runs/41850600419) passed.
The APK has package `com.ujzk.tiplay`, version code 82 and the previous signing
certificate `abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`;
16 KiB ZIP alignment passes. The source ZIP matches `git archive` of the build
commit, and the three published assets match the signed workflow artifacts.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `TiPlay-0.2.20-beta.40.apk` | 114,514,767 | `2956629bcd24c28241b168eb106af5cb02f0e2f544964e0f2276e7e535b31c2c` |
| `TiPlay-0.2.20-beta.40-source.zip` | 70,186,856 | `a921047f37a27b3929ee57b15b1cd036d50609774e07745a161bfe9175caa6b7` |
| `SHA256SUMS.txt` | 191 | `8d8e70c2f63e532d55b838cb16b506fee1fd4a600cfbaec9743cd7dbe2814cf1` |

Actual iPhone mirror picture and sound remain unverified. Only Android was
published; generated site version metadata was not deployed. Increment the browser
cache revision when next deploying these changed generated assets.

### Published beta.39

[Beta.39](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.39), code 81,
browser/cache v114, was published at **2026-11-04 00:37:42 Asia/Shanghai** from
`17b43beaec4200ea7410b38a768fb55882d527fe`. It adds direct-first URL fallback,
empty-screen recovery, shared Bluetooth pickers and bounded diagnostics.

[Android checks 41670512557](https://github.com/uJZk/TiPlay/actions/runs/41670512557)
and [signed release 41674103120](https://github.com/uJZk/TiPlay/actions/runs/41674103120)
passed, alongside 692 browser tests and public-tree checks. Independent checks
confirmed package/code81, signer continuity, WebRTC/alignment, exact source and all
three anonymous public assets. [Pages run 41670512475](https://github.com/uJZk/TiPlay/actions/runs/41670512475)
passed with matching changed runtime bytes.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `TiPlay-0.2.20-beta.39.apk` | 114,514,767 | `cf4c077a66804174259b29cbf119916f47c24e2bd98a378016aebad89bcc5627` |
| `TiPlay-0.2.20-beta.39-source.zip` | 70,184,595 | `1e7df90503695e2d76672892af73f6d925a1828ae41fa45f86033a134aaf7ce1` |
| `SHA256SUMS.txt` | 191 | `a96628d199d68d10b17dcf31bbf92882a23b503ddf2cf0058af7b6b38e8312aa` |

Physical YouTube, AirPlay mirroring and CarPlay recovery remain unverified;
software checks do not establish vehicle playback. The full prior
[beta.38 record](https://github.com/uJZk/TiPlay/blob/c05baef56417a885a7e2f8e5f5e514b64dbfbda9/docs/Build.md#current-browser-deployment)
is preserved in Git.

Earlier metadata deployments each verified all 217 public files (31,820,348 bytes),
page/cache identity, MIME types and no redirects. Native playback corrections
belong to the linked APK releases, not these version-metadata deployments.

| Browser | APK record | Build commit | Pages run |
| --- | --- | --- | --- |
| v104 | [Beta.29](#beta29-release) | `c25e92d26d80e0d69b80dcfa61745222a747b4ec` | [40458375995](https://github.com/uJZk/TiPlay/actions/runs/40458375995) |
| v103 | [Beta.28](#beta28-release) | `50f94b322ddf3a79d7bf74e674800cba437b74fa` | [40452502158](https://github.com/uJZk/TiPlay/actions/runs/40452502158) |
| v102 | [Beta.27](#beta27-release) | `6098d4ed5fc85f67cc7d290ec3d6ae2068cb4805` | [40449503779](https://github.com/uJZk/TiPlay/actions/runs/40449503779) |
| v101 | [Beta.26](#beta26-release) | `a4cae7f30aee1fd263506e4a80b5f9d2967c2a40` | [40444780537](https://github.com/uJZk/TiPlay/actions/runs/40444780537) |

Earlier metadata/web-only deployments retain their exact source, checks and scope
in the [frozen deployment record](https://github.com/uJZk/TiPlay/blob/9d37aada3b1229573d414a3201528a8acae893b9/docs/Build.md#current-browser-deployment):

| Browser | Source | Pages run | Scope |
| --- | --- | --- | --- |
| v100 | `41c03970e95763f9fc62df395658c1df8f5871ce` | `40438289269` | Native-audio activation/diagnostics and beta.25 metadata; 217 files/31,820,348 bytes matched |
| v99 | `1bc4eb793f9e2b3d6085f10a434dfa7842f9bcd2` | `40425187334` | BUNDLE/SCTP continuity; 217 files/31,811,563 bytes matched; beta.24 APK unchanged |
| v98 | `4b89fc7d7e88a1e9c1824fef0cf4f7b4bcd98872` | `40367405686` | Cleanup/cache invalidation; 217 files/31,811,194 bytes matched; beta.24 APK unchanged |
| v97 | `637e2ecdb2c96d38d92504fd8a395c65b9cb05d3` | `40362871807` | Beta.24 metadata; 217 files/31,811,644 bytes matched |
| v96 | `7a6129434fc138f9d2ac36b1f446bc1191cbf0a7` | `40353155061` | Web-only H.264 receive-level correction; 217 files/31,811,644 bytes matched; beta.23 APK unchanged |

All five records retain byte/MIME/no-redirect checks. v96 corrects a High-4.2 source
rejected against a High-3.1 SDP declaration through the bounded capability policy,
without changing source compression/profile/rate; initial and replacement offers
share it. Its 598 browser/4,321 Android checks and local-description probe do not
establish vehicle decoding: actual RTP-to-Processor probing lacked ICE candidates.
v99's 116 full-page/605 unit/33 Python checks and cached Android command remain
historical [sweep evidence](sweep-2026-10-26/Delivery.md#follow-up-repairs).

The preceding browser **v95** and beta.23/code65 download metadata were deployed from
`8191b9fcc45497d194f38f05174a8993be04c625` by
[Pages run 40344544258](https://github.com/uJZk/TiPlay/actions/runs/40344544258).
All **216** public files (**31,801,191 bytes**) match the committed assembly,
with correct script/WASM MIME types and no redirects. See [beta.23](#beta23-release)
for signed APK provenance. The v89/v87 records below are historical.

The historical browser **v89** web-only audio rollout added NetEq-first Opus, libav.js AAC-LC/
ELD/ALAC, continuous 48 kHz conversion, software capability negotiation and URL
fallback. Local Node and real Chromium/production-CSP, offline and site checks
are recorded in [Testing](Testing.md#browser-wasm-verification). That rollout
explicitly skipped CI and APK builds, retaining Android beta.20/code62. It used
the existing Pages workflow after a `[skip ci]` commit.
The older browser/APK records below describe their original releases.

Verified 2026-10-26: runtime commit `b3d387ca9a31eb9efad91471f278fc0a881ec59e`
was published by [Pages run 40261108564](https://github.com/uJZk/TiPlay/actions/runs/40261108564).
All **89** public runtime/Service Worker files matched the assembled local bytes;
module-script MIME types were correct. Both page and cache report **v89**. The
follow-up fixes ended raw-PCM epoch revival without blocking a distinct mode or
an explicit producer reset. The final local suite passes **729** tests; actual
Chromium software/Worklet/URL, clock-jump and offline checks pass. No Android CI
run was created for this runtime commit, and no APK was compiled or published.



The historical formal root webpage **v87** was deployed from
`905f99c66d451190cb71d5ddf9be4bf30e0dcda8`. The manually dispatched
[Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/40178657118) succeeded.
Public verification at **2026-10-25 17:01:59 UTC+08:00** compared all **185** files
(**11,908,440 bytes**) with the committed assembly: every byte matches,
all **89** Service Worker entries are present, all five WASM binaries use
`application/wasm`, and no file redirects. The new audio evidence module is in the
runtime cache. Those publication commits used `[skip ci]` at the user's request; this is
not a full-CI acceptance claim.

v87 retains v86's held SoundTouch catch-up and contiguous PCM/progress/braking
policy, adding Debug-only measurement and bounded waveform capture. Playback and
recovery decisions are unchanged. WASM binary bytes retain their prior reproducibility
evidence; diagnostic pre-clamp measurements are in the JavaScript wrapper.
[Audio evidence](Audio-evidence.md) states coverage, suppression and CPU/acoustic
attribution limits. Public delivery checks do not establish vehicle audio quality.

## Previous beta.19 release

Published [TiPlay 0.2.20-beta.19](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.19), code **61**, at **2026-10-25 13:29:26 UTC+08:00**.
Build commit: `7234f391de5fa186443a253728681f8d105b0eec`. The [signed workflow](https://github.com/uJZk/TiPlay/actions/runs/40165134293)
passed Release lint/build, runtime checks and draft upload. Published APK/source/checksum
assets match the independently verified draft attachments and checksums:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `TiPlay-0.2.20-beta.19.apk` | 103,719,182 | `9d15a556aff3e3048ef5bb3b8ced7719b528f05adb40c129f1830e35c387cf5d` |
| `TiPlay-0.2.20-beta.19-source.zip` | 20,938,078 | `6d850e3955f86fe74c49b37c8ab840380c43f49640e47ab7f5348326bccc77be` |
| `SHA256SUMS.txt` | 191 | `9481eb15522ef6729bb62a303d147469fe2a5d71c5c6bcdf59fe0be2e83b7896` |

### Verification and scope

154 targeted diagnostic/UI/action/spacing/translation checks passed, as did the final
Discard dialog check, phone Debug build, nine release-draft tests and two site checks.
**Full Android CI was skipped by explicit user request.** Release lint/build and
independent signature/source/native checks passed separately.

The APK is non-debug `com.ujzk.tiplay`, min SDK 28, target SDK 37. Signing SHA-256
matches beta.18: `abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`. Exactly two runtime identity files are
packaged; the workflow compares them byte-for-byte against pinned DiPlay 0.2.18 inputs.
No additional credential containers exist. The source ZIP bytes match `git archive`
of the exact build commit. All four Android ABIs include Zstandard JNI. There are
43 native libraries; all 21 ELF64 libraries meet 16 KiB LOAD alignment,
and `zipalign -P 16` passes.

This release adds the Debug switch and one View logs button. Ordinary mode offers
Save/Share/Close; Debug offers End and export/End and share/Discard/Minimize. Ending
or discarding stops and clears capture; minimizing keeps recording. Export/share
prepares a usable file before cleanup. Failed writes retain stopped evidence.
Obsolete capture/export/clear controls are removed and product copy is shortened.
Realtime capture and exported logs continue to use Zstandard level 3. Browser DSP
revision remains v86. [Diagnostics](Diagnostics.md) records physical follow-up:
real-car audio/echo, restart, screen-off and sustained CPU/storage acceptance remain
unrun. The [runtime identity notice](Third-party-notices.md#experimental-authentication-data) applies.

### Previous release provenance

At the user's request, the 16 Release objects before beta.19 and their 48 attachments
were deleted after beta.19 publication and public-download verification. Git tags
and source history are retained; links below now point to source tags. Historical
hashes remain provenance, not available old download attachments.

- [Beta.18](https://github.com/uJZk/TiPlay/tree/v0.2.20-beta.18), code60/v86,
  built from `8614c665616b49199e8307628fc3fd8f15324504`; APK SHA-256
  `8a1c0d68eda32f8c68b844b10fdfdb9722e71c9a5172abaf9f390a22d4a3188d`.
- [Beta.17](https://github.com/uJZk/TiPlay/tree/v0.2.20-beta.17), code59/v85,
  published from `d8708330e6b86f33cb212a7af66651cc397efd10`; APK SHA-256
  `7734096f42e2dbbab49099668e7e65fae802bf84af59493d20f86730a2db253f`.
  Its earlier CI/signed workflow evidence remains recorded; release attachments were removed.
- [Beta.16](https://github.com/uJZk/TiPlay/tree/v0.2.20-beta.16), code58/v84,
  prerelease **422536688**, was published **2026-10-24 13:44:46 UTC+08:00** from
  `572207cc9a16c0d13d287e5cd3612ea79767eb93`.
  [Signed workflow](https://github.com/uJZk/TiPlay/actions/runs/40065680904),
  [Android CI](https://github.com/uJZk/TiPlay/actions/runs/40065661626) and
  [Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/40065661627) succeeded.
  Its **101,094,545-byte** APK SHA-256 remains
  `76ea16a1320a191b49a91f20ae9c5d59148ac04f477e1748b0ebc6c38597d540`.
- [Beta.15](https://github.com/uJZk/TiPlay/tree/v0.2.20-beta.15), code57/v83,
  prerelease **422463974**, was published **2026-10-24 10:32:06 UTC+08:00** from
  `4cd5806257b35523ccc6b7224e17acce85d51873`.
  [Signed workflow](https://github.com/uJZk/TiPlay/actions/runs/40053153040),
  [Android CI](https://github.com/uJZk/TiPlay/actions/runs/40053151756) and
  [Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/40053151725) succeeded.
  Its **101,060,905-byte** APK SHA-256 remains
  `6919f19b7f7e458fa20074df16fcf98b01883bef3ec90739917646176eb5e78a`.
- [Beta.14](https://github.com/uJZk/TiPlay/tree/v0.2.20-beta.14), code56/v80,
  prerelease **421892511**, was published **2026-10-23 13:50:47 UTC** from
  `59efe314ae8e1a4b21b86c0feb451c624ff13e4b`.
  [Signed workflow](https://github.com/uJZk/TiPlay/actions/runs/39962490704) and
  [original Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/39962485128)
  succeeded. Its **101,060,901-byte** APK SHA-256 remains
  `d8c5e1aaa1ee239fbcfe27d05178270da07a86136cd9154f93f58183932418c4`.
- [Beta.13](https://github.com/uJZk/TiPlay/tree/v0.2.20-beta.13), code55/v79,
  prerelease **421554656**, was published **2026-10-23 07:34:49 UTC** from
  `70a86088e8ec57c1adb24045d28c1f06f9300f0f`.
  [Signed workflow](https://github.com/uJZk/TiPlay/actions/runs/39917075886) and
  [Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/39917163410)
  succeeded. Its APK SHA-256 remains
  `2b4161736d7bdcc0a0762af40d720468e72cdae7367042ca0fc3edf407235765`.

Historical build/source hashes are retained for provenance; the old release attachments were removed. Earlier detailed evidence,
including beta.14 source/checksum digests and its original test scope, remains in Git.

## Updating an installed app

Select the device with `adb -s <serial>`. Pull the installed APK using `pm path <application-id>` and compare its application ID and signing fingerprint with the candidate. A different ID installs separately; a different signing key cannot update the existing package. Preserve settings by keeping both and using `adb -s <serial> install -r <apk>`; do not uninstall to bypass a mismatch.

If preserving the runtime identity, also compare both `offline-mfi` files byte for byte. An installed APK can supply that identity, but cannot supply the Android signing private key. Confirm the installed version/update time, launch the declared activity and check new application crashes. Installation alone does not validate iPhone or vehicle playback.


## Previous beta.20 release

Published [TiPlay 0.2.20-beta.20](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.20),
code **62**, at **2026-10-25 16:57:06 UTC+08:00**, with browser **v87**.
Build commit: `905f99c66d451190cb71d5ddf9be4bf30e0dcda8`.
The [signed release workflow](https://github.com/uJZk/TiPlay/actions/runs/40177958232)
passed mobile Release lint/build, pinned runtime validation, signing and draft upload.
Independent downloaded-artifact checks verify the non-debug `com.ujzk.tiplay`
package/version, signature continuity, exact `git archive` source, checksums, 16 KiB
ZIP alignment, 43 native libraries and exactly the two expected runtime identity
containers. Signing SHA-256 remains `abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `TiPlay-0.2.20-beta.20.apk` | 103,737,822 | `9afba8b130375ac7f76e7ac5f67a9af3468d41d9f44cd97036cb3b6347ba87d6` |
| `TiPlay-0.2.20-beta.20-source.zip` | 20,963,958 | `6b1b002bd784f30781fd88cd9acfa25874cf0bc76aa077ab949bf40a7b3660c5` |
| `SHA256SUMS.txt` | 191 | `ad4c15d03a565b19c16f0eb86371cc500fb76785c759b32b2efa1595b2e725e4` |

The Debug-only recorder, validated raw evidence channel, native float/pre-clamp
measurements and extraction tool are documented in [Audio evidence](Audio-evidence.md).
The requested extra manual browser-trace feature was removed. This release adds
evidence; it does not establish or fix the reported crackle's root cause.

**Full CI was skipped by explicit user request.** The focused Android run passed
65 tests (receiver/evidence schema and audio diagnostics); relevant browser audio,
recovery, mixer, serialization and currentTime-independence tests passed. The actual
production-CSP Chromium media-clock harness also passed with deliberately jumping
currentTime. Three extraction tests, nine release-draft tests, two layout tests,
public-tree/cache checks and independent artifact/public-site verification passed.
Target-device CPU attribution, physical audio and sustained capture overhead remain
unmeasured. Detailed artifacts stay outside Git in `/workspace/tiplay-beta20/`.

<a id="beta-release"></a>

## Beta.21 release

Published [TiPlay 0.2.20-beta.21](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.21), code **63**, browser **v90**, at **2026-10-26 17:20:40 UTC+08:00**. The user authorized signed beta APK publication and the matching browser deployment. The existing signed release workflow runs Release lint/build, exact runtime identity checks, signing and attachment generation; full Android CI was explicitly skipped for that release.

This release replaces URL casting with local pinned libmedia AVPlayer and removes the obsolete custom player/cache/subtitle/tempo implementation. Live video uses original-codec WebRTC RTP directly into Canvas; negotiated Opus uses an independent original-codec RTP audio peer, with unsupported formats retaining the existing decoder path.

Completed before release: 533 browser tests, real Chromium MP4/HLS/Canvas/audio/subtitle/seek/replay/cancel/offline-runtime checks, 43 targeted Android tests, all four native ABIs and native-to-native original Opus RTP verification. See [Testing](Testing.md#current-release-source). Vehicle/hardware decode, browser RTP interoperability, rotating live-window recovery and CEA-608/708 remain unverified. URL-only ALAC is unsupported; realtime ALAC fallback is retained.

Build commit: `c2d51accf8e896975a7490891c18b79a23c5d35f`. [Signed workflow](https://github.com/uJZk/TiPlay/actions/runs/40297314279) passed Release lint/build, signing, runtime checks and draft upload. [Pages deployment](https://github.com/uJZk/TiPlay/actions/runs/40297317768) succeeded on 2026-10-26; all **213** public files match local beta.21/v90 assembly byte-for-byte, with correct WASM MIME types. Published APK/source/checksum attachments were downloaded again and match the independently verified draft bytes.


| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `TiPlay-0.2.20-beta.21.apk` | 113,988,416 | `a6c1356811e702c363118560debce61e95ce71e9b34d010ef72b1dffafc95596` |
| `TiPlay-0.2.20-beta.21-source.zip` | 40,686,234 | `07452417763cfaf81e9b2ecc44833c4b7b8d485c6ad3b4f26ea6f960ad527d70` |
| `SHA256SUMS.txt` | 191 | `7c03b7564f08cae9303ec46d6077b375dd1292b092d214ddc32f3a58c313d404` |

Independent checks confirm non-debug `com.ujzk.tiplay`, code63, signature continuity with beta.20 (`abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`), exact build-commit `git archive` source, exactly two unchanged runtime identity containers, 51 native libraries, all 25 ELF64 libraries with 16 KiB LOAD alignment and successful 16 KiB ZIP alignment. The four libdatachannel payloads and packaged notices match committed sources. Build and public-byte evidence are retained outside Git under `/workspace/work/beta21-*` and `/workspace/work/tiplay-validation/`.

## Beta.22 release

Published [TiPlay 0.2.20-beta.22](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.22),
code **64**, at **2026-10-26 18:10:21 UTC+08:00**, retaining browser **v90**.
Build commit: `544127d3f4c5e342425613645f7bb89e09656aeb`.

This adds CarPlay Video in Car to phone + browser mode on the beta.21 base,
using the existing AVPlayer URL pipeline. The LIVI reference, command handling
and cleanup are in [AirPlay](AirPlay.md#carplay-video-in-car-in-the-browser).
Parking-state integration is deferred by user request; no gear signal is required.
FairPlay video remains unsupported. Physical iPhone/vehicle acceptance is pending.

The user explicitly skipped Android CI and the full test suite. Local verification
passed 75 targeted Android tests, Release lint/build, nine release-draft checks,
four download-page tests, two layout tests and public-tree/cache checks. Local
large-attachment uploads returned 401. After explicit user authorization, only the
existing [signed release workflow](https://github.com/uJZk/TiPlay/actions/runs/40303963168)
ran Release lint/build, pinned runtime validation, signing and draft upload.
Android CI was not dispatched. The published APK is the workflow artifact;
the earlier local candidate is retained separately as evidence.

Downloaded release attachments independently pass package/code64/non-debug checks,
signer continuity (`abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`),
exact build-commit `git archive` comparison, checksums, exact two runtime identity
containers, all four supported ABIs, 51 native libraries and ELF64/ZIP 16 KiB alignment.
Server attachment sizes/digests agree with downloaded bytes before publication.

| Published artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `SHA256SUMS.txt` | 191 | `0f102ff1ad92e93c286fd3c00335406f1499dcc38260f311f75eb4d6d1816107` |
| `TiPlay-0.2.20-beta.22-source.zip` | 40,692,553 | `fe0f185f9862b187d1e96313d182cfad77b2329e48805df59c229ecde626ae87` |
| `TiPlay-0.2.20-beta.22.apk` | 114,004,800 | `5e19eb180212aa2afce639436a0b8e99110cff9af4534c6239624921ff9a0fd8` |

[Pages run 40303064954](https://github.com/uJZk/TiPlay/actions/runs/40303064954)
succeeded; public `app-version.js` and `/download/` show beta.22. Browser v90
runtime bytes are unchanged. Release files and independent verification evidence
are retained outside Git in `/workspace/tiplay-beta22/remote-artifacts/` and
`/workspace/tiplay-beta22/`; temporary signing inputs were removed.


<a id="beta23-release"></a>

## Beta.23 release

Published [TiPlay 0.2.20-beta.23](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.23),
code **65**, browser **v95**, at **2026-10-26 22:56:33 UTC+08:00**.
Build commit: `8191b9fcc45497d194f38f05174a8993be04c625`.
The user authorized full Video in Car/AirPlay review, owner-scoped screen transfer
fixes, signed APK publication and Pages deployment. The release includes the session's
RAOP/AirPlay 2 audio, BLE discovery hints, three-choice trust, reset setting and
Video.js music view with sender artwork/title/artist and DACP track/skip controls.

The release repairs the accepted `videoPlayback` feature's missing `/info`
declaration, precise type-130 cleanup, delayed display callbacks, URL audio-only
screen return and ordinary AirPlay replacement/return. A subtitle-specific
drain/seek handshake fixes a late EOF/new-cue race in the pinned AVPlayer runtime;
its audio/video packet handoff and clock ownership stay upstream.

Local verification passes 568 browser tests, 4,321 Android unit tests, all three
debug lint/build targets, native AirPlay JNI boundaries, site/draft/cache checks,
and a reproducible 45-file AVPlayer vendor build. Actual Chromium covers full URL
MP4/HLS playback, subtitle switching/seek, return/reborrow, consent, music layouts
and photo CSP. Desktop software decoding does not establish vehicle hardware
playback. Physical iPhone/vehicle acceptance remains open.

[Full Android CI](https://github.com/uJZk/TiPlay/actions/runs/40340438194) passes
both the complete source checks and WASM byte reproduction. The initial CI attempt
exposed changing timestamps in Gitiles archives and a reset Robolectric SDK
download. WebRTC now uses its fixed official Git commit/tree and object-integrity
checks; six source-integrity regressions pass, and NetEq remains byte-identical.
Robolectric's CI downloader uses the official Maven Central endpoint.

[Signed workflow 40340444194](https://github.com/uJZk/TiPlay/actions/runs/40340444194)
passes Release lint/build, signing, runtime checks and verified draft upload.
The draft attachments were independently downloaded before publication; the three
public attachments were downloaded again and match exactly. The release tag resolves
to the build commit above.

| Published artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `TiPlay-0.2.20-beta.23.apk` | 114,152,356 | `dfc1ae661ceb6fdf58d19946ce916a11afcb1256e249c436092b066261f99da1` |
| `TiPlay-0.2.20-beta.23-source.zip` | 40,802,157 | `40bb8fdf14b6577188298c212ab000769d57c1d984084a782bf75202892ac16a` |
| `SHA256SUMS.txt` | 191 | `264eb8a6a676a7185701162bc409f88a1c8ca206e4f7084f1f826775e94e89ff` |

Independent checks confirm non-debug `com.ujzk.tiplay`, code65, signer continuity
(`abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`),
an exact build-commit `git archive`, and the two unchanged runtime identity
containers. All four supported ABIs are present; the 51 native libraries include
three unchanged legacy JNA stubs. All 25 ELF64 libraries and the APK ZIP pass
16 KiB alignment checks, and the four libdatachannel payloads match beta.22.

[Pages run 40344544258](https://github.com/uJZk/TiPlay/actions/runs/40344544258)
succeeds from the same build commit. All 216 public files (31,801,191 bytes) match
the local assembly, with correct script/WASM MIME types and no redirects. Draft,
public-download and site verification reports remain outside Git under
`/tmp/tiplay-beta23/` and `/tmp/tiplay-beta23-public-verification.json`; music
screenshots under `/tmp/tiplay-beta23-now-playing/` use synthetic metadata/artwork.
The later documentation-only commit does not change the build/source provenance.

<a id="beta24-release"></a>

## Beta.24 release

Published [TiPlay 0.2.20-beta.24](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.24),
code **66**, browser **v97**, at **2026-10-27 00:48:47 UTC+08:00**.
Build commit: `637e2ecdb2c96d38d92504fd8a395c65b9cb05d3`.
It repairs native sender encoder selection while preserving original compressed
frames and strict admission. Local checks passed 598 browser and 4,335 Android
tests, lint/debug builds and site/draft/cache/public-tree checks.

[Full Android CI 40358971686](https://github.com/uJZk/TiPlay/actions/runs/40358971686)
passed unit tests, lint/debug builds, native DSP checks and WASM reproduction.
[Signed workflow 40358976659](https://github.com/uJZk/TiPlay/actions/runs/40358976659)
passed Release lint/build, signing, runtime checks and draft upload. Independent
artifact checks confirmed matching public bytes, source identity, signer/runtime
continuity and 16 KiB alignment. The
[frozen record](https://github.com/uJZk/TiPlay/blob/81adbf35d564649113cf3d9ae61f139c358e73fc/docs/Build.md#beta24-release)
retains detailed validation and device limits.

| Published artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `TiPlay-0.2.20-beta.24.apk` | 114,168,744 | `2554e2471a081fc2c62924a94529c3a8e49986f4b4cb30e9c149e62dc620f237` |
| `TiPlay-0.2.20-beta.24-source.zip` | 40,825,229 | `943ff5b47c3b744f306c704ae920ef8869c3d8d6c2ee47a7b43b114dd9be6173` |
| `SHA256SUMS.txt` | 191 | `fec39126c47003da5694bebaa7305388600daa16c12e65ad131ee9e1d21035dd` |

[Pages 40362871807](https://github.com/uJZk/TiPlay/actions/runs/40362871807) succeeds
from the same build commit; all 217 public files matched the local assembly.
