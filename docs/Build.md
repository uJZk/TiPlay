# Build TiPlay

Build the `:mobile` Android phone receiver for the car browser. Other applications remain for upstream compatibility. Run commands from the repository root; Windows uses `gradlew.bat`. See [Windows containers](Wlsc.md) for that environment.

## Toolchain and source checks

Use the Gradle wrapper and the JDK, Node and Android SDK/NDK packages in the [Android workflow](../.github/workflows/android.yml). Set `JAVA_HOME` and `ANDROID_HOME`, or put `sdk.dir=/absolute/sdk/path` in untracked `local.properties`. Android Studio must use the same Gradle JDK and the `mobile` run configuration.

The Android/browser product version comes from `tiplayVersionName` and
`tiplayVersionCode` in [gradle.properties](../gradle.properties). Release preparation
targets **0.2.20-beta.6** (code **48**), above remote 0.2.21-beta.3 (code 47). Run
`python3 scripts/build_site.py` after a version change to regenerate `app-version.js`.
The browser diagnostic/cache revision is independent of the product version;
this release uses **v72** with WebRTC DataChannel as the formal live-media path.
The intended deployment replaces `https://ujzk.github.io/TiPlay/` and deletes the
independent `/webrtc/` subsite without an alias or redirect; the APK defaults to the
root. Signed artifacts, exact build commit/checksums and remote publication are pending
verification in the beta record below. The download pages explicitly link this beta version and its GitHub Release. Debug APK metadata retains its diagnostic suffix.

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
now returns 404; current download pages explicitly select beta.6. Historical
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

The planned prerelease is [TiPlay 0.2.20-beta.6](https://github.com/uJZk/TiPlay/releases/tag/v0.2.20-beta.6)
(version code **48**), with browser cache/diagnostic revision **v72**.
The integrated source passed the local checks below. The complete Android CI run is skipped at the user’s explicit request. Signed APK
construction, artifact hashes, exact build commit and remote release/page deployment
results remain pending. This record does not yet establish
a published release or deployed page.

Reliable, ordered WebRTC DataChannels are now the formal CarPlay/live AirPlay
media path, with shared framing, bounded credit, ownership/epoch isolation and
independent audio subscriptions. Compressed video is never reencoded. SRP-6a authenticates the four-digit pairing and binds the full SDP transcript before
media/control admission; the code is never sent in HTTP signaling. The current
page has no HTTP media fallback; legacy `/video` and `/audio` return **410
transport-required**, so cached older pages must update. Live decoding requests
hardware without an intentional software fallback; the hint cannot establish
actual hardware use. URL casting retains its resource/demux path and existing
codec compatibility policy.

Four shared profiles implement the selected priorities: CarPlay touch favors
latency slightly, ordinary CarPlay favors smoothness, AirPlay mirror favors
smoothness slightly, and URL casting favors smoothness strongly. Touch advances
only decoded video, preserves convergence across move events and never changes
the audio plan. Live audio/video have independent +300 ms software deadlines;
URL casting uses bounded 750 ms startup / 1500 ms recovery watermarks. These are
implementation defaults, not a claim of completed vehicle tuning.

AirPlay mirroring sender-protocol suspend continues dependency decoding and
suppresses decoded output. This adds no user pause button; internal `pauseDisplay`
screen arbitration and the `DECODE_ONLY` media flag serve different boundaries.
The release also fixes audio-drain failures, retired URL-operation ownership,
source-deadline enforcement, incomplete fault evidence, duplicate raw-capture
writers and unnecessary sensitive exception details. Original application-visible
video is captured once on Android input; downstream events reference that record when an exact canonical capture reference is available.
See [Changelog](../CHANGELOG.md), [WebRTC roadmap](WebRTC-roadmap.md) and
[Diagnostics](Diagnostics.md) for scope and evidence boundaries.

The integrated source passed **237** scoped Android regressions (130 shared and
107 common), **473** browser unit tests, **90** full-page checks, **17** real paired
PeerConnection checks, seven SRP security cases with Bouncy Castle vectors and
24 JVM compatibility checks. Media-clock and AirPlay photo, audio and MP4/HLS
video E2E passed. The full-page test uses the explicit `E2E_SOFTWARE_VIDEO=1`
override; strict desktop hardware-unavailable behavior is verified separately.
The override proves real compressed decoding/application wiring and provides no
vehicle hardware-decode evidence. Run timing-sensitive checks without concurrent
builds. All three required lint/debug builds passed with 0 Error/Fatal and 38 warnings.
The user explicitly requested
skipping the full Android CI run; this release does not claim the entire integrated
JVM suite passed. Signed release lint/build and artifact verification remain required.

The release uses `com.ujzk.tiplay` and the existing signed release workflow. The
established APK signing certificate SHA-256 is
`abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`,
matching the independently downloaded 0.2.20-beta.5 APK; the beta.6 signature must
still be verified against it. Keep
both runtime identity files byte-identical to the hash-verified pinned DiPlay
0.2.18 inputs. The workflow checks package/version, runtime assets and signatures,
then attaches the signed APK, source ZIP generated from the exact build commit and
`SHA256SUMS.txt` to a prerelease draft. Verify remote attachment digests before
publishing. Temporary signing/runtime inputs stay outside Git and are removed
after verification. Download links explicitly identify 0.2.20-beta.6.

Physical iPhone/Android/car acceptance remains incomplete: Shizuku-address host
ICE, actual hardware decode, gear transitions, sustained thermal smoothness,
HFP/SCO routing, audio quality and acoustic/panel timing need device measurement.
The +300 ms checks cover known software clock/output/filter mappings; upstream
iPhone NTP-anchor uncertainty is not separately carried on the wire, so
`within-bound` does not prove physical sender-relative compliance. Missing anchors
remain unknown. SRP mutual proofs and a session-key binding authenticate the full SDP, including
DTLS fingerprints. The four-digit secret still needs online-guess limits; SRP
does not prevent denial of service. HTTP AirPlay resources use random session
bearers delivered over encrypted control and retain LAN confidentiality limits. See [Testing](Testing.md) and [Todo](Todo.md).

### Retained experimental provenance

Remote main's 0.2.21-beta.1/.2/.3 experiments used the independent `/webrtc/` page;
beta.3 was code 47 / browser v71. The recorded beta.3 source was
`1592a061d8ad167fabe9d25f0c19ad8b21ca9183`, with APK SHA-256
`3dfb5bb3737088b35a7bf6e93643a70da0dd2109892e77701f7e2fb46c370c87`.
Its 2,203 shared / 1,748 common / six home / 450 browser checks are historical,
not evidence that beta.6's combined source has passed. Beta.6 uses code 48 to
remain newer for Android in-place updates despite retaining the requested product
version name. The root promotion and removal of the isolated subsite are intentional
changes from that experimental layout. Download links explicitly identify 0.2.20-beta.6.

## Updating an installed app

Select the device with `adb -s <serial>`. Pull the installed APK using `pm path <application-id>` and compare its application ID and signing fingerprint with the candidate. A different ID installs separately; a different signing key cannot update the existing package. Preserve settings by keeping both and using `adb -s <serial> install -r <apk>`; do not uninstall to bypass a mismatch.

If preserving the runtime identity, also compare both `offline-mfi` files byte for byte. An installed APK can supply that identity, but cannot supply the Android signing private key. Confirm the installed version/update time, launch the declared activity and check new application crashes. Installation alone does not validate iPhone or vehicle playback.
