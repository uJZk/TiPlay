# Build TiPlay

Use this procedure to build the TiPlay receiver on an Android phone for the car browser. Head-unit implementations remain in source for upstream compatibility.
Run the commands from the repository root, where `gradlew` and `settings.gradle.kts` are located.

## Select the application

This repository contains several Android applications.
Select `mobile` to build the main TiPlay app.

| Gradle module | Purpose | Debug APK |
| --- | --- | --- |
| `:mobile` | Main TiPlay app (current browser receiver profile) | `mobile/build/outputs/apk/debug/mobile-debug.apk` |
| `:maphost` | Retained upstream map-host sample | `samples/maphost/build/outputs/apk/debug/maphost-debug.apk` |
| `:home` | Retained upstream launcher sample | `samples/home/build/outputs/apk/debug/home-debug.apk` |
| `:automotive` | Retained upstream Android Automotive application | `automotive/build/outputs/apk/debug/automotive-debug.apk` |

The `:common` and `:shared` modules are libraries.
The applications use these libraries.

If the installed app is **TiPlay map host**, you selected `:maphost` or its APK.
Build `:mobile` and select `mobile-debug.apk` to install the main app.
A command such as `./gradlew assembleDebug` can build more than one application.
Use the module name in each build command to select the required application.

## Prepare the build environment

Install these tools:

- Eclipse Temurin JDK 25 (the distribution used by CI).
- Android SDK Platform 37 (`platforms;android-37.0`).
- Android SDK Build-Tools 36.0.0.
- Android SDK Platform-Tools.
- Android NDK 28.2.13676358.

Use the Gradle wrapper included in this repository.
The first build needs an internet connection to download dependencies.

1. Open the repository root in Android Studio.
2. Install the Android SDK packages with **Tools → SDK Manager**.
3. Set **Gradle JDK** to JDK 25 in the Android Studio Gradle settings.
4. Wait for Gradle sync to finish.

For a terminal build, set `JAVA_HOME` to your JDK 25 directory.
Set `ANDROID_HOME` to your Android SDK directory.
You can also specify the SDK directory in the root `local.properties` file:

```properties
sdk.dir=/absolute/path/to/Android/sdk
```

Keep `local.properties` outside Git.
Check the Java version before the build:

```sh
java -version
```

The output must identify Java 25.
On Windows, use `gradlew.bat` in place of `./gradlew` in the commands below.

## Build the main app

For a source build without runtime authentication assets:

```sh
./gradlew :mobile:assembleDebug
```

Check that this file exists:

```text
mobile/build/outputs/apk/debug/mobile-debug.apk
```

The debug application ID is `com.ujzk.tiplay.hudtest`.
The release application ID is `com.ujzk.tiplay`.

The source APK contains no accessory identity unless you supply runtime authentication assets.
Standalone CarPlay needs these assets to connect to an iPhone.
Use the car-test procedure below for that purpose.
Tests generate synthetic identities at runtime.
Keep test private keys outside Git.

### Use Android Studio

1. Open **Run → Edit Configurations**.
2. Select an **Android App** configuration, or create one.
3. Set **Module** to `mobile`.
4. Select this configuration in the toolbar.
5. Select the Android device.
6. Click **Run** to install the main debug app.

To build an APK without installation, run `:mobile:assembleDebug` in the Android Studio terminal.
Select the APK from the `mobile` output directory.

## Check the source build

Run the required source checks from [AGENTS.md](../AGENTS.md) and CI:

```sh
node --test tests/web/*.test.mjs
python3 scripts/check_public_tree.py
./gradlew :shared:testDebugUnitTest :common:testDebugUnitTest :home:testDebugUnitTest \
  :mobile:lintDebug :home:lintDebug :maphost:lintDebug \
  :mobile:assembleDebug :home:assembleDebug :maphost:assembleDebug
```

Check that Gradle reports `BUILD SUCCESSFUL`.
For the complete CI procedure, see [the Android workflow](../.github/workflows/android.yml).
The retained `home` and `maphost` checks protect upstream compatibility; they do not
make native head-unit products part of TiPlay's supported phone + browser scope.
Optional local Chromium E2E commands and their simulation limits are documented in
[the browser E2E guide](../tests/web-e2e/README.md); CI does not run them.

## Build a standalone car-test APK

Prepare an external directory with these runtime authentication files:

```text
runtime-assets/
└── offline-mfi/
    ├── identity.pk8
    └── certificate.p7b
```

Use only the intended runtime files in this directory.
Keep the directory and its private key outside Git.
The build rejects unexpected credential containers in APK assets.

1. Set `DIPLAY_AUTH_ASSETS_DIR` to the absolute directory path.
2. Run the standalone debug task.

```sh
DIPLAY_AUTH_ASSETS_DIR=/absolute/path/to/runtime-assets ./gradlew :mobile:assembleStandaloneDebug
```

