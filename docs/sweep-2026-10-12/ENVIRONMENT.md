# Verification environment

Retained managed tools: source `/workspace/.tiplay-tools/env.sh`; refresh the configured proxy with `/workspace/.tiplay-tools/refresh-proxy.py`. This session used Temurin 25 and Node 22.23.3, the retained Android SDK/Gradle cache and the Chromium wrapper. No credentials were printed and no tracked dependency/build changes were needed.

Required task set:

```sh
./gradlew :shared:testDebugUnitTest :common:testDebugUnitTest :home:testDebugUnitTest \
  :mobile:lintDebug :home:lintDebug :maphost:lintDebug \
  :mobile:assembleDebug :home:assembleDebug :maphost:assembleDebug \
  --max-workers=2 --stacktrace --console=plain
node --test tests/web/*.test.mjs
python3 scripts/check_public_tree.py
SITE_BASE_URL=https://ujzk.github.io/TiPlay/ python3 scripts/build_site.py
CHROMIUM=/workspace/.tiplay-tools/chromium-local node tests/web-e2e/run.mjs
CHROMIUM=/workspace/.tiplay-tools/chromium-local node tests/web-e2e/phone-run.mjs
```

The final full Gradle invocation additionally used a temporary init script via `--init-script`. It assigned two independent JVM forks to common tests without filtering out tests or changing repository configuration. The selected container has four CPUs and 16 GiB memory; socket-using common tests bind ephemeral ports. Reproduce the init script as:

```groovy
allprojects {
    if (path == ':common') {
        tasks.withType(org.gradle.api.tasks.testing.Test).configureEach {
            maxParallelForks = 2
        }
    }
}
```

Default sandbox execution blocked subprocesses/local listeners with EPERM. Permitted executions ran browser tests, local Chromium/Java E2E and Gradle. All E2E services are scoped to the harness and stop when it exits. These are source-only debug APKs; no signing, release delivery, deployment or physical device validation was requested.
