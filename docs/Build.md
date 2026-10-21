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
The signed beta.9 APK and its paired root deployment are verified below; the
previous beta.8 remains pinned to its original v74 assets.
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

[TiPlay 0.2.20-beta.9](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.9),
version code **51**, was published as a prerelease at **2026-10-21 02:11:40 UTC**
(release ID **419064852**, not a draft). Its paired webpage is **v75** at
<https://ujzk.github.io/TiPlay/>. Download entry points retain the
version-independent [GitHub Releases index](https://github.com/uJZk/TiPlay/releases).

This release bounds late URL-audio scheduling and fixes sample-level EOF, fractional
duration and decoder-padding boundaries. Successful FCUP fallback is reused for the
exact resource URL within its current item, avoiding repeated failed HTTP waits
without creating an origin blacklist. Mirror source-anchor upgrades preserve
consumed sample progress; stale clock mapping refresh retains its uncertainty and
generation guards. CarPlay recovery evidence and video read/decode ages are added
without increasing diagnostic frequency limits or collection budgets. See
[Diagnostics](Diagnostics.md), [AirPlay](AirPlay.md) and the
[WebRTC roadmap](WebRTC-roadmap.md).

### Source validation and remaining scope

| Check | Evidence for this release |
| --- | --- |
| Browser unit suite | **604 passed** on Node 22.23.3. |
| Scoped Android/JVM tests | **82 passed** across seven actual classes, covering resource-route reuse, startup/continuity and audio/video diagnostics. |
| Phone debug APK | Source assembly passed; release version, signing and runtime assets are independently checked below. |
| Complete browser page | **90 checks passed** with an explicit test-only software decoder override, including all four main/Worker paths, reconnection, takeover and v75 offline cache. |
| Ordinary URL playback | MP4/HLS playback, Video.js controls, seek/rate, cleanup and diagnostics passed. |
| URL audio signal | **4** native offline rate combinations and **2** real AudioContext/AudioWorklet captures during deliberate main-thread stalls passed. |
| Short-audio EOF | **10** native 1x cases at 44.1/48 kHz matched the duration-limited whole-buffer reference sample for sample, including single samples, fractional ends and long padding. |
| Shared media clock | CarPlay/mirror AudioWorklet and main/Worker video clock checks passed with unchanged runtime sources. Hardware paths were explicitly unavailable on this desktop browser. |
| Version/site preflight | After the metadata-only beta.9 update, **37** selected browser tests, **9** release-draft and **2** site tests plus the public-tree scan passed. These overlap the full suite. |
| Complete Android CI | Skipped at the user's explicit request; scoped checks do not replace it. |
| Signed release / root deployment | Release lint/build, independent APK/source/attachment checks and **186/186** deployed-URL checks passed. |

CarPlay steady-playback clicks and occasional non-touch stutter still need field
attribution; this release does not establish their complete resolution. Application
admission wait is observable separately from submit-to-output decoder residence,
but opaque decoder queueing, execution and callback scheduling cannot be fully split.
Native/desktop checks do not prove the vehicle's hardware decoder implementation,
speaker/panel latency or acoustic quality. New diagnostic fields cannot reconstruct
missing evidence in old captures. Non-1x tempo output retains rounded sample counts;
the short-source waveform comparisons above are at 1x. Debug raw capture still
has synchronous disk backpressure. Physical acceptance remains in
[Testing](Testing.md) and [Todo](Todo.md).

### Artifact and deployment evidence

| Item | Verified value |
| --- | --- |
| APK build / tag | `35eb9976a8c95f234b9524458cd64b4783ace505` / `v0.2.20-beta.9` |
| Website source | The same `35eb9976a8c95f234b9524458cd64b4783ace505`; subsequent release-record documentation does not retag the build or redeploy the page. |
| Signed workflow | [Actions 39530324075](https://github.com/uJZk/TiPlay/actions/runs/39530324075), release and draft jobs successful |
| APK | `TiPlay-0.2.20-beta.9.apk`, 101,028,133 bytes; SHA-256 `67df3f7b97699c2572e7475eef0d937b96731521c517303b5cdeb29f595bbabc` |
| Source archive | `TiPlay-0.2.20-beta.9-source.zip`, 20,755,840 bytes; SHA-256 `0e2dcf68cc04ba5ae8d38b9c2f6618c798fa452039083fb9b549e60e9ab39ade` |
| Checksums | `SHA256SUMS.txt`, 189 bytes; SHA-256 `d5caccd93a45db3b9153eaca388afa6ccd805899bd9f87c62edf54853d56fba4` |
| Root webpage | [Actions 39530306076](https://github.com/uJZk/TiPlay/actions/runs/39530306076), successful at the website commit above |

Independent verification confirmed `com.ujzk.tiplay`, beta.9/code51 and
`debuggable=false`. The verified certificate SHA-256 is
`abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`,
matching the actual hash-verified published beta.8 APK.
Both runtime identity files are byte-identical to the hash-pinned DiPlay 0.2.18
inputs. All four WebRTC ABIs, all 18 supported 64-bit libraries' 16 KiB ELF
LOAD alignment and `zipalign -c -P 16 4` passed. The three retained legacy
JNA library paths/bytes also match beta.8; this does not establish additional
WebRTC ABI support.

The source ZIP is byte-identical to `git archive` of the exact build commit and
contains no field captures, signing inputs or credential containers. The release
contains exactly the APK, source ZIP and checksum file above; all remote attachment
sizes/digests and checksum coverage matched independent downloads before publication.
After publication, fresh API checks confirmed `draft=false`, `prerelease=true` and
unchanged attachment IDs, sizes, digests and release notes. The unauthenticated
release page, Releases index and checksum download returned
200; the downloaded checksum bytes matched, and APK/source HEAD checks matched the
expected lengths (**5/5** HTTP checks).

At the official root, **186/186** checked URLs matched the assembled website commit:
137 public files, 17 directory aliases, 24 critical entries without query strings
and eight ordinary language download URLs. All **105** v75 cache entries matched.
All **32** ordinary no-query checks matched the new deployment; the eight language
editions show beta.9 and their Releases links use the generic index. Removed
`webrtc/`, `WebRTC/`, both corresponding `index.html` paths and `rtc-transport.js`
returned 404 with and without query strings (**10/10** checks). These are file and
reachability checks, not physical playback tests.

### Previous release provenance

[Beta.8](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.8), code **50** /
page **v74**, was published at **2026-10-20 12:26:10 UTC** from
`b62e843d873def57d94f9ac794bbcd383e8db301`. Its actual published APK SHA-256 is
`050b3ff8f4a2a34ef0feda88e7088e90d13b6d00de5fcc85f83269436274c75f`;
it supplies this release's independent signing/runtime compatibility reference.
The earlier detailed release records remain in Git and are not validation of
beta.9. Runtime identity provenance remains the pinned upstream APK described above.

## Updating an installed app

Select the device with `adb -s <serial>`. Pull the installed APK using `pm path <application-id>` and compare its application ID and signing fingerprint with the candidate. A different ID installs separately; a different signing key cannot update the existing package. Preserve settings by keeping both and using `adb -s <serial> install -r <apk>`; do not uninstall to bypass a mismatch.

If preserving the runtime identity, also compare both `offline-mfi` files byte for byte. An installed APK can supply that identity, but cannot supply the Android signing private key. Confirm the installed version/update time, launch the declared activity and check new application crashes. Installation alone does not validate iPhone or vehicle playback.
