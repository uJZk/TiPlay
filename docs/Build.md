# Build TiPlay

Build the `:mobile` Android phone receiver for the car browser. Other applications remain for upstream compatibility. Run commands from the repository root; Windows uses `gradlew.bat`. See [Windows containers](Wlsc.md) for that environment.

## Toolchain and source checks

Use the Gradle wrapper and the JDK, Node and Android SDK/NDK packages in the [Android workflow](../.github/workflows/android.yml). Set `JAVA_HOME` and `ANDROID_HOME`, or put `sdk.dir=/absolute/sdk/path` in untracked `local.properties`. Android Studio must use the same Gradle JDK and the `mobile` run configuration.

The Android/browser product version comes from `tiplayVersionName` and
`tiplayVersionCode` in [gradle.properties](../gradle.properties). The working release
candidate is **0.2.20-beta.11** (code **53**); the latest published prerelease remains
**0.2.20-beta.10** (code **52**) until the checks below are completed. Run
`python3 scripts/build_site.py` after a version change to regenerate `app-version.js`.
The browser diagnostic/cache revision is independent of the product version;
the candidate page uses **v77** with WebRTC DataChannel as the formal live-media path.
The published beta.10 APK and deployed v76 page remain pinned to their verified build
commit below; candidate playback, loading-indicator and screen-loan fixes are not yet
distributed. Software checks are in [Testing](Testing.md#webrtc-integrated-acceptance).
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

The release candidate is **TiPlay 0.2.20-beta.11**, code **53**, paired with webpage
**v77**. Signed-artifact verification, publication and root deployment are pending.
Until those complete, the distributed version remains
[beta.10](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.10), code52/page v76.
Download entries retain the version-independent
[GitHub Releases index](https://github.com/uJZk/TiPlay/releases).

The candidate preserves an applied device-rate correction when new output-timestamp
pairs confirm a changed pipeline delay without disproving that rate. It retains
recovery for genuine large changes and stops idle guidance from manufacturing
source-deadline recovery counts. Normal worklet feedback carries actual render-block
sizes; larger blocks expand the mixing buffer only when needed. Superseded delay-plan
activations no longer accumulate during same-clock bursts. URL casting shows loading
and Stop before its first resource response, with owner-safe handoff and failure
cleanup. Screen-loan writes reconcile synchronous stop/restart requests and retain
sparse semantic state/close evidence. Attempted device-fit noise is logged separately
from retained accepted-fit uncertainty. Existing playback ranges, deadlines and
profile defaults remain unchanged.
See [Diagnostics](Diagnostics.md), [AirPlay](AirPlay.md) and the
[parameter evidence and remaining work](Todo.md#playback-parameter-evidence).

### Source validation and remaining scope

| Check | Evidence for this candidate |
| --- | --- |
| Browser unit suite | **688 passed** on Node 22.23.3, including real Soxr clock/rate recovery, exact parameter boundaries, 1024-frame output, delay-plan bursts and loading ownership. |
| Scoped Android/JVM tests | **116 passed** across 10 actual classes, covering screen-loan reconciliation/ownership, independent audio, returned keyframes, diagnostic fields/capture and real JVM HTTP read expiry. |
| Phone debug APK | Functional source assembly passed before the beta.11/code53 metadata increment; candidate package/version/provenance checks belong to the signed artifact verification. |
| Version/site preflight | After beta.11/code53/v77 metadata generation: 9 release-draft and 2 root-site checks, 28 browser diagnostic cases and 33 native diagnostic cases passed; public-tree/diff checks passed. These supplement the functional suites above. |
| Complete browser page / real media | **90 checks passed** with the explicit desktop software decoder override; real Chromium shared clocks and MP4/HLS passed. The three renderer/source cases verify visible loading before resource headers or player import. Final shared-clock runtime hashes were unchanged during its run. |
| Complete Android CI | Skipped at the user's explicit request; scoped checks do not replace it. |
| Signed release / root deployment | Pending; requires successful release lint/build, independent attachment/package/signing/runtime/source checks and deployed-file/public-download verification. |

### Remaining scope

CarPlay touch/non-touch and mirror clicks, occasional stutter and MiniBili startup
still need phone/vehicle retesting; this candidate does not establish complete physical
resolution. Desktop software decoding cannot identify the vehicle hardware decoder,
speaker/panel latency or acoustic quality. Software boundary checks do not calibrate
the profile defaults for a vehicle. Android socket expiry, timestamp plausibility
margins, actual screen-loan grant/return and empirical parameter calibration remain
in Todo. New fields cannot
reconstruct evidence missing in older captures. Debug raw capture still has synchronous
disk backpressure. Non-1x tempo output retains rounded sample counts; sample-preserving
short-source signal claims remain at 1x. Preserve these limits when interpreting tests.

### Previous release provenance

[Beta.10](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.10), code **52** /
page **v76**, was published at **2026-10-21 07:09:41 UTC** as release **419248548**.
Its signed APK, exact `git archive` source ZIP and deployed root page came from
`9eaac6e476b37c3f13fd910a6c31f6e46b90e54d`, tagged `v0.2.20-beta.10`.
The [signed workflow](https://github.com/uJZk/TiPlay/actions/runs/39558628003) and
[Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/39558627713) succeeded;
independent checks covered all three attachments and public downloads, 186 deployed
URLs, the 105-entry cache manifest and ten removed-path 404s. All eight language
download entries opened the Releases index.

| Published beta.10 asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `TiPlay-0.2.20-beta.10.apk` | 101,044,517 | `246786b5178a06725825b9d6c1b7292bf34ffed60120a4cd86051e763e813e90` |
| `TiPlay-0.2.20-beta.10-source.zip` | 20,796,659 | `0c968634482ef5b27487942f2b5513d1c420236468cf486e6b6b5e2c81e81e87` |
| `SHA256SUMS.txt` | 191 | `181be5a4f3bc220d37162ec9ff2a900a5391561a29a16940b81f982103c79877` |

That non-debug APK supplies the independent signing/runtime compatibility reference
for beta.11. Its package is `com.ujzk.tiplay`; the signing certificate SHA-256 is
`abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`.
Both runtime identity files match the pinned DiPlay 0.2.18 inputs. The four RTC ABIs,
18 supported 64-bit ELF libraries' 16 KiB LOAD alignment and APK zip alignment passed;
three retained legacy JNA libraries were byte-identical to beta.9. The source ZIP
contained no runtime identity or signing credentials. These historical checks do not
validate the candidate; earlier detailed release records remain in Git.

## Updating an installed app

Select the device with `adb -s <serial>`. Pull the installed APK using `pm path <application-id>` and compare its application ID and signing fingerprint with the candidate. A different ID installs separately; a different signing key cannot update the existing package. Preserve settings by keeping both and using `adb -s <serial> install -r <apk>`; do not uninstall to bypass a mismatch.

If preserving the runtime identity, also compare both `offline-mfi` files byte for byte. An installed APK can supply that identity, but cannot supply the Android signing private key. Confirm the installed version/update time, launch the declared activity and check new application crashes. Installation alone does not validate iPhone or vehicle playback.
