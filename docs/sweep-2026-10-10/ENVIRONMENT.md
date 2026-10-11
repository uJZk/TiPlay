# Managed build environment recovery

Original blocker: Gradle's Foojay JDK provisioning URL at `api.foojay.io` returned HTTP 403 under the managed destination policy. No policy bypass or project JDK downgrade was used. Installed the required JDK 25 from official permitted distributions; final verification uses Temurin 25, matching CI.

## Installed tools

- Active JDK: `/workspace/.toolchains/jdk-25.0.4.1+1` (Temurin 25.0.4.1+1), matching CI vendor.
- Official archive: `https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4.1%2B1/OpenJDK25U-jdk_x64_linux_hotspot_25.0.4.1_1.tar.gz`.
- SHA-256 verified against official checksum: `dbb698396d478e7fa2b1e50f4103324b2a99b90569ee27c33f2261f9215cf41e`.
- Oracle 25.0.4.1 was tried first: it started Gradle but Robolectric tests encountered JCE provider verification initialization errors. Switched to CI vendor rather than weakening signature checks. Oracle download verification below retained as diagnostic history.
- Official archive: `https://download.oracle.com/java/25/latest/jdk-25_linux-x64_bin.tar.gz`.
- SHA-256 verified against official `.sha256`: `dd7e7f51d23bcffe85f1a439577ce1c0190a33417b34afdb338f9b3897bdeaec`.
- Android SDK: `/workspace/.android-sdk`.
- JVM user data: `/workspace/.java-user-home` via `-Duser.home`; Robolectric requires a writable download-lock and Maven cache directory. Shell HOME is preserved.
- Android tool data: `/workspace/.android` via `ANDROID_USER_HOME`; prevents writes to the read-only `/home/agent/.android`.
- Android command-line bootstrap archive from `dl.google.com`: `commandlinetools-linux-16111833_latest.zip`; SHA-1 matches official repository manifest: `e025545c62a8e64c7559119566a569fb1dec5f60`.
- SDK package requirements: `platforms;android-37.0`, `build-tools;36.0.0`, `platform-tools`, `ndk;28.2.13676358`. Installed successfully; installation/result recorded in SDK-VALIDATION.txt.
- Gradle cache: `/tmp/tiplay-sweep-gradle` (Gradle 9.5.0).

These tools live outside the repository. No tracked Gradle, toolchain or application configuration changes are required.

## Repeat the checks in this managed environment

The local helper `/workspace/.toolchains/tiplay-checks.sh` runs the command below.

```sh
export JAVA_HOME=/workspace/.toolchains/jdk-25.0.4.1+1
export GRADLE_USER_HOME=/tmp/tiplay-sweep-gradle
export ANDROID_HOME=/workspace/.android-sdk
export ANDROID_USER_HOME=/workspace/.android
export JAVA_TOOL_OPTIONS='-Duser.home=/workspace/.java-user-home -Djavax.net.ssl.trustStore=/etc/ssl/certs/java/cacerts -Djava.util.prefs.userRoot=/workspace/.android/java-prefs -Dhttps.proxyHost=proxy -Dhttps.proxyPort=8080 -Dhttp.proxyHost=proxy -Dhttp.proxyPort=8080'
./gradlew :shared:testDebugUnitTest :common:testDebugUnitTest :home:testDebugUnitTest \
  :mobile:lintDebug :home:lintDebug :maphost:lintDebug \
  :mobile:assembleDebug :home:assembleDebug :maphost:assembleDebug --stacktrace --console=plain --no-daemon --no-configuration-cache
```

Run with sandboxed network permission for SDK/dependency downloads and local Gradle daemon communication. Proxy settings and CA trust are specific to this managed environment; preserve them here. Required JDK and SDK versions remain those in docs/BUILD.md. A previous Oracle daemon and cached test launcher were retired using `./gradlew --stop` and a first fresh run with `--no-daemon --no-configuration-cache`. This setup selects the installed JDK, so Gradle need not contact the unavailable Foojay provisioning service.

## Optional browser E2E retry

Existing Playwright and Chromium allowed the harness to start. The H.264 mux check decoded 30/30 frames; worker VP8 decode, viewport sizing, link handling and touch mapping passed. The harness then failed its stats-event assertion (one field received). Full E2E is not passing; see E2E-VALIDATION.txt. This is separate from the JDK provisioning blocker and the 50/50 passing browser unit suite.
