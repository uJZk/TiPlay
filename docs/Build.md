# Build TiPlay

Build the `:mobile` Android phone receiver for the car browser. Other applications remain for upstream compatibility. Run commands from the repository root; Windows uses `gradlew.bat`. See [Windows containers](Wlsc.md) for that environment.

## Toolchain and source checks

Use the Gradle wrapper and the JDK, Node and Android SDK/NDK packages in the [Android workflow](../.github/workflows/android.yml). Set `JAVA_HOME` and `ANDROID_HOME`, or put `sdk.dir=/absolute/sdk/path` in untracked `local.properties`. Android Studio must use the same Gradle JDK and the `mobile` run configuration.

The Android/browser product version comes from `tiplayVersionName` and
`tiplayVersionCode` in [gradle.properties](../gradle.properties). The latest published
prerelease is **0.2.20-beta.13** (code **55**). Run
`python3 scripts/build_site.py` after a version change to regenerate `app-version.js`.
The browser diagnostic/cache revision is independent of the product version;
the deployed page uses **v79** with WebRTC DataChannel as the formal live-media path.
The signed beta.13 APK and deployed v79 page use the same verified build commit below;
subsequent documentation commits do not change the artifacts or tag. Software checks
are in [Testing](Testing.md#webrtc-integrated-acceptance).
The deployment replaces `https://ujzk.github.io/TiPlay/` and deletes the
independent `/webrtc/` subsite without an alias or redirect; the APK defaults to the
root. The beta record below distinguishes the signed APK's build commit from the
webpage commit and records deployment verification separately. Every
language's download entry opens the GitHub Releases index without a version-specific
URL. Debug APK metadata retains its diagnostic suffix.

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

## Beta release

Published [TiPlay 0.2.20-beta.13](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.13),
code **55**, is paired with deployed webpage **v79**. Prerelease **421554656** was
published at **2026-10-23 07:34:49 UTC** after independent artifact and deployment checks.
Every language's download entry opens the version-independent
[GitHub Releases index](https://github.com/uJZk/TiPlay/releases).

This release fixes two independently reproduced live-audio waveform defects:
resuming an already faded tail applied its envelope twice, and voice transitions
instantly switched media gain between 1 and 0.2. CarPlay/mirror shared mixing now
continues the recovery envelope and uses the existing 5 ms fade for media ducking,
including voice tails. Actual fresh PCM, recovery tails and retired samples share
one source-deadline calculation; zero padding cannot age a short tail across a
larger render block. Debug retains rejected retired-tail epoch/generation and
source-age evidence separately from successor streams.

AirPlay URL video budgeting is **256 MiB**, as requested, retaining 32 queued
pictures and counting the held picture in byte ownership. CarPlay/mirror remain at
64 MiB. This capacity change is separate from live-audio repairs and cannot fix
sustained insufficient decoding throughput. The LIVI-based CarPlay borrowing and
session-practice work is explicitly deferred in [Todo](Todo.md#engineering-follow-up).
See [waveform verification](Testing.md#media-clock-and-continuous-audio-acceptance),
[Diagnostics](Diagnostics.md) and [AirPlay](AirPlay.md).

### Source validation and remaining scope

| Check | Evidence for this release |
| --- | --- |
| Browser unit suite | **777 passed** on the functional source; independent real-Soxr signal oracles cover recovery, ducking, source progress and legal/expired short tails through 64/128/256/1024-frame blocks. |
| Scoped Android/JVM tests | **22 audio-diagnostic tests passed** before the metadata update; the subsequent 40-case protocol/schema preflight includes those cases rather than adding 40 independent cases. |
| Version/site preflight | **9** release-draft, **2** root-site, **35** browser-diagnostic and **40** native cases across four classes passed. All **239** checked inputs were byte-identical after version normalization. |
| Real browser | Chromium 151 production-CSP media-clock checks passed through actual AudioWorklet output, independent CarPlay/mirror references, suspend/resume and worker/main Canvas; all **61** runtime source hashes remained stable during the run. |
| Signed release | Release lint/build and independent APK/source/checksum, package, signer, runtime and native-library checks passed. |
| Complete Android CI | Skipped at the user's explicit request; focused tests and release lint/build do not replace it. |
| Root deployment/public downloads | **188** URL checks accepted after the targeted recheck below; **10** removed paths returned direct 404 and **5** unauthenticated release/download checks passed. |

### Artifact and deployment evidence

The signed APK, byte-identical `git archive` source ZIP and deployed page came from
`70a86088e8ec57c1adb24045d28c1f06f9300f0f`, tagged `v0.2.20-beta.13`.
The [signed workflow](https://github.com/uJZk/TiPlay/actions/runs/39917075886) and
[Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/39917163410) both succeeded.
Publication preserved the three independently downloaded assets:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `TiPlay-0.2.20-beta.13.apk` | 101,060,905 | `2b4161736d7bdcc0a0762af40d720468e72cdae7367042ca0fc3edf407235765` |
| `TiPlay-0.2.20-beta.13-source.zip` | 20,873,583 | `46c91e8dbdb7b58e6eab6315c70b31f09bf7d00fdf391465b4163a351b24d6d0` |
| `SHA256SUMS.txt` | 191 | `19e7ba65d3f4fdafa1fafcde908c6fc257e07071b8d471533fe1461e7536d286` |

The non-debug APK uses `com.ujzk.tiplay` and matches published beta.12's signing
certificate, SHA-256
`abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`.
Both runtime identity files match the hash-pinned DiPlay 0.2.18 inputs and beta.12
byte for byte. Source excludes runtime identity, signing credentials and field
captures; the APK contains only the two intended runtime identity files. RTC
libraries cover `arm64-v8a`, `armeabi-v7a`, `x86` and `x86_64`. All **18** supported
64-bit ELF libraries passed 16 KiB LOAD alignment, and `zipalign -P 16` passed.
All **7** packaged JNA libraries match beta.12, including three inherited legacy ABI
files. DEX inspection confirms the seven retired-tail diagnostic fields and logger
class are present; marker presence does not establish physical playback quality.

The [root website](https://ujzk.github.io/TiPlay/) matches **138** assembled files,
including the **106**-entry cache manifest and eight Releases-index download pages.
The initial check matched 187/188 URLs; the unchanged `airplay-captions.js` returned
one HTTP 503. After the user's repair/retry instruction, its ordinary and exact
build-query URLs both returned HTTP 200 and the expected 1,510-byte SHA-256. The
original failure remains recorded; its upstream/intermediary origin is unknown.
No source change or second deployment was needed. The combined result accepts all
188 original checks, with two additional targeted requests. Removed independent
WebRTC paths return direct 404 without redirects. Public release/index/checksum
GETs and APK/source HEADs all passed with matching checksum bytes and lengths.

### Remaining scope

CarPlay touch/non-touch, mirror and separate URL-audio clicks still require actual
phone/vehicle retesting. These waveform fixes do not establish that all audible
clicks are eliminated. Beta.12 capture replay also identifies bursty mirror supply;
a full-10-ms-read startup guard was rejected because lower recovery counts came
with more emitted silence. Occasional stutter, sustained slow URL decoding,
MiniBili startup and screen borrowing/return remain in [Todo](Todo.md).

Software output timestamps, desktop decoding and optional renderer statistics do
not measure vehicle speakers, panel timing or optimal profile settings. Renderer
statistics can update slowly or pause while hidden. Android socket expiry and
empirical parameter calibration remain open. Old captures cannot gain new
diagnostic fields retroactively; Debug raw capture retains synchronous disk
backpressure. Non-1x tempo output retains rounded sample counts; sample-preserving
short-source claims remain at 1x. Reference-based screen-loan changes were skipped.

### Previous release provenance

[Beta.12](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.12), code **54** /
page **v78**, was published at **2026-10-23 01:12:19 UTC** as release **421352301**.
Its signed APK, exact source ZIP and deployed page came from
`9e21deb16faaf483deb16d66cfe9bf6a09c6567b`, tagged `v0.2.20-beta.12`.
The [signed workflow](https://github.com/uJZk/TiPlay/actions/runs/39881628977) and
[Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/39881632648) succeeded.
Its published APK SHA-256 is
`fb50f29bb81a6d7d438de8ce4de4faf19844fde2e8b9a1e80a62cf092c86a836`.
Beta.13's signer, both runtime files and all seven JNA libraries were independently
compared with that actual published APK. Historical validation remains evidence
for its own build; earlier detailed release records remain in Git.

## Updating an installed app

Select the device with `adb -s <serial>`. Pull the installed APK using `pm path <application-id>` and compare its application ID and signing fingerprint with the candidate. A different ID installs separately; a different signing key cannot update the existing package. Preserve settings by keeping both and using `adb -s <serial> install -r <apk>`; do not uninstall to bypass a mismatch.

If preserving the runtime identity, also compare both `offline-mfi` files byte for byte. An installed APK can supply that identity, but cannot supply the Android signing private key. Confirm the installed version/update time, launch the declared activity and check new application crashes. Installation alone does not validate iPhone or vehicle playback.
