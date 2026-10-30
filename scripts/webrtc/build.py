#!/usr/bin/env python3
"""Prepare and build TiPlay's source-rate WebRTC AAR inside a Linux container.

The application must enable TiPlay-SourceRateVideo only on its video factory.
This script never installs host tools and never downloads floating WebRTC source.
"""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request

REVISION = "73cb8180f7258ee292878d6edd05177f41883962"
DEPOT_REVISION = "7083aadfb53f3de2e20b72058c7f510da8f8218a"
REPOSITORY = "https://github.com/webrtc-sdk/webrtc.git"
PUBLISHER_BUILD_REFERENCE = "06e3410d8f67d08202e26f55225705596b60778e"
SOURCE_RATE_TEST_FILTER = "PacingControllerTest.SourceRate*:RtpTransportControllerSendTest.SourceRate*:VideoStreamEncoderTest.SourceRate*"
MODEL_FILES = (
    "call/call.cc", "call/rtp_transport_controller_send.cc",
    "call/rtp_transport_controller_send.h", "call/rtp_transport_controller_send_interface.h",
    "call/rtp_transport_controller_send_unittest.cc", "call/BUILD.gn",
    "modules/pacing/pacing_controller.cc", "modules/pacing/pacing_controller.h",
    "modules/pacing/pacing_controller_unittest.cc",
    "modules/pacing/BUILD.gn",
    "modules/pacing/task_queue_paced_sender.cc",
    "modules/pacing/task_queue_paced_sender.h",
    "video/video_send_stream_impl.cc", "video/video_send_stream_impl.h",
    "video/video_stream_encoder.cc", "video/video_stream_encoder.h",
    "video/video_stream_encoder_interface.h",
    "video/video_stream_encoder_unittest.cc",
    "tools_webrtc/libs/generate_licenses.py",
    "modules/audio_device/include/mock_audio_device.h", "sdk/android/BUILD.gn",
    "sdk/android/api/org/webrtc/WrappedVideoDecoderFactory.java",
)


def run(args, cwd=None, env=None):
    subprocess.run(args, cwd=cwd, env=env, check=True)


def snapshot(directory):
    """Small immutable source model for patch review; not a compilable checkout."""
    directory.mkdir(parents=True, exist_ok=True)
    for name in MODEL_FILES:
        target = directory / name
        target.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://raw.githubusercontent.com/webrtc-sdk/webrtc/{REVISION}/{name}"
        with urllib.request.urlopen(url, timeout=40) as response:
            target.write_bytes(response.read())
    run(["git", "init", "-q"], directory)
    run(["git", "add", "."], directory)
    run(["git", "-c", "user.name=TiPlay source model", "-c",
         "user.email=source-model@localhost", "commit", "-qm", REVISION], directory)
    print(f"Immutable patch model ready: {directory}")


def check_patch_stack(source, patch):
    """Check the real patch order in a private copy, without altering source."""
    compat = patch.with_name("publisher-compat.patch")
    patches = (compat, patch)
    names = set()
    additions = set()
    for item in patches:
        previous = ""
        for line in item.read_text().splitlines():
            if line.startswith("+++ b/"):
                name = Path(line[6:])
                if name.is_absolute() or ".." in name.parts:
                    raise RuntimeError("Invalid source path in patch")
                names.add(name)
                if previous == "--- /dev/null":
                    additions.add(name)
            previous = line
    with tempfile.TemporaryDirectory(prefix="tiplay-webrtc-patch-check-") as directory:
        model = Path(directory)
        for name in names:
            target = model / name
            if not (source / name).exists() and name in additions:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source / name, target)
        run(["git", "init", "-q"], model)
        run(["git", "add", "."], model)
        run(["git", "-c", "user.name=TiPlay patch check", "-c",
             "user.email=patch-check@localhost", "commit", "-qm", "Pristine source"], model)
        for item in patches:
            run(["git", "apply", "--check", str(item.resolve())], model)
            run(["git", "apply", str(item.resolve())], model)
        run(["git", "diff", "--check"], model)


