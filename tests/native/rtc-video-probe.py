#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Build/run the actual Android AAR compressed-video loopback probe on an ADB device."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import zipfile

REPO = Path(__file__).resolve().parents[2]
PRODUCT_PREFIXES = (
    "com/shilapi/xcertplay/web/BrowserRtcVideoTrack",
    "com/shilapi/xcertplay/web/BrowserRtcVideoSourceProcessor",
    "com/shilapi/xcertplay/web/BrowserRtcVideoPolicy",
    "com/shilapi/xcertplay/web/WebVideoRecord",
    "com/shilapi/xcertplay/web/WebJson",
    "com/shilapi/xcertplay/diagnostics/RawTraffic$Reference",
)
DEVICE_DIR = "/data/local/tmp/tiplay-native-probe"


def run(command, **kwargs):
    subprocess.run([str(part) for part in command], check=True, **kwargs)


def newest(paths):
    paths = list(paths)
    if not paths:
        raise SystemExit("Required build input is missing; see tests/native/README.md")
    return max(paths, key=lambda path: tuple(int(n) for n in re.findall(r"\d+", str(path))))


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(args):
    sdk = args.android_sdk
    caches = args.gradle_home / "caches/modules-2/files-2.1"
    aar = args.webrtc_aar or newest((caches / "io.github.webrtc-sdk/android/150.7871.01").glob("*/*.aar"))
    stdlib = args.kotlin_stdlib or newest((caches / "org.jetbrains.kotlin/kotlin-stdlib").glob("*/*/*.jar"))
    android_jar = newest(sdk.glob("platforms/*/android.jar"))
    d8 = newest(sdk.glob("build-tools/*/d8"))
    classes = args.product_classes or REPO / "shared/build/intermediates/built_in_kotlinc/debug/compileDebugKotlin/classes"
    if not classes.is_dir():
        raise SystemExit("Compile the shared debug Kotlin classes first; see tests/native/README.md")
    work = args.work_dir
    work.mkdir(parents=True, exist_ok=True)
    classes_out = work / "classes"
    classes_out.mkdir(exist_ok=True)
    dex_out = work / "dex"
    dex_out.mkdir(exist_ok=True)
    with zipfile.ZipFile(aar) as archive:
        (work / "webrtc.jar").write_bytes(archive.read("classes.jar"))
        (work / "libjingle_peerconnection_so.so").write_bytes(archive.read(f"jni/{args.abi}/libjingle_peerconnection_so.so"))
    classpath = os.pathsep.join(map(str, (classes, work / "webrtc.jar", stdlib, android_jar)))
    run([args.java_home / "bin/javac", "-source", "8", "-target", "8", "-cp", classpath,
         "-d", classes_out, REPO / "tests/native/NativeVideoProbe.java"])
    with zipfile.ZipFile(work / "product.jar", "w") as archive:
        for path in classes.rglob("*.class"):
            name = path.relative_to(classes).as_posix()
            if name.startswith(PRODUCT_PREFIXES):
                archive.write(path, name)
    with zipfile.ZipFile(work / "probe-classes.jar", "w") as archive:
        for path in classes_out.rglob("*.class"):
            archive.write(path, path.relative_to(classes_out).as_posix())
    with (work / "d8.log").open("w") as output:
        run([d8, "--min-api", "28", "--lib", android_jar, "--output", dex_out,
             work / "probe-classes.jar", work / "product.jar", work / "webrtc.jar", stdlib],
            stdout=output, stderr=subprocess.STDOUT)
    with zipfile.ZipFile(work / "probe.jar", "w", zipfile.ZIP_DEFLATED) as archive:
        for path in dex_out.glob("classes*.dex"):
            archive.write(path, path.name)
    fixture = work / "fixture.h264"
    if args.fixture:
        fixture.write_bytes(args.fixture.read_bytes())
    elif not fixture.exists():
        # Offline synthetic test input. The probe itself forwards these bytes without encoding.
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
             "testsrc2=size=1568x1080:rate=60", "-frames:v", "180", "-an", "-c:v", "libx264",
             "-preset", "ultrafast", "-profile:v", "high", "-level:v", "4.2", "-bf", "0",
             "-b:v", "10M", "-minrate", "10M", "-maxrate", "10M", "-bufsize", "10M",
             "-x264-params", "aud=1:repeat-headers=1:keyint=60:min-keyint=60:scenecut=0:nal-hrd=cbr",
             "-f", "h264", fixture])
    report = {"webrtcVersion": "150.7871.01", "webrtcAarSha256": sha256(aar),
              "fixtureSha256": sha256(fixture), "productClassesSha256": sha256(work / "product.jar"),
              "probeSha256": sha256(work / "probe.jar"), "abi": args.abi}
    (work / "build.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


def execute(args):
    work = args.work_dir
    adb = [args.android_sdk / "platform-tools/adb", "-P", str(args.adb_port)]
    if args.serial:
        adb += ["-s", args.serial]
    run(adb + ["shell", "mkdir", "-p", DEVICE_DIR])
    run(adb + ["push", work / "probe.jar", work / "fixture.h264", work / "libjingle_peerconnection_so.so", DEVICE_DIR + "/"])
    label = f"{args.mode}-{args.start_bitrate}-{args.encoder_delay}"
    command = f"CLASSPATH={shlex.quote(DEVICE_DIR + '/probe.jar')} app_process /system/bin "
    command += "com.shilapi.xcertplay.web.NativeVideoProbe "
    command += " ".join(map(shlex.quote, (args.mode, str(args.start_bitrate), str(args.encoder_delay), str(args.frames), "warm", "verbose" if args.native_verbose else "info")))
    log = work / (label + ".log")
    with log.open("w") as output:
        run(adb + ["shell", command], stdout=output, stderr=subprocess.STDOUT)
    lines = [line[len("RESULT_JSON "):] for line in log.read_text().splitlines() if line.startswith("RESULT_JSON ")]
    if len(lines) != 1:
        raise SystemExit(f"Probe did not produce one final result; inspect {log}")
    result = json.loads(lines[0])
    result["build"] = json.loads((work / "build.json").read_text())
    (work / (label + ".json")).write_text(json.dumps(result, indent=2) + "\n")
    run(adb + ["pull", DEVICE_DIR + f"/native-{label}.log", work / ("native-" + label + ".log")])
    print(json.dumps(result, indent=2))
    if args.expect_continuous:
        delta = result["delta"]
        checks = (delta["outputFrames"] == args.frames,
                  delta["releasedUnencodedFrames"] == 0,
                  delta["sourceAdaptationDrops"] == 0,
                  delta["lossEvents"] == 0,
                  result["nativeBlocked"] in (None, 0),
                  result["offeredSha256"] == result["encoderOutputSha256"],
                  result["receiverRtpDelta"].get("framesReceived") == args.frames)
        if not all(checks):
            raise SystemExit("Continuous native RTP assertions failed; inspect scenario JSON and logs")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("build", "run"))
    parser.add_argument("--work-dir", required=True, type=Path)
    parser.add_argument("--android-sdk", type=Path, default=Path(os.environ.get("ANDROID_HOME", "/nonexistent")))
    parser.add_argument("--java-home", type=Path, default=Path(os.environ.get("JAVA_HOME", "/nonexistent")))
    parser.add_argument("--gradle-home", type=Path, default=Path(os.environ.get("GRADLE_USER_HOME", str(Path.home() / ".gradle"))))
    parser.add_argument("--abi", choices=("x86_64", "x86", "arm64-v8a", "armeabi-v7a"), default="x86_64")
    parser.add_argument("--webrtc-aar", type=Path)
    parser.add_argument("--kotlin-stdlib", type=Path)
    parser.add_argument("--product-classes", type=Path)
    parser.add_argument("--fixture", type=Path)
    parser.add_argument("--adb-port", type=int, default=5037)
    parser.add_argument("--serial")
    parser.add_argument("--mode", choices=("paced", "serial", "burst"), default="serial")
    parser.add_argument("--start-bitrate", type=int, default=16000000)
    parser.add_argument("--encoder-delay", type=int, default=0)
    parser.add_argument("--frames", type=int, default=180)
    parser.add_argument("--expect-continuous", action="store_true")
    parser.add_argument("--native-verbose", action="store_true")
    args = parser.parse_args()
    if args.action == "build":
        build(args)
    else:
        execute(args)


if __name__ == "__main__":
    main()
