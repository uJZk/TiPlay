# Build TiPlay

Build the `:mobile` Android phone receiver for the car browser. Other applications remain for upstream compatibility. Run commands from the repository root; Windows uses `gradlew.bat`. See [Windows containers](Wlsc.md) for that environment.

## Toolchain and source checks

Use the Gradle wrapper and the JDK, Node and Android SDK/NDK packages in the [Android workflow](../.github/workflows/android.yml). Set `JAVA_HOME` and `ANDROID_HOME`, or put `sdk.dir=/absolute/sdk/path` in untracked `local.properties`. Android Studio must use the same Gradle JDK and the `mobile` run configuration.

The Android/browser product version comes from `tiplayVersionName` and
`tiplayVersionCode` in [gradle.properties](../gradle.properties). The current prerelease
is **0.2.20-beta.9** (code **51**), following beta.8/code50. Run
`python3 scripts/build_site.py` after a version change to regenerate `app-version.js`.
The browser diagnostic/cache revision is independent of the product version;
the page uses **v75** with WebRTC DataChannel as the formal live-media path.
Beta.9 signing/publication and root deployment are being verified; the previous
beta.8 record below remains pinned to its original v74 assets until that completes.
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

[TiPlay 0.2.20-beta.8](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.8),
version code **50**, was published as a prerelease at **2026-10-20 12:26:10 UTC**
(release ID **418367006**, not a draft). Its paired webpage is **v74** at
<https://ujzk.github.io/TiPlay/>. Signing, publication and root deployment are
verified below. Download entry points retain the
version-independent [GitHub Releases index](https://github.com/uJZk/TiPlay/releases).

This change prevents control/diagnostic work from blocking live media and preserves
URL audio sample continuity through packet trimming, partial scheduling and format
changes. Source-rate AudioContexts avoid independent cross-rate resampling at each
short node. Authentication, reliable ordered delivery, source/owner boundaries,
bounded credit and the four playback-profile priorities remain in place. The field
symptom is a playback-session interruption/reconnect; a browser-process crash was
not established. See [Diagnostics](Diagnostics.md), [AirPlay](AirPlay.md) and the
[WebRTC roadmap](WebRTC-roadmap.md).

### Source validation and remaining scope

| Check | Evidence for this change |
| --- | --- |
| Full browser unit suite | **561 passed** on Node 22.23.3. |
| Scoped Android/JVM tests | **52 passed** across seven actual classes, including nine queue/concurrency regressions and actual Standard-log admission. |
| Phone debug APK | Assembly passed; release signing/runtime are verified separately. |
| Real WebRTC transport | **17 checks passed** with actual Chromium PeerConnections. |
| Complete browser page | **90 checks passed** with an explicit test-only software decoder override; **4** default-policy checks correctly exposed desktop hardware unavailability. |
| Ordinary URL playback | 44.1 kHz AAC MP4/HLS playback, controls, seek/rate, cleanup and diagnostics passed. |
| Native offline audio signal | **4 rate combinations passed** against a whole-buffer reference. The 44.1 kHz graph followed by one continuous 48 kHz device-equivalent conversion had no zero frames and maximum step residual 1.49e-8 in the measured window. |
| Version/site preflight | After the metadata-only beta.8 version update, **36** selected browser tests, **9** release-draft and **2** site tests plus the public-tree scan passed. These overlap the full suite. |
| Complete Android CI | Skipped at the user's explicit request; these scoped checks do not replace it. |
| Signed release / root deployment | Release lint/build, independent APK/source/attachment checks and **181/181** deployed-file checks passed. |

Native/desktop evidence does not establish vehicle hardware decoding, physical
speaker/panel latency or long-session acoustic quality. Debug raw capture still
uses synchronous disk backpressure; queue isolation does not guarantee sustained
lossless capture on a slow/failing disk. Physical acceptance remains in
[Testing](Testing.md) and [Todo](Todo.md).

### Artifact and deployment evidence

| Item | Verified value |
| --- | --- |
| APK build / tag | `b62e843d873def57d94f9ac794bbcd383e8db301` / `v0.2.20-beta.8` |
| Website source | The same `b62e843d873def57d94f9ac794bbcd383e8db301`; later release-record documentation does not retag the build. |
| Signed workflow | [Actions 39420652253](https://github.com/uJZk/TiPlay/actions/runs/39420652253), release and draft jobs successful |
| APK | `TiPlay-0.2.20-beta.8.apk`, 101,011,749 bytes; SHA-256 `050b3ff8f4a2a34ef0feda88e7088e90d13b6d00de5fcc85f83269436274c75f` |
| Source archive | `TiPlay-0.2.20-beta.8-source.zip`, 20,717,337 bytes; SHA-256 `35a014dc75850b7a8f806ef44fec09fe09135991e6189b0166e895dcaa148c61` |
| Checksums | `SHA256SUMS.txt`, 189 bytes; SHA-256 `5b360cd162749c745fd8005649a9112c445d42007d2e0274973a1f4b151d943b` |
| Root webpage | [Actions 39420661572](https://github.com/uJZk/TiPlay/actions/runs/39420661572), successful at the website commit above |

Independent verification confirmed `com.ujzk.tiplay`, beta.8/code50 and
`debuggable=false`. Its verified certificate SHA-256 is
`abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`,
matching the actual hash-verified published beta.7 APK. The two runtime identity
files are byte-identical to the hash-pinned DiPlay 0.2.18 inputs. All four WebRTC
ABIs, all 18 supported 64-bit libraries' 16 KiB ELF LOAD alignment and
`zipalign -c -P 16 4` passed. The three retained legacy JNA library paths/bytes
also match beta.7; this does not establish support for additional WebRTC ABIs.

The source ZIP is byte-identical to `git archive` of the exact build commit. It
contains no `work/`, field-capture logs, signing inputs or credential containers.
The release contains exactly the APK, source ZIP and checksum file above; all
three independent downloads matched their remote sizes/digests and checksum
coverage before publication. Public-access verification is recorded separately
from these authenticated pre-publication artifact checks.

After publication, fresh API checks confirmed `draft=false`, `prerelease=true`
and unchanged attachment IDs, sizes, digests and release notes. The public release
page, Releases index and checksum download returned 200; the downloaded checksum
bytes matched, and public APK/source HEAD checks matched the expected lengths
(**5/5** HTTP checks). The build tag/archive remain pinned when adding this later
release-record documentation.

At the official root, **181/181** checked URLs matched the assembled website
commit: 137 public files, 17 directory aliases, 19 critical entries without query
strings and eight ordinary language download URLs. All **105** v74 cache entries
matched. The eight language editions show beta.8 and every Releases link uses the
generic index. The removed `webrtc/`, `WebRTC/`, both corresponding `index.html`
paths and `rtc-transport.js` returned 404 with and without query strings
(**10/10** checks). These are deployed-file checks, not physical playback tests.

### Previous beta.7 provenance

[TiPlay 0.2.20-beta.7](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.7)
was published with code **49** / page **v73** at **2026-10-20 10:54:57 UTC**.
Its build/tag commit is `725d16666c62e18ff78903462642fb68fa9b5a4e`; its subsequent
website/download-link commit is `4db1502867a79045bf6d52978dfe3f644ea0ab0a`.
Signed [Actions 39409841930](https://github.com/uJZk/TiPlay/actions/runs/39409841930)
and [Pages 39411310017](https://github.com/uJZk/TiPlay/actions/runs/39411310017)
succeeded. These hashes identify historical attachments, not beta.8:

| Historical beta.7 attachment | SHA-256 |
| --- | --- |
| APK | `2feb3249daa642879570bc0b946e7d14b76cf8059ad0208d299375b0410812ad` |
| Source ZIP | `12084436688877feda5e2eb4251da4553766cf035163281b5e050a5a471c3573` |
| SHA256SUMS.txt | `76f7a7e1be43b00f23465a3682d69b30f63bfa16a8ebea0d451aced306313563` |

The independently verified certificate was
`abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`.
Its two runtime files matched pinned DiPlay 0.2.18 inputs, its source ZIP matched
its build commit, all four RTC ABIs/18 supported 64-bit libraries passed alignment
checks, and all 165 checked website URLs matched its website commit. Repeat these
comparisons for beta.8 rather than carrying the earlier pass forward.

### Retained experimental provenance

[TiPlay 0.2.20-beta.6](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.6)
was published with code **48** / page **v72**. The following values identify that
historical release only and are not beta.8 build or deployment evidence:

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
the combined current source. Code50 preserves Android update ordering while retaining
the requested 0.2.20 product-version line.

## Updating an installed app

Select the device with `adb -s <serial>`. Pull the installed APK using `pm path <application-id>` and compare its application ID and signing fingerprint with the candidate. A different ID installs separately; a different signing key cannot update the existing package. Preserve settings by keeping both and using `adb -s <serial> install -r <apk>`; do not uninstall to bypass a mismatch.

If preserving the runtime identity, also compare both `offline-mfi` files byte for byte. An installed APK can supply that identity, but cannot supply the Android signing private key. Confirm the installed version/update time, launch the declared activity and check new application crashes. Installation alone does not validate iPhone or vehicle playback.
