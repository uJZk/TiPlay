# Build TiPlay

Build the `:mobile` Android phone receiver for the car browser. Other applications remain for upstream compatibility. Run commands from the repository root; Windows uses `gradlew.bat`. See [Windows containers](Wlsc.md) for that environment.

## Toolchain and source checks

Use the Gradle wrapper and the JDK, Node and Android SDK/NDK packages in the [Android workflow](../.github/workflows/android.yml). Set `JAVA_HOME` and `ANDROID_HOME`, or put `sdk.dir=/absolute/sdk/path` in untracked `local.properties`. Android Studio must use the same Gradle JDK and the `mobile` run configuration.

The Android/browser product version comes from `tiplayVersionName` and
`tiplayVersionCode` in [gradle.properties](../gradle.properties). The latest published prerelease is **0.2.20-beta.21** (code **63**);
[beta.21 release](#beta21-release) records provenance and checks. Run
`python3 scripts/build_site.py` after a version change to regenerate `app-version.js`.
The browser diagnostic/cache revision is independent of the product version;
the deployed page uses **v90**, with original-codec WebRTC RTP for live video and negotiated audio.
The **beta.17/code59** build introduced overlapping 5 ms recovery tails and
pitch-preserving SoundTouch CarPlay catch-up up to 20%; v86 adds held catch-up.
The historical beta.16 APK/webpage v84 build is recorded below. Software checks are in [Testing](Testing.md#webrtc-integrated-acceptance).
The deployment replaces `https://ujzk.github.io/TiPlay/` and deletes the
independent `/webrtc/` subsite without an alias or redirect; the APK defaults to the
root. The beta record below identifies both build and deployment provenance. Every
language's download entry opens the GitHub Releases index without a version-specific
URL. Debug APK metadata retains its diagnostic suffix.

### Browser v86 release

v86 adds held SoundTouch catch-up: above 200 ms it ramps toward 20%, locks the
previously applied tempo when decline is confirmed, and returns to adaptive
control when contiguous PCM reserve is insufficient, progress stalls, timing is
unavailable or braking is needed near the target. DSP-owned input contributes to
the same contiguous source frontier as queued PCM without double counting.

The source passes **919 browser tests**, including real 250 ms SoundTouch
catch-up, hold/exit behavior and preservation of the live filter, plus cache,
public-tree and deployment assembly checks. Android CI is explicitly skipped at
the user's request for this web-only release. The signed beta.17/code59 APK and
its source/checksums retain their published bytes; v86 is a separate webpage build.
The [Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/40159166211)
succeeded for `d9af73b082afc8db094c11ecdae9475d53501828`; public byte verification
is recorded in [the current deployment](#current-browser-deployment).

### Beta.17 verification

The implementation uses a three-second error-history PD controller without integral
accumulation. A 200 ms phase-error soft limit blends toward the 20% tempo ceiling
over the next 100 ms of error; temporal slew and contiguous PCM reserve remain
mandatory. SoundTouch controls tempo independently of libsoxr clock conversion.
Every controlled audio cut retains a non-renewable 5 ms published-sample fade,
which may overlap fresh fade-in. Screen-loan commands use LIVI-compatible
`VideoPlayback` borrow IDs and constraint 500 while retaining owner confirmation.

Local verification: 914 browser tests, 13 capture/trace Python tests, two deployment
tests, nine release-draft tests, public-tree/cache checks, reproducible SoundTouch
WASM binaries, real Chromium capture replay and frozen-currentTime playback.
A desktop audio-only 30-second mixed replay recorded approximately 3.41% of one
core for AudioWorklet and 2.16–2.18% for renderer main tasks. This excludes vehicle
CPU, original video/rendering and acoustic output; it does not prove crackles are
fixed. Logs remain outside the public repository. Vehicle screen return, tempo
quality and actual speaker timing still require acceptance.

Local Android compilation was unavailable. Full Android checks and the signed
release ran in isolated GitHub runners; CI, signing and independent APK checks
all succeeded before publication. The deployment test now compares cache and
diagnostic versions instead of pinning a stale v84 constant.

### Check the source build

Run the checks defined in the [Android workflow](../.github/workflows/android.yml): browser tests, public-tree scan, release-draft tests, Android unit tests, lint and debug builds. Retained `home`/`maphost` checks protect upstream compatibility. Optional Chromium checks are in [Testing](Testing.md).

CI limits concurrent JVMs and periodically retires test workers using the workflow's
Gradle arguments and [CI memory policy](../gradle/ci-memory.init.gradle). Robolectric,
Mockito and native graphics can retain SDK/resource state beyond the Java heap;
heap limits alone do not prevent exhaustion or long stalls in a full run. Module
test settings may override the policy's default heap. Keep this isolation in CI
rather than changing application behavior or omitting tests.

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

Browser **v89** uses official NetEq, libav.js decoder/resampler Workers and the
fixed-memory audio core for realtime audio. WebCodecs audio and libsoxr are removed
from that realtime revision. Current URL playback uses libmedia AVPlayer; its dependency build is separate from the WASI helper.
AudioContext and NetEq both use 48 kHz. [Audio tempo](Audio-tempo.md) records the
final decoder order, memory bounds, lifecycle and remaining device acceptance.
The user's current instruction skips CI and APK compilation; existing APK release
records below remain historical and do not certify these new browser changes.
See [execution boundaries](Browser-wasm.md), including measured cases that retain
native browser APIs or JavaScript.

URL casting uses the separately pinned libmedia AVPlayer build. Its local modules,
audio WASM, same-origin Worklets, compatibility patches and integrity checks are
documented in [vendor/libmedia](../site/play/vendor/libmedia/README.md). Rebuild it
with `npm ci && npm run build` from `scripts/avplayer/`; the Video.js controls build
remains separate under `scripts/videojs/`. Regenerate the offline manifest with
`python3 scripts/update_browser_cache.py` after changing browser resources.

The shipped binaries build from complete corresponding sources with WASI SDK 34
(Clang 23.1.0), Binaryen 132, CMake 4.1.2 and Ninja 1.13.0. Python 3.12+, `patch`
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

The libav.js portable/SIMD pair uses **Emscripten 4.0.7**, separately
from the WASI helper above. Activate that SDK and Node 22, then run
`python3 scripts/libav/build.py --output /tmp/libav-check`. The pinned source
archive, full corresponding sources and artifact hashes are documented in
[vendor/libav](../site/play/vendor/libav/README.md). Both generated loaders and
both WASM binaries were independently rebuilt byte-for-byte. The
[performance report](../tests/bench/libav/README.md) records gains, regressions
and the corrected AAC-ELD parameter diagnosis; the historical URL audio fallback used these builds locally; current URL playback uses AVPlayer resources; it is not a published release.

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

## Current browser deployment

Browser v90 and beta.21/code63 are published together; see [beta.21 release](#beta21-release). The v89 record below describes its earlier web-only rollout.

Browser **v89** is the web-only audio rollout: NetEq-first Opus, libav.js AAC-LC/
ELD/ALAC, continuous 48 kHz conversion, software capability negotiation and URL
fallback. Local Node and real Chromium/production-CSP, offline and site checks
are recorded in [Testing](Testing.md#browser-wasm-verification). CI and APK builds
are explicitly skipped. Android remains beta.20/code62. Publish via the existing
Pages workflow after a `[skip ci]` commit; verify public v89 and runtime hashes.
The older browser/APK records below describe their original releases.

Verified 2026-10-26: runtime commit `b3d387ca9a31eb9efad91471f278fc0a881ec59e`
was published by [Pages run 40261108564](https://github.com/uJZk/TiPlay/actions/runs/40261108564).
All **89** public runtime/Service Worker files matched the assembled local bytes;
module-script MIME types were correct. Both page and cache report **v89**. The
follow-up fixes ended raw-PCM epoch revival without blocking a distinct mode or
an explicit producer reset. The final local suite passes **729** tests; actual
Chromium software/Worklet/URL, clock-jump and offline checks pass. No Android CI
run was created for this runtime commit, and no APK was compiled or published.



The formal root webpage **v87** is deployed from
`905f99c66d451190cb71d5ddf9be4bf30e0dcda8`. The manually dispatched
[Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/40178657118) succeeded.
Public verification at **2026-10-25 17:01:59 UTC+08:00** compared all **185** files
(**11,908,440 bytes**) with the committed assembly: every byte matches,
all **89** Service Worker entries are present, all five WASM binaries use
`application/wasm`, and no file redirects. The new audio evidence module is in the
runtime cache. Publication commits use `[skip ci]` at the user's request; this is
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

Published [TiPlay 0.2.20-beta.21](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.21), code **63**, browser **v90**, at **2026-10-26 17:20:40 UTC+08:00**. The user explicitly requests signed beta APK publication and the matching browser deployment. The existing signed release workflow runs Release lint/build, exact runtime identity checks, signing and attachment generation; full Android CI remains explicitly skipped.

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

Beta.22/code64 adds CarPlay Video in Car to phone + browser mode on the beta.21
base, retaining browser v90 and its AVPlayer URL pipeline. The implementation,
LIVI reference and remaining iPhone/vehicle checks are in
[AirPlay](AirPlay.md#carplay-video-in-car-in-the-browser). Parking-state
integration is deferred by user request; no gear signal is required in this build.
FairPlay video remains unsupported.

The user explicitly requests skipping CI. The release is built locally with
`:mobile:lintRelease :mobile:assembleRelease`, using the configured signing key
and the unchanged two runtime assets extracted from the hash-verified DiPlay
0.2.18 APK. Publication includes the signed APK, exact build-commit source ZIP
and SHA256SUMS.txt. The download-page version is regenerated for beta.22; the
browser runtime remains v90. The existing Pages workflow is used only to publish
the updated download metadata. Full Android CI is not dispatched.

Local verification passed: 75 targeted Android tests, mobile Release lint and
signed build, nine release-draft checks, four download-page tests, two site-layout
checks, public-tree/cache checks, package/code64/non-debug validation, signer
continuity, exact runtime-asset comparison and four-ABI ELF64/ZIP 16 KiB alignment.
Full CI was skipped as requested; no physical iPhone/vehicle acceptance is claimed.
