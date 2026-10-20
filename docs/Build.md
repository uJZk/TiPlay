# Build TiPlay

Build the `:mobile` Android phone receiver for the car browser. Other applications remain for upstream compatibility. Run commands from the repository root; Windows uses `gradlew.bat`. See [Windows containers](Wlsc.md) for that environment.

## Toolchain and source checks

Use the Gradle wrapper and the JDK, Node and Android SDK/NDK packages in the [Android workflow](../.github/workflows/android.yml). Set `JAVA_HOME` and `ANDROID_HOME`, or put `sdk.dir=/absolute/sdk/path` in untracked `local.properties`. Android Studio must use the same Gradle JDK and the `mobile` run configuration.

The Android/browser product version comes from `tiplayVersionName` and
`tiplayVersionCode` in [gradle.properties](../gradle.properties). Release preparation
targets **0.2.20-beta.7** (code **49**), following beta.6/code48. Run
`python3 scripts/build_site.py` after a version change to regenerate `app-version.js`.
The browser diagnostic/cache revision is independent of the product version;
this release targets **v73** with WebRTC DataChannel as the formal live-media path.
The deployment replaces `https://ujzk.github.io/TiPlay/` and deletes the
independent `/webrtc/` subsite without an alias or redirect; the APK defaults to the
root. The beta record below distinguishes completed source checks from pending
signed artifacts, exact build commit/checksums and deployment verification. Published
download links must identify the verified release. Debug APK metadata retains its diagnostic suffix.

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
returned 404 during beta.6 verification. Current release preparation is recorded below. Historical
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

The next release target is **TiPlay 0.2.20-beta.7**, version code **49**, with
browser cache/diagnostic revision **v73**. The user authorized the beta APK and
necessary root-page update. **Signing, release publication and deployment have not
yet been verified for this version.** The intended tag is `v0.2.20-beta.7`; a planned
name is not evidence that a tag, attachment or deployment exists.

This release retains beta.6's reliable ordered WebRTC/SRP transport, independent
live audio/video clocks and single formal page at `https://ujzk.github.io/TiPlay/`.
It adds reproducible URL-casting recovery and diagnostic fixes:

- The existing Play control resumes the URL engine's AudioContext within trusted
  user activation. Readiness/play intent no longer substitutes for actual clock
  progress, and pending resume/gesture state remains observable.
- Video admission includes the held picture and replacement headroom. A limiting
  pending read can use existing playable coverage after the normal wait, rather
  than deadlocking below an unreachable watermark. Valid still-image/VFR gaps
  retain the preceding picture; long audio introductions generate bounded silence.
- Errors preserve the safe state before cleanup and separately report actual
  application ownership afterwards. Resource open/transfer terminals distinguish
  upstream readiness, completed local writes, unknown partial writes and browser
  delivery that has not been established.
- Four-scenario diagnostics expose the actual applied plan, used margin, capacities,
  interaction counters and source-clock freshness. Estimator observation age and
  selected-anchor age remain separate. These are read-only observations, not new
  profile tuning or proof of hardware decoding/physical latency.

The 750/1500 ms URL watermarks remain targets subject to actual coverage and
application budgets. Touch affects only live video; its target is forced to zero,
so the profile's 8 ms metadata margin is not an actual used margin. The 300 ms live
limit remains a software mapping boundary. See [AirPlay](AirPlay.md),
[Diagnostics](Diagnostics.md) and the [WebRTC roadmap](WebRTC-roadmap.md) for the
contracts and measured limits.

### Source validation and remaining scope

| Check | Evidence for this change |
| --- | --- |
| Full browser unit suite | **528 passed**. This is source-level browser coverage, not a signed-APK or vehicle test. |
| Version/site preflight | **29** selected Node checks, **9** release-draft checks, **2** site checks and the public-tree scan passed. These are scoped preparation checks, not additional full-suite runs. |
| Final targeted Android/JVM run | **31 passed** in the last scoped run. |
| Targeted Android/JVM coverage across rounds | **121 distinct tests** across multiple rounds. This overlaps the last 31 and is not one clean full-suite run of the final tree. |
| Phone debug APK | Debug build passed; it does not establish release signing or packaged runtime identity. |
| Actual captured-media replay | Passed before the final diagnostics-only changes. It establishes real compressed playback/gesture recovery at that earlier source state; it was not rerun on the final release artifact. |
| Complete Android CI | Skipped at the user's explicit request. Targeted checks and a debug build do not replace the full unit/lint/build command. |
| Signed release and deployed page | Pending the checks below. |

