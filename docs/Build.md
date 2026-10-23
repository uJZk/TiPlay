# Build TiPlay

Build the `:mobile` Android phone receiver for the car browser. Other applications remain for upstream compatibility. Run commands from the repository root; Windows uses `gradlew.bat`. See [Windows containers](Wlsc.md) for that environment.

## Toolchain and source checks

Use the Gradle wrapper and the JDK, Node and Android SDK/NDK packages in the [Android workflow](../.github/workflows/android.yml). Set `JAVA_HOME` and `ANDROID_HOME`, or put `sdk.dir=/absolute/sdk/path` in untracked `local.properties`. Android Studio must use the same Gradle JDK and the `mobile` run configuration.

The Android/browser product version comes from `tiplayVersionName` and
`tiplayVersionCode` in [gradle.properties](../gradle.properties). The latest published
prerelease is **0.2.20-beta.14** (code **56**). Run
`python3 scripts/build_site.py` after a version change to regenerate `app-version.js`.
The browser diagnostic/cache revision is independent of the product version;
the deployed page uses **v80** with WebRTC DataChannel as the formal live-media path.
The signed beta.14 APK and deployed v80 page use the same verified build commit below;
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

Published [TiPlay 0.2.20-beta.14](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.14),
code **56**, is paired with webpage **v80**. Independent artifact and deployment
checks passed. Every language's download entry opens the
version-independent [GitHub Releases index](https://github.com/uJZk/TiPlay/releases).

This release preserves independent render-rate fitting when native output-phase
measurements reset, using one bounded applied-rate controller. Native phase checks
retain their own evidence; rate projection and actual PCM/tails retain full source
uncertainty and deadlines. Voice recovery uses actual contiguous PCM and retained
Soxr preparation, pays the 20 ms wait once and reuses source conversion, phase checks
and mixing. It fixes permanent recovery waits, finite short utterances on large
render blocks, conflicting 280 ms plans and first presentation-anchor promotion.

Immediate buffered AirPlay flushes use the protocol's 23-bit sequence, retain the
boundary packet, clear old anchors and isolate already-prefetched track origins.
Unsupported deferred ranges return explicit RTSP 501 without playback mutation.
Debug records fit selection, observed context pauses and voice readiness as bounded
scalars. See [verification](Testing.md#media-clock-and-continuous-audio-acceptance),
[Diagnostics](Diagnostics.md) and [AirPlay](AirPlay.md).

### Source validation and remaining scope

| Check | Evidence for this release |
| --- | --- |
| Functional browser suite | **814 passed** before version-only changes; all **138** checked inputs remain byte-identical after normalizing three version-bearing JavaScript files. |
| Functional native suite | **69 scoped cases passed**, with mobile debug assembly; metadata preflight repeats some of these cases. |
| Independent signals | **76** voice waveform cases, **26** lifecycle/short-utterance cases and **7** media oracles pass on the final functional source, including actual PCM/source progress and legal/expired output. |
| Version/site preflight | **62** browser, **51** native cases across four classes, **9** release-draft and **2** root-site tests passed; these scopes overlap the functional suites. |
| Real browser | Chromium 151 production-CSP media-clock checks pass again on beta.14/v80; all **61** runtime hashes remain unchanged during execution. |
| Signed release | Release lint/build and independent package, signer, runtime, ABI, DEX, source-archive and checksum verification passed. |
| Complete Android CI | Skipped at the user's explicit request; scoped tests and release lint/build do not replace it. |
| Root deployment | **138** files and **188** URL checks match; **106** cache entries exist, eight download pages use the Releases index, and **10** removed-path checks return direct 404. |

### Artifact and deployment evidence

Prerelease **421892511** was published at **2026-10-23 13:50:47 UTC**. The signed APK,
byte-identical `git archive` source ZIP and deployed page came from
`59efe314ae8e1a4b21b86c0feb451c624ff13e4b`, tagged `v0.2.20-beta.14`.
The [signed workflow](https://github.com/uJZk/TiPlay/actions/runs/39962490704) and
[Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/39962485128) succeeded.
Publication preserved the three independently downloaded and checked assets:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `TiPlay-0.2.20-beta.14.apk` | 101,060,901 | `d8c5e1aaa1ee239fbcfe27d05178270da07a86136cd9154f93f58183932418c4` |
| `TiPlay-0.2.20-beta.14-source.zip` | 20,900,562 | `44bf8fe6eacfeb5232057b8e80d03cacddba722599c4ab2b0c22caf44e948eac` |
| `SHA256SUMS.txt` | 191 | `af669ebe2e00c2f5eb986f883d594a8d1207a524516b587a5a91579b1234bb2a` |

All **18** supported 64-bit ELF libraries meet 16 KiB LOAD alignment, and
`zipalign -P 16` passes. All **7** packaged JNA libraries match beta.13, including
three inherited legacy ABI files. DEX inspection finds all **8** new class/method
contracts in the actual release APK; the beta.13 negative control contains none.
The signed workflow was dispatched from `main` with the exact build SHA; the
published lightweight tag independently resolves to that same SHA.

The APK uses non-debug package `com.ujzk.tiplay`, code56, and the same signing
certificate as published beta.13, SHA-256
`abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`.
Both runtime identity files match the pinned DiPlay 0.2.18 inputs and beta.13;
source archives exclude credentials and private captures. The APK contains only
the two intended runtime files. Native/DEX inspection checks packaged code and
source identity, not actual vehicle sound. RTC libraries cover `arm64-v8a`,
`armeabi-v7a`, `x86` and `x86_64`.

The [root website](https://ujzk.github.io/TiPlay/) matches the exact build's assembled
site, canonical SHA-256
`e5eaa6a73b68abb7ccabdb0fa129452fec962b311da7a822e6f8b4635cd77f0a`.
All 188 ordinary/build-query URL checks passed without automatic retries, old bytes
or HTTP 503; the 10 removed `webrtc`/`WebRTC`/legacy-transport checks returned direct
404 without redirects. Unauthenticated release/index/checksum GETs and APK/source
HEADs also pass, with matching checksum bytes and content lengths.

### Remaining scope

The captured approximately 1.8-second cumulative audio/performance-clock progress
difference has no confirmed underlying cause. Old snapshots cannot distinguish
brief context pauses, internal scheduling and output-clock behavior. The separate
clock-compensation/recovery defects are reproduced and repaired; this does not
establish that every CarPlay, mirror or separate URL-audio click is eliminated.
Actual phone/vehicle playback, physical latency and parameter tuning remain in
[Todo](Todo.md#browser-and-carplay-audio).

URL video budgeting remains **256 MiB**, with 32 queued pictures and the held
picture included in byte ownership; CarPlay/mirror remain at 64 MiB. This does not
repair sustained insufficient decoding throughput. LIVI-based CarPlay borrowing
and session-practice work remains explicitly deferred. Very short isolated PCM
still requires real filter lookahead; temporary shortages are not signal EOF.
Debug raw capture retains disk backpressure, and renderer statistics alone do not
measure vehicle speakers or panels.

### Previous release provenance

[Beta.13](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.13), code55 / v79,
was published at **2026-10-23 07:34:49 UTC** as prerelease **421554656**. Its signed
APK and deployed page came from `70a86088e8ec57c1adb24045d28c1f06f9300f0f`;
[signed workflow](https://github.com/uJZk/TiPlay/actions/runs/39917075886) and
[Pages workflow](https://github.com/uJZk/TiPlay/actions/runs/39917163410) succeeded.
Its published APK SHA-256 is
`2b4161736d7bdcc0a0762af40d720468e72cdae7367042ca0fc3edf407235765`.
Beta.14's signer, runtime files and native libraries are compared with that actual
published APK; earlier detailed release records remain in Git.

## Updating an installed app

Select the device with `adb -s <serial>`. Pull the installed APK using `pm path <application-id>` and compare its application ID and signing fingerprint with the candidate. A different ID installs separately; a different signing key cannot update the existing package. Preserve settings by keeping both and using `adb -s <serial> install -r <apk>`; do not uninstall to bypass a mismatch.

If preserving the runtime identity, also compare both `offline-mfi` files byte for byte. An installed APK can supply that identity, but cannot supply the Android signing private key. Confirm the installed version/update time, launch the declared activity and check new application crashes. Installation alone does not validate iPhone or vehicle playback.
