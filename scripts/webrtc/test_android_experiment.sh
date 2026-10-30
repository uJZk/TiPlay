#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
MODEL=$(mktemp -d /tmp/tiplay-android-rate-verify.XXXXXX)
mkdir -p "$MODEL/shared/src/main/java/com/shilapi/xcertplay/web"
cp "$ROOT/shared/src/main/java/com/shilapi/xcertplay/web/BrowserRtcPeer.kt" "$MODEL/shared/src/main/java/com/shilapi/xcertplay/web/"
cp "$ROOT/shared/src/main/java/com/shilapi/xcertplay/web/BrowserRtcVideoLease.kt" "$MODEL/shared/src/main/java/com/shilapi/xcertplay/web/"
cd "$MODEL"
sed -i 's/\r$//' shared/src/main/java/com/shilapi/xcertplay/web/BrowserRtcPeer.kt shared/src/main/java/com/shilapi/xcertplay/web/BrowserRtcVideoLease.kt
git init -q
git apply "$ROOT/scripts/webrtc/source-rate-android-experiment.patch"
LIB=$(find "${GRADLE_USER_HOME:-$HOME/.gradle}/wrapper/dists" -type f -name 'kotlin-compiler-embeddable-*.jar' -print -quit | xargs dirname)
JUNIT=$(find ${GRADLE_USER_HOME:-$HOME/.gradle}/caches/modules-2/files-2.1/junit/junit/4.13.2 -name junit-4.13.2.jar | head -1)
HAMCREST=$(find ${GRADLE_USER_HOME:-$HOME/.gradle}/caches/modules-2/files-2.1/org.hamcrest/hamcrest-core -name 'hamcrest-core-*.jar' | head -1)
STDLIB=$(find "$LIB" -maxdepth 1 -name 'kotlin-stdlib-*.jar' | head -1)
test -f "$JUNIT" && test -f "$HAMCREST" && test -f "$STDLIB"
java -cp "$LIB/*" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -cp "$STDLIB:$JUNIT:$HAMCREST" -d "$MODEL/classes" shared/src/main/java/com/shilapi/xcertplay/web/BrowserRtcVideoLease.kt shared/src/main/java/com/shilapi/xcertplay/web/BrowserRtcSourceRateGuard.kt shared/src/test/java/com/shilapi/xcertplay/web/BrowserRtcSourceRateGuardTest.kt "$ROOT/tests/native/BrowserRtcRecoverySequenceTest.kt"
java -cp "$MODEL/classes:$STDLIB:$JUNIT:$HAMCREST" org.junit.runner.JUnitCore com.shilapi.xcertplay.web.BrowserRtcSourceRateGuardTest com.shilapi.xcertplay.web.BrowserRtcRecoverySequenceTest