The recorded replay proves a matching failure mechanism, not the unique cause of
the field attempt. The capture also contains valid mirror and CarPlay windows;
capacity evictions, sparse source cadence and temporarily stale mappings have
separate evidence. No forwarded touch experiment establishes physical touch-policy
performance. New getters/logging do not change the clock-selection algorithm or
make inaccessible decoder/panel/speaker state observable.

### Pending artifact and deployment verification

| Item | Required evidence before marking verified |
| --- | --- |
| Build commit and release tag | Exact committed build SHA and tag `v0.2.20-beta.7`; pending. |
| Signed phone APK | Expected `TiPlay-0.2.20-beta.7.apk`; build/run, size, SHA-256, package/version and signature verification pending. |
| Matching source archive | Expected `TiPlay-0.2.20-beta.7-source.zip`; exact `git archive` comparison, size and SHA-256 pending. |
| Checksums and attachments | `SHA256SUMS.txt`, exact attachment set and independently fetched attachment digests; pending. |
| Signing/runtime provenance | Compare the APK certificate and both packaged runtime identity files with the intended verified inputs; pending. |
| Root webpage | Pages run/deployment SHA, actual `app-version.js` beta.7 metadata, v73 manifest/cache closure and deployed asset bytes; pending. |
| Publication | Prerelease status, tag target and beta.7 download links; pending. |

Keep signing material and runtime identities outside Git. The established signing
certificate fingerprint is recorded under historical provenance below; that history
does not verify a newly built APK. Follow the [signed release procedure](#signed-release)
for package/signature/runtime checks, source archives and checksums. Publication
records must use the actual beta.7 commit and run/artifact results, not beta.6 values.

Physical iPhone/Android/car acceptance remains incomplete: actual hardware decoding,
Shizuku-address host ICE, gear transitions, sustained thermal smoothness, HFP/SCO,
audio quality and acoustic/panel timing require device measurement. Known software
clock/output/filter bounds omit separately propagated upstream iPhone NTP-anchor
uncertainty; `within-bound` is not a physical latency certificate. See
[Testing](Testing.md) and [Todo](Todo.md).

### Retained experimental provenance

[TiPlay 0.2.20-beta.6](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.6)
was published with code **48** / page **v72**. The following values identify that
historical release only and are not beta.7 build or deployment evidence:

| Historical beta.6 item | Recorded value |
| --- | --- |
| Build commit | `a95ecb18cd65861d767484df81da7bf281c7dd3c` |
| APK SHA-256 | `b00d36221e18a91684826b4f806380d4a3df944fdb37afe7fd83971625c24588` |
| Source ZIP SHA-256 | `b05e2c58e39e051b769ae211c5331a5ee5a130c5e28c6f18edb2dd1ceb54fae3` |
| Signing certificate SHA-256 | `abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506` |
| Signed build / Pages | [Actions 39396954548](https://github.com/uJZk/TiPlay/actions/runs/39396954548) / [Actions 39396881145](https://github.com/uJZk/TiPlay/actions/runs/39396881145) |

Beta.6's runtime files matched the hash-verified pinned DiPlay 0.2.18 inputs, and
its signing certificate matched the independently downloaded beta.5 APK. Its source
ZIP matched the recorded build commit. These comparisons must be repeated for a new
release. The root promotion and deletion of the isolated `/webrtc/` page were beta.6
changes; beta.7 continues that single-root layout.

Earlier remote 0.2.21-beta.1/.2/.3 experiments used the independent `/webrtc/` page;
beta.3 was code **47** / page **v71**, from
`1592a061d8ad167fabe9d25f0c19ad8b21ca9183`, with APK SHA-256
`3dfb5bb3737088b35a7bf6e93643a70da0dd2109892e77701f7e2fb46c370c87`.
Their test counts and source-cadence observations are historical, not validation of
the combined beta.7 source. Code49 preserves Android update ordering while retaining
the requested 0.2.20 product-version line.

## Updating an installed app

Select the device with `adb -s <serial>`. Pull the installed APK using `pm path <application-id>` and compare its application ID and signing fingerprint with the candidate. A different ID installs separately; a different signing key cannot update the existing package. Preserve settings by keeping both and using `adb -s <serial> install -r <apk>`; do not uninstall to bypass a mismatch.

If preserving the runtime identity, also compare both `offline-mfi` files byte for byte. An installed APK can supply that identity, but cannot supply the Android signing private key. Confirm the installed version/update time, launch the declared activity and check new application crashes. Installation alone does not validate iPhone or vehicle playback.