The task stops if either required file is absent or empty.
Its APK output is `mobile/build/outputs/apk/debug/mobile-debug.apk`.
Check both files in the APK against your selected local inputs:

- `assets/offline-mfi/identity.pk8`.
- `assets/offline-mfi/certificate.p7b`.

Use this APK for a standalone connection test.
Update the existing test app with the same signing key to keep its settings.
Different signing keys cannot update the same installed application.

## Extract runtime identity from an upstream APK

When using the experimental identity bundled by upstream, download the selected
public APK from [upstream DiPlay releases](https://github.com/shihabal3amri/DiPlay/releases).
Check the APK against that release's published SHA-256 before extracting files.
Selecting an APK for runtime assets does not merge that upstream version's source
into TiPlay. See [the identity notice](THIRD_PARTY_NOTICES.md#experimental-authentication-data).

The following example pins the upstream 0.2.17 APK used for the October 11 build.
Keep this temporary input directory outside the repository. For a different
upstream release, select its APK name and published hash together.

```sh
export RELEASE_INPUT_DIR="$(mktemp -d /tmp/tiplay-release-inputs.XXXXXX)"
gh release download v0.2.17 --repo shihabal3amri/DiPlay \
  --pattern DiPlay-0.2.17.apk --dir "$RELEASE_INPUT_DIR"
python3 - <<'PYCODE'
import hashlib
import os
from pathlib import Path
import zipfile

inputs = Path(os.environ["RELEASE_INPUT_DIR"])
apk = inputs / "DiPlay-0.2.17.apk"
expected = "6f6a4e797fb32a01a1e30fb6fcf3bc55c15ddcd7ddcaa436f91e9897657b0db0"
assert hashlib.sha256(apk.read_bytes()).hexdigest() == expected, "Upstream APK hash mismatch"
assets = inputs / "runtime-assets" / "offline-mfi"
assets.mkdir(parents=True)
assets.chmod(0o700)
with zipfile.ZipFile(apk) as archive:
    for name in ("identity.pk8", "certificate.p7b"):
        data = archive.read("assets/offline-mfi/" + name)
        assert data, "Empty runtime asset: " + name
        output = assets / name
        output.write_bytes(data)
        output.chmod(0o600)
PYCODE
export DIPLAY_AUTH_ASSETS_DIR="$RELEASE_INPUT_DIR/runtime-assets"
```

Only these two extracted files belong in the runtime assets directory. The Android
signing keystore is a separate input; never extract a signing key from an APK or
place a signing keystore under APK assets.

## Build a release APK

Prepare the runtime assets as described in the car-test procedure.
Set these environment variables locally:

| Variable | Value |
| --- | --- |
| `DIPLAY_AUTH_ASSETS_DIR` | Absolute path to the runtime assets directory |
| `ANDROID_KEYSTORE_PATH` | Path to your Android signing keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Signing key alias |
| `ANDROID_KEY_PASSWORD` | Signing key password |

Keep the keystore and passwords outside Git. A PKCS12 `.p12` signing keystore is
supported. Check its password and signing-key entry before building:

```sh
keytool -list -keystore "$ANDROID_KEYSTORE_PATH" \
  -storepass:env ANDROID_KEYSTORE_PASSWORD
```

The configured alias must identify a `PrivateKeyEntry`. Use configured secret
environment variables rather than putting passwords in command arguments or logs.
Run the full [CI checks](../.github/workflows/android.yml), including the Node 22
browser tests, followed by the release checks and build:

```sh
./gradlew :shared:testDebugUnitTest :common:testDebugUnitTest :mobile:lintRelease :mobile:assembleRelease
```

The output is `mobile/build/outputs/apk/release/mobile-release.apk`.
Publish it as `TiPlay-<version>.apk` under the tag `v<version>`.
The APK contains the runtime identity you supplied.
Recipients can extract that identity from the APK.
The APK excludes the Android signing key.
See [the project notices](THIRD_PARTY_NOTICES.md) for the experimental identity used in public releases.

The public source archive matches the release tag.
It excludes runtime identities, signing keys, local configuration, and build output.
The retired `build-beta.py` helper is no longer part of the build procedure.

## Verify the APK and create a Release draft

Use the SDK Build-Tools selected above to verify the APK signature and manifest:

```sh
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs \
  mobile/build/outputs/apk/release/mobile-release.apk
"$ANDROID_HOME/build-tools/36.0.0/aapt" dump badging \
  mobile/build/outputs/apk/release/mobile-release.apk
```

Check the release application ID `com.ujzk.tiplay`, the version name/code from
`mobile/build.gradle.kts`, the API 28 minimum, and the signing certificate fingerprint
against the selected keystore. Compare both packaged runtime files byte for byte
with the chosen inputs, and reject additional credential containers:

```sh
python3 - <<'PYCODE'
import os
from pathlib import Path
import zipfile

assets = Path(os.environ["DIPLAY_AUTH_ASSETS_DIR"])
expected = {"assets/offline-mfi/identity.pk8", "assets/offline-mfi/certificate.p7b"}
credential_suffixes = {".pk8", ".p7b", ".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"}
with zipfile.ZipFile("mobile/build/outputs/apk/release/mobile-release.apk") as archive:
    found = {name for name in archive.namelist()
             if Path(name).suffix.lower() in credential_suffixes}
    assert found == expected, "Unexpected or missing APK credentials"
    for name in expected:
        assert archive.read(name) == (assets / name.removeprefix("assets/")).read_bytes()
PYCODE
```

Prepare `TiPlay-<version>.apk`, the source ZIP for the exact build commit, and
`SHA256SUMS.txt` in a release directory outside Git. Run `scripts/check_public_tree.py`
before archiving the tracked source. Scan the archive as well; omit local signing
inputs, extracted identities, configuration and build output. Record the exact
build commit, upstream APK/hash, signing fingerprint, validation and remaining
vehicle checks in the release notes. Use the version already declared by the
build; a new version requires an intentional version-name/code update first.

Create a draft rather than a public release:

```sh
# Set RELEASE_VERSION, RELEASE_COMMIT, RELEASE_OUTPUT_DIR and RELEASE_NOTES_FILE
# to this build's version, full commit, external asset directory and notes file.
(
  cd "$RELEASE_OUTPUT_DIR"
  sha256sum "TiPlay-$RELEASE_VERSION.apk" "TiPlay-$RELEASE_VERSION-source.zip" > SHA256SUMS.txt
)
gh release create "v$RELEASE_VERSION" --repo uJZk/DiPlay --draft \
  --target "$RELEASE_COMMIT" --title "TiPlay $RELEASE_VERSION" \
  --notes-file "$RELEASE_NOTES_FILE" \
  "$RELEASE_OUTPUT_DIR/TiPlay-$RELEASE_VERSION.apk" \
  "$RELEASE_OUTPUT_DIR/TiPlay-$RELEASE_VERSION-source.zip" \
  "$RELEASE_OUTPUT_DIR/SHA256SUMS.txt"
gh release view "v$RELEASE_VERSION" --repo uJZk/DiPlay --json isDraft,assets,url
```

A failed upload can leave a created draft without attachments. Inspect the draft
before retrying, then use `gh release upload` to add only missing assets; do not
create a duplicate draft or overwrite an existing asset without checking it.
Confirm the draft state and all three attachments after uploading.

GitHub Release metadata uses `api.github.com`; binary attachments use
`uploads.github.com`. In a managed environment, both need network access and
working GitHub authentication with repository Contents write permission. A working
API request alone does not prove upload authentication. If uploads return
`401 Bad credentials`, preserve the draft and built files, record the upload as
pending, and fix the upload-host credential binding through the supported
environment configuration workflow. Do not disable the proxy, TLS verification,
or print tokens. The currently exposed GitHub connector has no Release attachment
upload operation and cannot replace this upload step.

### Restricted build environments

When the user home directory is read-only, put tool caches in a writable workspace:
set `GRADLE_USER_HOME` and `ANDROID_USER_HOME` to external directories, and set
`JAVA_TOOL_OPTIONS` to include `-Duser.home=<writable-java-home>` for Robolectric.
Preserve any existing Java options, proxy settings and CA trust. SDK Manager may
need its explicit `--proxy=http --proxy_host=<host> --proxy_port=<port>` options;
Gradle may need `systemProp.http.proxyHost`/`proxyPort` and the HTTPS equivalents in
its external user properties. Use the proxy and trust store provided by the
selected environment. Temurin 25 matches CI; the October 11 Oracle JDK attempt
failed during Robolectric crypto-provider initialization and passed after switching
to Temurin. These are environment settings, not source changes.

## Correct build problems

| Symptom | Action |
| --- | --- |
| Installed app is TiPlay map host | Select `mobile` in Android Studio. Build and install the APK from the `mobile` output directory. |
| Gradle cannot find the Android SDK | Set `ANDROID_HOME` or the `sdk.dir` value in `local.properties`. |
| A required SDK or NDK package is absent | Install the listed package with SDK Manager. |
| Java or Gradle JDK version is incorrect | Set the terminal JDK and Android Studio Gradle JDK to Java 25. |
| Source APK cannot start standalone CarPlay | Supply runtime authentication assets. Use `:mobile:assembleStandaloneDebug`. |
| Standalone task reports missing authentication files | Check the external directory path and both required files. |
| Android rejects an app update | Use the same application ID and signing key as the installed app. |
