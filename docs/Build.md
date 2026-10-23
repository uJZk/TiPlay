# Build TiPlay

Build the `:mobile` Android phone receiver for the car browser. Other applications remain for upstream compatibility. Run commands from the repository root; Windows uses `gradlew.bat`. See [Windows containers](Wlsc.md) for that environment.

## Toolchain and source checks

Use the Gradle wrapper and the JDK, Node and Android SDK/NDK packages in the [Android workflow](../.github/workflows/android.yml). Set `JAVA_HOME` and `ANDROID_HOME`, or put `sdk.dir=/absolute/sdk/path` in untracked `local.properties`. Android Studio must use the same Gradle JDK and the `mobile` run configuration.

The Android/browser product version comes from `tiplayVersionName` and
`tiplayVersionCode` in [gradle.properties](../gradle.properties). The latest published
prerelease is **0.2.20-beta.12** (code **54**). Run
`python3 scripts/build_site.py` after a version change to regenerate `app-version.js`.
The browser diagnostic/cache revision is independent of the product version;
the deployed page uses **v78** with WebRTC DataChannel as the formal live-media path.
The signed beta.12 APK and deployed v78 page use the same verified build commit below;
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

Published [TiPlay 0.2.20-beta.12](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.12),
code **54**, is paired with deployed webpage **v78**. Prerelease **421352301** was
published at **2026-10-23 01:12:19 UTC** after independent artifact and deployment checks.
Download entries retain the version-independent
[GitHub Releases index](https://github.com/uJZk/TiPlay/releases).

This release recovers the browser picture when CarPlay ownership returns without a
usable main-screen stream. It waits the existing two-second reconnect interval,
rechecks the same owner/session and preserves timely or in-flight SETUP. Settings,
browser absence and new loans defer or cancel recovery. Sparse screen-data boundaries
distinguish display-stream loss from peer control shutdown.

Debug audio evidence retains the actual source-deadline rejection across recovery
and rejects stale playback-generation reports. Live and URL audio share the optional
`AudioContext.playbackStats` reader, preserving unavailable values and separating
browser rendering counters from application scheduling. Capture timing includes
completed and failed append lock-wait/append totals without per-packet payload copies.
Exact timestamp, recovery, profile and URL scheduling boundary checks preserve the
existing playback parameters.
See [Diagnostics](Diagnostics.md), [AirPlay](AirPlay.md) and the
[parameter evidence and remaining work](Todo.md#playback-parameter-evidence).

### Source validation and remaining scope

| Check | Evidence for this release |
| --- | --- |
| Browser unit suite | **737 passed**, including retained deadline evidence, playback-generation rejection, shared renderer statistics and exact timestamp/recovery/profile/URL scheduling boundaries. |
| Scoped Android/JVM tests | **172 passed** across 12 actual classes, including returned-screen recovery, capture lock-wait/failed-append timing and fixed diagnostic schemas. |
| Phone debug APK | Functional source assembly passed before the metadata increment; published beta.12/code54 package, non-debug state and provenance were independently checked in the signed APK. Functional source hashes matched after normalizing version fields. |
| Parameter mutations | All **17** deliberate parameter/comparison mutations were caught. These prove software boundaries; vehicle calibration remains open. |
| Version/site preflight | After beta.12/code54/v78 metadata generation: 9 release-draft and 2 root-site checks, 23 browser diagnostic cases and 34 native diagnostic cases passed; public-tree/diff checks passed. These supplement the functional suites above. |
| Real browser / native JNI | Real Chromium media checks and native JNI boundary checks passed. The production-CSP shared-clock harness observed optional renderer statistics, nonzero PCM and independent CarPlay/mirror references; all **61** runtime source hashes remained unchanged during its run. |
| Complete Android CI | Skipped at the user's explicit request; scoped checks do not replace it. |
| Signed release / root deployment | Release lint/build and independent attachment/package/signing/runtime/source checks passed. All **188** root-site URL checks matched; all **5** unauthenticated release/download checks passed. |

### Artifact and deployment evidence

The signed APK, byte-identical `git archive` source ZIP and deployed page came from
`9e21deb16faaf483deb16d66cfe9bf6a09c6567b`, tagged `v0.2.20-beta.12`.
The [signed workflow](https://github.com/uJZk/TiPlay/actions/runs/39881628977) and
[Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/39881632648) both succeeded.
Publication preserved the three independently downloaded assets:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `TiPlay-0.2.20-beta.12.apk` | 101,060,901 | `fb50f29bb81a6d7d438de8ce4de4faf19844fde2e8b9a1e80a62cf092c86a836` |
| `TiPlay-0.2.20-beta.12-source.zip` | 20,856,070 | `df016cb06d5d8917ef461fe7a5e395fee528081e27c8521e892b3d3778ac1e15` |
| `SHA256SUMS.txt` | 191 | `1012f7de35188682dd327c56416dc009093b58c540ee28438afedc2c58ee5b1a` |

The non-debug APK uses `com.ujzk.tiplay` and matches beta.11's signing certificate,
SHA-256 `abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`.
Both runtime identity files match the pinned DiPlay 0.2.18 inputs and published
beta.11 byte for byte; source contains no runtime identity, signing credentials or
field captures. RTC libraries cover `arm64-v8a`, `armeabi-v7a`, `x86` and `x86_64`.
All 18 supported 64-bit ELF libraries passed 16 KiB LOAD alignment, and APK zip
alignment passed. All seven packaged JNA libraries are byte-identical to beta.11,
including the three retained legacy ABI libraries. DEX inspection found
`RawCaptureTiming` and the new returned-screen, source-deadline and render-underrun
implementation markers.

The [root website](https://ujzk.github.io/TiPlay/) matched 138 assembled files across
188 URL checks, including the 106-entry cache manifest and new shared audio-statistics
helper. All eight language download entries open the Releases index; all ten checks
of removed independent WebRTC paths
returned direct 404 without redirects. Five unauthenticated public checks passed:
GET of the release page, Releases index and checksum file, and HEAD of APK/source
downloads with their verified lengths. The public checksum file matched the
independent download exactly.

### Remaining scope

CarPlay touch/non-touch, mirror and URL audio clicks remain unresolved; occasional
stutter, MiniBili startup and returned-screen recovery still need phone/vehicle
retesting. The beta.11 field capture retains live audio recoveries, and zero recorded
URL scheduling faults do not establish healthy physical output. Desktop decoding and
browser renderer statistics cannot identify vehicle decoder behavior, speaker/panel
latency or acoustic quality; optional statistics can update slowly or pause when
hidden. Software boundary checks do not calibrate vehicle parameters. Android socket
expiry, actual screen-loan grant/return and empirical parameter calibration remain
in [Todo](Todo.md). Older captures cannot gain the added timing, deadline or screen
boundaries retroactively. Debug raw capture retains synchronous disk backpressure.
Non-1x tempo output retains rounded sample counts; sample-preserving short-source
signal claims remain at 1x.

### Previous release provenance

[Beta.11](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.11), code **53** /
page **v77**, was published at **2026-10-21 15:56:45 UTC** as release **419756669**.
Its signed APK, exact `git archive` source ZIP and deployed root page came from
`f139a0e05f987caaa8a4ebe017cba41ce6c778fd`, tagged `v0.2.20-beta.11`.
The [signed workflow](https://github.com/uJZk/TiPlay/actions/runs/39628681069) and
[Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/39628675181) succeeded;
independent checks covered all three attachments and public downloads, 186 deployed
URLs, the 105-entry cache manifest and ten removed-path 404s. All eight language
download entries opened the Releases index.

| Published beta.11 asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `TiPlay-0.2.20-beta.11.apk` | 101,044,521 | `a8044db2b79177ace12f156e1cbb0bb8b5dfb29cd812682958b39277aeb89e95` |
| `TiPlay-0.2.20-beta.11-source.zip` | 20,826,402 | `4bec88ec0a65078f5584e1ca7abb09de8b798c973c14e5a4c5d83177b0cc7380` |
| `SHA256SUMS.txt` | 191 | `763985ef55858b64e49285226d9d11aec79c06206da1abddeb7e2e79275d6a25` |

Beta.12's signing, runtime identity and all seven JNA libraries were independently
compared with that non-debug `com.ujzk.tiplay` APK. Historical beta.11 test results
remain evidence for its own build; earlier detailed release records remain in Git.

## Updating an installed app

Select the device with `adb -s <serial>`. Pull the installed APK using `pm path <application-id>` and compare its application ID and signing fingerprint with the candidate. A different ID installs separately; a different signing key cannot update the existing package. Preserve settings by keeping both and using `adb -s <serial> install -r <apk>`; do not uninstall to bypass a mismatch.

If preserving the runtime identity, also compare both `offline-mfi` files byte for byte. An installed APK can supply that identity, but cannot supply the Android signing private key. Confirm the installed version/update time, launch the declared activity and check new application crashes. Installation alone does not validate iPhone or vehicle playback.
