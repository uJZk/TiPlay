# Build TiPlay

Build the `:mobile` Android phone receiver for the car browser. Other applications remain for upstream compatibility. Run commands from the repository root; Windows uses `gradlew.bat`. See [Windows containers](Wlsc.md) for that environment.

## Toolchain and source checks

Use the Gradle wrapper and the JDK, Node and Android SDK/NDK packages in the [Android workflow](../.github/workflows/android.yml). Set `JAVA_HOME` and `ANDROID_HOME`, or put `sdk.dir=/absolute/sdk/path` in untracked `local.properties`. Android Studio must use the same Gradle JDK and the `mobile` run configuration.

The Android/browser product version comes from `tiplayVersionName` and
`tiplayVersionCode` in [gradle.properties](../gradle.properties). The latest published
prerelease preparation is **0.2.20-beta.20** (code **62**); beta.19 remains published until the signed build is verified. Run
`python3 scripts/build_site.py` after a version change to regenerate `app-version.js`.
The browser diagnostic/cache revision is independent of the product version;
the current source uses **v87** (deployment pending) with WebRTC DataChannel as the formal live-media path.
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

Browser **v86** uses the WASM binaries reproduced for **v85**, unchanged by this
web-only release. Its source uses genuine WASM for
libsoxr, AAC-ELD and bulk live-audio DSP, and SoundTouch for live/URL tempo.
It also removes live timing's dependence on the public `currentTime` getter;
the [clock roles](Browser-wasm.md#audio-clock-roles) distinguish render frames,
performance time, native output observations and URL graph coordinates.
The [verification record](Testing.md#browser-wasm-verification) covers source
builds and browser behavior. Public deployment and signed beta.17 package
verification are recorded below.
See [execution boundaries](Browser-wasm.md), including measured cases that retain
native browser APIs or JavaScript.

The shipped binaries build from complete corresponding sources with WASI SDK 34
(Clang 23.1.0), Binaryen 132, CMake 4.1.2 and Ninja 1.13.0. Python 3.12+, `patch`
and the pinned tools are required. On Linux x86_64:

```sh
python3 -m pip install cmake==4.1.2 ninja==1.13.0
python3 scripts/soxr/prepare-toolchain.py work/wasm-toolchain
python3 scripts/build_wasm.py --check \
  --sdk work/wasm-toolchain/wasi-sdk-34.0-x86_64-linux \
  --binaryen work/wasm-toolchain/package
```

The downloader verifies toolchain archive hashes before extraction. `--check`
builds into a temporary directory and compares every shipped WASM byte, without
changing production files. Omit it to replace the artifacts intentionally;
individual build entry points are in `scripts/soxr/`, `scripts/aac-eld/`,
`scripts/soundtouch/` and `scripts/build_audio_core.py`. CI reproduces all modules
independently of Android compilation.

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

The formal root webpage **v86** comes from
`d9af73b082afc8db094c11ecdae9475d53501828`. The manually dispatched
[Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/40159166211) succeeded.
The publication commits use `[skip ci]`; Android CI was explicitly skipped for
this web-only update. The source passed 919 browser tests and deployment/cache/
public-tree checks before publication.

Independent public verification at **2026-10-25 11:42:27 UTC+08:00** compared all
**184** files (**11,884,504 bytes**) with the committed assembly: every byte
matches, all **88** Service Worker entries are present, all **5** WASM binaries
use `application/wasm`, and no file redirects. Every language's download entry
opens the version-independent [Releases index](https://github.com/uJZk/TiPlay/releases).
Detailed artifacts and logs remain outside Git. These checks do not establish
vehicle audio quality or physical speaker timing.

v86 holds the previously applied SoundTouch tempo after delay begins declining.
Contiguous playable PCM, including input already owned by DSP, determines whether
that rate is sustainable. Shortage, stalled progress, unavailable clocks and
braking near the target exit the hold. The [v86 release record](#browser-v86-release)
and [clock roles](Browser-wasm.md#audio-clock-roles) document its boundaries.

The signed beta.17/code59 APK, matching source ZIP and checksums remain unchanged,
built from `d8708330e6b86f33cb212a7af66651cc397efd10` with archived webpage v85.
All five WASM binaries retain their v85 bytes and prior reproducibility evidence.

## Beta release

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


## Beta.20 audio evidence release

Prepared beta.20/code62 with browser v87. The Debug-only bounded audio recorder,
validated raw evidence channel, pre-PCM16 native float scan, pre-clamp mixed-sum
measurement and evidence extraction tool are described in [Diagnostics](Audio-evidence.md).
This release adds evidence; it does not claim to fix or establish the cause of the
reported crackle. Browser speaker/backend timing and target-device CPU attribution
remain unmeasured.

The user explicitly requested skipping full CI. Validation is limited to targeted
browser/audio/schema/receiver tests, production-CSP Chromium media-clock output,
Python extraction/release/layout checks,
public-tree/cache checks and the signed release workflow. The full Android unit/lint
matrix is not an acceptance claim for this release. Publication details and artifact
hashes are recorded after the signed build completes.