def ensure_depot_bootstrapped(depot_tools, env):
    """Initialize the pinned checkout used for gclient, gn and autoninja.

    With updates disabled, a successful gclient invocation does not guarantee
    the Python wrapper has been bootstrapped. Fail before downloading WebRTC if
    this exact checkout cannot execute its wrapper.
    """
    bootstrap = depot_tools / "ensure_bootstrap"
    wrapper = depot_tools / "python-bin" / "python3"
    marker = depot_tools / "python3_bin_reldir.txt"
    if not bootstrap.is_file() or not wrapper.is_file():
        raise RuntimeError("Pinned depot_tools lacks its bootstrap or Python wrapper")
    if not marker.is_file():
        run([str(bootstrap)], depot_tools, env)
    if not marker.is_file():
        raise RuntimeError("depot_tools bootstrap did not install its Python marker")
    run([str(wrapper), "-c", "import sys; assert sys.version_info >= (3, 8)"], depot_tools, env)


def prepare(root, depot_tools, patch):
    if not (depot_tools / "gclient").is_file():
        raise RuntimeError("An existing depot_tools checkout is required; pass --depot-tools")
    env = dict(os.environ, PATH=str(depot_tools) + os.pathsep + os.environ["PATH"],
               DEPOT_TOOLS_DIR=str(depot_tools), DEPOT_TOOLS_BOOTSTRAP_PYTHON3="1",
               DEPOT_TOOLS_UPDATE="0", DEPOT_TOOLS_METRICS="0", GCLIENT_PY3="1")
    depot_revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=depot_tools, text=True).strip()
    if depot_revision != DEPOT_REVISION:
        raise RuntimeError("depot_tools revision mismatch")
    ensure_depot_bootstrapped(depot_tools, env)
    depot_revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=depot_tools, text=True).strip()
    if depot_revision != DEPOT_REVISION:
        raise RuntimeError("depot_tools revision changed during bootstrap")
    root.mkdir(parents=True, exist_ok=True)
    source = root / "src"
    state = root / "tiplay-prepared.json"
    compat = patch.with_name("publisher-compat.patch")
    expected_state = {"revision": REVISION,
                      "patch_sha256": hashlib.sha256(patch.read_bytes()).hexdigest(),
                      "publisher_compat_sha256": hashlib.sha256(compat.read_bytes()).hexdigest()}
    if state.is_file():
        if json.loads(state.read_text()) != expected_state:
            raise RuntimeError("Prepared source has a different patch; use a new work directory")
        actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
        if actual != REVISION:
            raise RuntimeError("Prepared source revision changed")
        run(["git", "apply", "--reverse", "--check", str(patch)], source)
        run(["git", "apply", "--reverse", "--check", str(compat)], source)
        return source, env
    if not source.exists():
        run(["git", "clone", "--filter=blob:none", "--no-checkout", REPOSITORY, str(source)])
    run(["git", "fetch", "origin", REVISION], source)
    run(["git", "checkout", "--detach", REVISION], source)
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
    if actual != REVISION:
        raise RuntimeError("WebRTC revision mismatch")
    check_patch_stack(source, patch)
    config = gclient_config()
    ast.parse(config)
    (root / ".gclient").write_text(config, encoding="utf-8")
    run(["gclient", "sync", "--no-history", "--revision", "src@" + REVISION,
         "--jobs=2"], root, env)
    run(["git", "apply", "--check", str(compat)], source)
    run(["git", "apply", str(compat)], source)
    version = source / "sdk/android/api/org/webrtc/WebrtcBuildVersion.java"
    version.write_text("package org.webrtc;\npublic interface WebrtcBuildVersion {\n"
                       '  String webrtc_branch = "150";\n'
                       f'  String webrtc_commit = "{REVISION}";\n'
                       '  String webrtc_revision = "7871";\n'
                       '  String maint_version = "01-tiplay-source-rate";\n}\n')
    run(["git", "apply", "--check", str(patch)], source)
    run(["git", "apply", str(patch)], source)
    state.write_text(json.dumps(expected_state, indent=2) + "\n")
    return source, env


def gclient_config():
    solutions = [{"name": "src", "url": REPOSITORY, "deps_file": "DEPS",
                  "managed": False, "custom_deps": {}}]
    return "solutions = " + repr(solutions) + "\n" + 'target_os = ["android"]\n'


