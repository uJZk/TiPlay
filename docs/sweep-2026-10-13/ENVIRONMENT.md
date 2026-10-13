# Verification environment

Use the retained toolchain via `source /workspace/.tiplay-tools/env.sh`: Node 22.23.3, Temurin JDK 25, Android SDK/NDK and cached Gradle dependencies. No credential values inspected or printed. All Gradle checks are offline, source-only debug builds; no signing, release, network publication or device deployment.

The default sandbox denied Gradle local socket creation and the browser site tests' Python subprocess. Permitted local executions resolve those restrictions. The first Android run then found one immediate UDP rebind timing failure; ANDROID-INITIAL-UDP-FAILURE.txt and the result report preserve the evidence and bounded real-bind test correction.

Required Android command:

```sh
./gradlew :shared:testDebugUnitTest :common:testDebugUnitTest :home:testDebugUnitTest \
  :mobile:lintDebug :home:lintDebug :maphost:lintDebug \
  :mobile:assembleDebug :home:assembleDebug :maphost:assembleDebug \
  --offline --max-workers=2 --init-script /tmp/tiplay-sweep-test-forks.gradle \
  --stacktrace --console=plain
```

The temporary init script changes only common's execution concurrency, without adding test filters:

```groovy
allprojects {
    if (path == ':common') {
        tasks.withType(org.gradle.api.tasks.testing.Test).configureEach {
            maxParallelForks = 2
        }
    }
}
```

Other checks:

```sh
node --test tests/web/*.test.mjs
python3 -m unittest discover -s tests -p test_release_draft.py
python3 scripts/test_airplay_native.py
python3 scripts/check_public_tree.py
git diff --check
```

Full browser tests passed; deterministic PCM worklet/presenter tests cover edited browser hot paths. Browser E2E, physical iPhone/car tests and performance benchmarks are not run in this sweep. No measured end-to-end latency, throughput, battery or hardware codec claim is made.

## Tie-up final checks

After incoming main integration and repairs, the same offline Android command passed with 2423 tests plus all required lint/build tasks. Final Node suite is 113. Final E2Es (all passed): run.mjs, phone-run.mjs against compiled shared classes, and airplay-video.mjs with a generated 12-second H.264/AAC MP4 clip. Temporary Playwright installation used `/tmp/tiplay-sweep-pw/node_modules`; Chromium used retained `/workspace/.tiplay-tools/chromium-local`. Recreate the temporary tools/clip for later E2E work. They and the temporary Gradle init script were removed after verification; the init content above reproduces it. Both owned Gradle/Kotlin build daemons were stopped. Retained SDK/JDK/Node/Chromium/Gradle caches were preserved.
