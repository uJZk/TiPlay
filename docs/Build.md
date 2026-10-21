# Build TiPlay

Build the `:mobile` Android phone receiver for the car browser. Other applications remain for upstream compatibility. Run commands from the repository root; Windows uses `gradlew.bat`. See [Windows containers](Wlsc.md) for that environment.

## Toolchain and source checks

Use the Gradle wrapper and the JDK, Node and Android SDK/NDK packages in the [Android workflow](../.github/workflows/android.yml). Set `JAVA_HOME` and `ANDROID_HOME`, or put `sdk.dir=/absolute/sdk/path` in untracked `local.properties`. Android Studio must use the same Gradle JDK and the `mobile` run configuration.

The Android/browser product version comes from `tiplayVersionName` and
`tiplayVersionCode` in [gradle.properties](../gradle.properties). The working candidate
is **0.2.20-beta.10** (code **52**); the latest published prerelease remains
**0.2.20-beta.9** (code **51**) until the release checks below are completed. Run
`python3 scripts/build_site.py` after a version change to regenerate `app-version.js`.
The browser diagnostic/cache revision is independent of the product version;
the working page uses **v76** with WebRTC DataChannel as the formal live-media path.
The signed beta.9 APK and its paired v75 root deployment remain pinned to the
published source verified below; the current working changes are not yet released.
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

The historical TiPlay 0.2.16 record (version code 39) was built from `c80faa91ff29f58d07f855c19a51e0b6bfe3a852`.
Its APK SHA-256 is `4d32a780b33fb9662beaeffa711c6703ffd1ba591afbe31daf08617533394a42`.
The APK signature matches 0.2.15, its source ZIP matches that commit's `git archive`,
and both runtime identity files match the pinned inputs used by 0.2.15. That release record
includes the source archive and `SHA256SUMS.txt`. Its former release/download URL
returned 404 during beta.6 verification. The current release record is below. Historical
automated checks passed; physical
phone/vehicle, system authorization and VPN acceptance remain in [Testing](Testing.md)
and [Todo](Todo.md).

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

The working candidate is **TiPlay 0.2.20-beta.10**, code **52**, paired with webpage
**v76**. Its signed release and root deployment are pending the final verification
below. Until publication, the latest distributed APK remains
[beta.9](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.9), code51/page v75.
Download entries retain the version-independent
[GitHub Releases index](https://github.com/uJZk/TiPlay/releases).

The candidate prevents an isolated contradictory output timestamp from manufacturing
live-audio clock recoveries, preserves mirror AAC NoData source samples through RTP
ordering and browser output, and decodes bounded inline subtitles locally instead of
blocking the serialized iPhone loader. Source/device oscillator endpoint comparisons
retain their original ranges without floating-point endpoint rejection. New logs
explain source-fit status/noise, actual render quantum, native buffered-music anchors,
HTTP failure stages and FCUP deadline ownership while preserving existing budgets.
See [Diagnostics](Diagnostics.md), [AirPlay](AirPlay.md) and the
[parameter evidence and remaining work](Todo.md#playback-parameter-evidence).

### Source validation and remaining scope

| Check | Evidence for this candidate |
| --- | --- |
| Browser unit suite | **643 passed** on Node 22.23.3. |
| Scoped Android/JVM tests | **158 passed** across 13 actual classes, including resource size/deadline boundaries, RTP silence ordering, diagnostic budgets and native anchor timing. |
| Phone debug APK | Source assembly passed with beta.10/code52; signed APK provenance is checked separately. |
| Version/site preflight | **9** release-draft and **2** site tests plus public-tree/diff checks passed. |
| Complete browser page / real media | **90 checks passed** with the explicit desktop software decoder override. Native AAC/software ELD continuity, shared clocks and MP4/HLS passed on the final release source; shared-clock runtime hashes were unchanged. |
| Complete Android CI | Skipped at the user's explicit request; scoped checks do not replace it. |
| Signed release / root deployment | Pending; publication requires independent APK/source/attachment and deployed-file checks. |

CarPlay touch/non-touch and mirror clicks, occasional stutter and MiniBili startup
still need phone/vehicle retesting; this candidate does not establish complete physical
resolution. Desktop software decoding cannot identify the vehicle hardware decoder,
speaker/panel latency or acoustic quality. Exact noise-gate/history/socket-expiry
validation and empirical parameter calibration remain in Todo. New fields cannot
reconstruct evidence missing in older captures. Debug raw capture still has synchronous
disk backpressure. Non-1x tempo output retains rounded sample counts; sample-preserving
short-source signal claims remain at 1x. Preserve these limits when interpreting tests.

### Previous release provenance

[Beta.9](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.9), code **51** /
page **v75**, was published at **2026-10-21 02:11:40 UTC** from
`35eb9976a8c95f234b9524458cd64b4783ace505`. Its actual published APK SHA-256 is
`67df3f7b97699c2572e7475eef0d937b96731521c517303b5cdeb29f595bbabc`
(101,028,133 bytes); it supplies the independent signing/runtime compatibility
reference for this candidate. The verified signing certificate SHA-256 is
`abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`.
Runtime identity provenance remains the hash-pinned upstream APK described above.
Earlier detailed release records remain in Git and do not validate this candidate.

## Updating an installed app

Select the device with `adb -s <serial>`. Pull the installed APK using `pm path <application-id>` and compare its application ID and signing fingerprint with the candidate. A different ID installs separately; a different signing key cannot update the existing package. Preserve settings by keeping both and using `adb -s <serial> install -r <apk>`; do not uninstall to bypass a mismatch.

If preserving the runtime identity, also compare both `offline-mfi` files byte for byte. An installed APK can supply that identity, but cannot supply the Android signing private key. Confirm the installed version/update time, launch the declared activity and check new application crashes. Installation alone does not validate iPhone or vehicle playback.