def focused_tests(source, root, env):
    build_dir = root / "native-tests"
    gn_args = ("is_debug=false rtc_include_tests=true rtc_enable_protobuf=true "
               "rtc_use_h264=false use_rtti=true rtc_build_examples=false "
               "rtc_build_tools=false rtc_use_pipewire=false")
    run(["gn", "gen", str(build_dir), "--args=" + gn_args], source, env)
    run(["autoninja", "-C", str(build_dir), "-j2",
         "modules/pacing:tiplay_source_rate_tests"], source, env)
    run([str(build_dir / "tiplay_source_rate_tests"),
         "--gtest_filter=" + SOURCE_RATE_TEST_FILTER], source, env)
    (root / "focused-tests.json").write_text(json.dumps({
        "revision": REVISION, "passed": True,
        "filter": SOURCE_RATE_TEST_FILTER,
        "patch_sha256": hashlib.sha256(Path(__file__).with_name("source-rate-video.patch").read_bytes()).hexdigest(),
        "binary_sha256": hashlib.sha256((build_dir / "tiplay_source_rate_tests").read_bytes()).hexdigest()
    }, indent=2) + "\n")


def build_aar(source, output, architectures, env):
    # build_aar.py requires its per-architecture GN directories to be in SRC_DIR.
    # The AAR and generated license files are intentionally written separately.
    run([sys.executable, "tools_webrtc/android/build_aar.py", "--output", str(output),
         "--build-dir", str(source / "out_tiplay_aar"), "--arch", *architectures,
         "--extra-gn-args", "is_debug=false", "use_rtti=true", "rtc_use_h264=false",
         "is_component_build=false", "rtc_build_examples=false", "rtc_build_tools=false",
         "rtc_enable_protobuf=false",
         "--extra-ninja-switches=-local_jobs=2"], source, env)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("snapshot", "check-patches", "prepare", "test", "build"))
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--depot-tools", type=Path)
    parser.add_argument("--arch", nargs="+", default=["armeabi-v7a", "arm64-v8a", "x86", "x86_64"])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if sys.platform != "linux":
        parser.error("Run in Wlsc or another Linux container; host builds are prohibited")
    if args.command == "snapshot":
        snapshot(args.work_dir.resolve())
        return
    if args.command == "check-patches":
        check_patch_stack(args.work_dir.resolve(), Path(__file__).resolve().with_name("source-rate-video.patch"))
        return
    if args.depot_tools is None:
        parser.error("--depot-tools is required")
    patch = Path(__file__).resolve().with_name("source-rate-video.patch")
    source, env = prepare(args.work_dir.resolve(), args.depot_tools.resolve(), patch)
    if args.command == "prepare":
        return
    if args.command == "test":
        focused_tests(source, args.work_dir.resolve(), env)
        return
    if args.output is None:
        parser.error("--output is required for build")
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    test_result = json.loads((args.work_dir.resolve() / "focused-tests.json").read_text())
    patch_hash = hashlib.sha256(patch.read_bytes()).hexdigest()
    if not test_result.get("passed") or test_result.get("patch_sha256") != patch_hash:
        raise RuntimeError("Run focused native tests for this patch before building the AAR")
    build_aar(source, output, args.arch, env)
    record = {"repository": REPOSITORY, "revision": REVISION,
              "depot_tools_revision": subprocess.check_output(
                  ["git", "rev-parse", "HEAD"], cwd=args.depot_tools, text=True).strip(),
              "patch_sha256": patch_hash,
              "publisher_build_configuration_reference": PUBLISHER_BUILD_REFERENCE,
              "publisher_reference_is_original_producer_provenance": False,
              "publisher_compat_sha256": hashlib.sha256(patch.with_name("publisher-compat.patch").read_bytes()).hexdigest(),
              "publisher_compat_is_original_publisher_artifact": False,
              "focused_tests": test_result,
              "aar_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
              "architectures": args.arch}
    output.with_suffix(".provenance.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps(record, indent=2))


if __name__ == "__main__":
    main()
