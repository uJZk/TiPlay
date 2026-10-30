#!/bin/sh
set -eu
ROOT=/workspace
MODEL=$(mktemp -d /tmp/tiplay-android-rate-verify.XXXXXX)
mkdir -p "$MODEL/shared/src/main/java/com/shilapi/xcertplay/web"
cp "$ROOT/shared/src/main/java/com/shilapi/xcertplay/web/BrowserRtcPeer.kt" "$MODEL/shared/src/main/java/com/shilapi/xcertplay/web/"
cp "$ROOT/shared/src/main/java/com/shilapi/xcertplay/web/BrowserRtcVideoLease.kt" "$MODEL/shared/src/main/java/com/shilapi/xcertplay/web/"
cd "$MODEL"
sed -i 's/\r$//' shared/src/main/java/com/shilapi/xcertplay/web/BrowserRtcPeer.kt shared/src/main/java/com/shilapi/xcertplay/web/BrowserRtcVideoLease.kt
git init -q
git apply "$ROOT/scripts/webrtc/source-rate-android-experiment.patch"
LIB=/root/.gradle/wrapper/dists/gradle-9.5.0-bin/bvnork1r7n8i6kp5cnkibsc9q/gradle-9.5.0/lib
JUNIT=$(find /root/.gradle/caches/modules-2/files-2.1/junit/junit/4.13.2 -name junit-4.13.2.jar | head -1)
HAMCREST=$(find /root/.gradle/caches/modules-2/files-2.1/org.hamcrest/hamcrest-core -name 'hamcrest-core-*.jar' | head -1)
STDLIB=$(find "$LIB" -maxdepth 1 -name 'kotlin-stdlib-*.jar' | head -1)
test -f "$JUNIT" && test -f "$HAMCREST" && test -f "$STDLIB"
java -cp "$LIB/*" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -cp "$STDLIB:$JUNIT:$HAMCREST" -d "$MODEL/classes" shared/src/main/java/com/shilapi/xcertplay/web/BrowserRtcVideoLease.kt shared/src/main/java/com/shilapi/xcertplay/web/BrowserRtcSourceRateGuard.kt shared/src/test/java/com/shilapi/xcertplay/web/BrowserRtcSourceRateGuardTest.kt
java -cp "$MODEL/classes:$STDLIB:$JUNIT:$HAMCREST" org.junit.runner.JUnitCore com.shilapi.xcertplay.web.BrowserRtcSourceRateGuardTest
