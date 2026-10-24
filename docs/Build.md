# Build TiPlay

Build the `:mobile` Android phone receiver for the car browser. Other applications remain for upstream compatibility. Run commands from the repository root; Windows uses `gradlew.bat`. See [Windows containers](Wlsc.md) for that environment.

## Toolchain and source checks

Use the Gradle wrapper and the JDK, Node and Android SDK/NDK packages in the [Android workflow](../.github/workflows/android.yml). Set `JAVA_HOME` and `ANDROID_HOME`, or put `sdk.dir=/absolute/sdk/path` in untracked `local.properties`. Android Studio must use the same Gradle JDK and the `mobile` run configuration.

The Android/browser product version comes from `tiplayVersionName` and
`tiplayVersionCode` in [gradle.properties](../gradle.properties). The latest published
prerelease is **0.2.20-beta.15** (code **57**). Run
`python3 scripts/build_site.py` after a version change to regenerate `app-version.js`.
The browser diagnostic/cache revision is independent of the product version;
the deployed page uses **v83** with WebRTC DataChannel as the formal live-media path.
The signed beta.15 APK and webpage v83 share the verified build commit recorded
below. Software checks are in [Testing](Testing.md#webrtc-integrated-acceptance).
The deployment replaces `https://ujzk.github.io/TiPlay/` and deletes the
independent `/webrtc/` subsite without an alias or redirect; the APK defaults to the
root. The beta record below identifies both build and deployment provenance. Every
language's download entry opens the GitHub Releases index without a version-specific
URL. Debug APK metadata retains its diagnostic suffix.

The working release candidate is **0.2.20-beta.16/code58**, with browser cache
**v84** for the simplified Diagnostics UI and receiver handoff status. Its
session/resource and single-initial-SETUP changes pass 908 browser tests and
4,189 Android unit tests, all required debug lint/build targets and four Chromium
presentation cases. The verified public deployment below remains v83 until the
candidate is published; the beta.15 provenance remains unchanged.

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

The verified browser revision is **v83**. Its source uses genuine WASM for
libsoxr, AAC-ELD and bulk live-audio DSP, and SIMD SoundTouch for URL tempo.
It also removes live timing's dependence on the public `currentTime` getter;
the [clock roles](Browser-wasm.md#audio-clock-roles) distinguish render frames,
performance time, native output observations and URL graph coordinates.
The [verification record](Testing.md#browser-wasm-verification) covers source
builds and browser behavior. Public deployment and signed beta.15 package
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

The formal root webpage **v83** and signed **0.2.20-beta.15/code57** APK come
from `4cd5806257b35523ccc6b7224e17acce85d51873`. The
[Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/40053151725)
completed successfully. Every language's download entry opens the
version-independent [GitHub Releases index](https://github.com/uJZk/TiPlay/releases).

The browser uses genuine libsoxr, FDK AAC, bulk audio kernels and SIMD SoundTouch
WASM, with the [documented execution exceptions](Browser-wasm.md). Live timing
uses actual render frames and causal output observations; URL audio completion
follows native node completion. The five WASM binaries are unchanged from v82
and reproduce byte-for-byte. All **150** checked browser inputs remain identical
after normalizing the three version-bearing JavaScript files.

Independent public verification completed at **2026-10-24 10:12:57 UTC+08:00**:
all **182** files (**11,866,515 bytes**) match the committed assembly, all **86**
Service Worker entries are available, and all **5** WASM binaries use
`application/wasm`. The **11** ChatGPT v2 files retain their prior bytes, all
**8** download languages use the Releases index, and the **10** checked removed
paths return direct 404, including the old libsoxr asm.js engine and wrapper
generator. All **193** URL checks pass without redirects or retries.

## Beta release

Published [TiPlay 0.2.20-beta.15](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.15),
code **57**, is prerelease **422463974**, published at **2026-10-24 10:32:06 UTC+08:00**.
The APK, matching committed source ZIP and webpage v83 share build commit
`4cd5806257b35523ccc6b7224e17acce85d51873`. The
[signed workflow](https://github.com/uJZk/TiPlay/actions/runs/40053153040)
passed release lint/build and uploaded the three independently verified assets:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `TiPlay-0.2.20-beta.15.apk` | 101,060,905 | `6919f19b7f7e458fa20074df16fcf98b01883bef3ec90739917646176eb5e78a` |
| `TiPlay-0.2.20-beta.15-source.zip` | 20,854,178 | `34ac836c798be3c94f7f9c33bce8a6098d109620fd2b6b32da271b1098be87cc` |
| `SHA256SUMS.txt` | 191 | `d11171e9ca79717220bccd02773f32b25a06e5c485d4dd22b2e61504d918fd42` |

Publication preserves all three verified asset IDs, lengths and digests. Anonymous
release/index/checksum GETs and APK/source HEADs pass at **2026-10-24 10:33:56 UTC+08:00**:
checksum bytes and final content lengths match, the release is a public prerelease,
and its lightweight tag points to the exact build commit.

This release includes the genuine browser WASM migration, actual-frame clock
validation, native URL-completion handling, reduced Android raw-capture encoding
allocation and bounded tempo-backend diagnostics. Dynamic rate compensation
retains one bounded controller; unknown output timing does not become a verified
source deadline. See [clock roles](Browser-wasm.md#audio-clock-roles) and
[diagnostics](Diagnostics.md).

### Verification

The functional source passed **893 browser tests**, **4,131 Android unit tests**,
all three required debug lint/build targets and native libsoxr checks. The
versioned build repeats all **893** browser tests, production-CSP Chromium 151
media-clock output and v83 offline-cache checks. The normal browser run retains
all **85** runtime hashes; offline reload verifies **86** cache entries and
executes all five WASM binaries. Earlier faulty-`currentTime` runs cover frozen,
slow, jumping and throwing getters on the same functional code. The versioned
[Android CI run](https://github.com/uJZk/TiPlay/actions/runs/40053151756)
passes all required Android checks and WASM reproduction; detailed software scope is in
[Testing](Testing.md#browser-wasm-verification).

The APK is non-debug `com.ujzk.tiplay`, minimum SDK **28**, target SDK **37**.
Its signing certificate matches published beta.14, SHA-256
`abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`.
Exactly two runtime identity files match beta.14 and the pinned DiPlay 0.2.18
inputs byte-for-byte. The source ZIP matches `git archive` and excludes runtime
credentials; see the existing [experimental identity notice](Third-party-notices.md#experimental-authentication-data).

All four supported ABIs (`arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`) contain nine
native libraries each. All **18** supported 64-bit ELF libraries meet 16 KiB LOAD
alignment; `zipalign -P 16` passes. All **7** packaged JNA libraries match beta.14,
including three inherited ABI files. Inspection of all **5** DEX files confirms
the new ByteBuffer Base64/buffered capture path and tempo-backend enum/report
field; the actual beta.14 APK is the negative control for both changes.

### Remaining scope

Real-car CarPlay, complete Bluetooth audio and iPhone AirPlay acceptance remain
pending. Software checks do not establish speaker/panel latency or elimination
of every audible click. The older approximately 1.8-second clock-progress
difference still has no confirmed cause. Debug capture retains disk backpressure.
Physical playback and parameter work remain in [Todo](Todo.md#browser-and-carplay-audio);
the independent [Cloudflare comparison and uploads](Todo.md#cloudflare-workers-audio-comparison)
remain unimplemented. The ChatGPT diagnostic page remains independent v2.

### Previous release provenance

- [Beta.14](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.14), code56/v80,
  prerelease **421892511**, was published **2026-10-23 13:50:47 UTC** from
  `59efe314ae8e1a4b21b86c0feb451c624ff13e4b`.
  [Signed workflow](https://github.com/uJZk/TiPlay/actions/runs/39962490704) and
  [original Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/39962485128)
  succeeded. Its **101,060,901-byte** APK SHA-256 remains
  `d8c5e1aaa1ee239fbcfe27d05178270da07a86136cd9154f93f58183932418c4`.
- [Beta.13](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.13), code55/v79,
  prerelease **421554656**, was published **2026-10-23 07:34:49 UTC** from
  `70a86088e8ec57c1adb24045d28c1f06f9300f0f`.
  [Signed workflow](https://github.com/uJZk/TiPlay/actions/runs/39917075886) and
  [Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/39917163410)
  succeeded. Its APK SHA-256 remains
  `2b4161736d7bdcc0a0762af40d720468e72cdae7367042ca0fc3edf407235765`.

These published artifacts retain their original bytes. Earlier detailed evidence,
including beta.14 source/checksum digests and its original test scope, remains in Git.

## Updating an installed app

Select the device with `adb -s <serial>`. Pull the installed APK using `pm path <application-id>` and compare its application ID and signing fingerprint with the candidate. A different ID installs separately; a different signing key cannot update the existing package. Preserve settings by keeping both and using `adb -s <serial> install -r <apk>`; do not uninstall to bypass a mismatch.

If preserving the runtime identity, also compare both `offline-mfi` files byte for byte. An installed APK can supply that identity, but cannot supply the Android signing private key. Confirm the installed version/update time, launch the declared activity and check new application crashes. Installation alone does not validate iPhone or vehicle playback.
