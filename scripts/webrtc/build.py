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
PUBLISHER_BUILD_REPOSITORY = "https://github.com/webrtc-sdk/webrtc-build.git"
ANDROID_PATCHES = (
    "add_license_dav1d.patch", "android_webrtc_version.patch", "fix_mocks.patch",
)
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


def publisher_inputs(directory):
    """Read reviewed publisher inputs without executing its build driver."""
    directory = directory.resolve()
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=directory, text=True).strip()
    if actual != PUBLISHER_BUILD_REFERENCE:
        raise RuntimeError("Publisher build revision mismatch")
    dirty = subprocess.check_output(
        ["git", "status", "--porcelain", "--untracked-files=no"], cwd=directory, text=True)
    if dirty:
        raise RuntimeError("Publisher build checkout has modified tracked inputs")
    names = ("build/run.py", "build/VERSION", "build/scripts/apt_install_x86_64.sh",
             *("build/patches/" + name for name in ANDROID_PATCHES))
    subprocess.check_output(["git", "ls-files", "--error-unmatch", "--", *names],
                            cwd=directory, text=True)
    assignments = {}
    android_gn_args = None
    for node in ast.parse((directory / "build/run.py").read_text()).body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in ("PATCHES", "COMMON_GN_ARGS"):
                    assignments[target.id] = ast.literal_eval(node.value)
        elif isinstance(node, ast.FunctionDef) and node.name == "build_webrtc_android":
            for statement in node.body:
                if (isinstance(statement, ast.Assign) and isinstance(statement.value, ast.List)
                        and any(isinstance(target, ast.Name) and target.id == "gn_args_base"
                                for target in statement.targets)):
                    # Only take the publisher's literal policy. Its debug f-strings
                    # and common-argument call do not change our existing build mode.
                    android_gn_args = [value.value for value in statement.value.elts
                                       if isinstance(value, ast.Constant) and isinstance(value.value, str)]
    patches = assignments.get("PATCHES", {}).get("android")
    common = assignments.get("COMMON_GN_ARGS")
    if patches != list(ANDROID_PATCHES) or not isinstance(common, list) or not all(isinstance(x, str) for x in common):
        raise RuntimeError("Unexpected publisher Android patches or GN arguments")
    if android_gn_args != ["treat_warnings_as_errors=false"]:
        raise RuntimeError("Unexpected publisher Android warning policy")
    version = {}
    for line in (directory / "build/VERSION").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            key, separator, value = line.partition("=")
            if not separator:
                raise RuntimeError("Invalid publisher VERSION")
            version[key.strip()] = value.strip().strip('"')
    if version.get("WEBRTC_COMMIT") != REVISION:
        raise RuntimeError("Publisher VERSION does not match pinned WebRTC source")
    if version.get("WEBRTC_BUILD_VERSION") != "150.7871.01":
        raise RuntimeError("Unexpected publisher Android version")
    return {"root": directory, "record": {
        "repository": PUBLISHER_BUILD_REPOSITORY, "revision": actual,
        "inputs_sha256": {name: hashlib.sha256((directory / name).read_bytes()).hexdigest() for name in names},
        "android_patches": list(ANDROID_PATCHES), "common_gn_args": common,
        "android_gn_args": android_gn_args, "version": version,
    }}


def compatibility_patches(publisher):
    return tuple(publisher["root"] / "build/patches" / name for name in ANDROID_PATCHES)


def prepared_state(patch, publisher):
    return {"revision": REVISION, "patch_sha256": hashlib.sha256(patch.read_bytes()).hexdigest(),
            "publisher_build": publisher["record"]}


def state_digest(state):
    return hashlib.sha256(json.dumps(state, sort_keys=True).encode()).hexdigest()


def check_patch_stack(source, patch, patches=None):
    """Check the real patch order in a private copy, without altering source."""
    if patches is None:
        # Existing artifacts and the offline snapshot retain their original stack.
        patches = (patch.with_name("publisher-compat.patch"), patch)
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


def prepare(root, depot_tools, patch, publisher_build):
    publisher = publisher_inputs(publisher_build)
    patches = (*compatibility_patches(publisher), patch)
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
    expected_state = prepared_state(patch, publisher)
    if state.is_file():
        if json.loads(state.read_text()) != expected_state:
            raise RuntimeError("Prepared source has a different patch; use a new work directory")
        actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
        if actual != REVISION:
            raise RuntimeError("Prepared source revision changed")
        for item in reversed(patches):
            run(["git", "apply", "--reverse", "--check", str(item)], source)
        return source, env
    if not source.exists():
        run(["git", "clone", "--filter=blob:none", "--no-checkout", REPOSITORY, str(source)])
    run(["git", "fetch", "origin", REVISION], source)
    run(["git", "checkout", "--detach", REVISION], source)
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
    if actual != REVISION:
        raise RuntimeError("WebRTC revision mismatch")
    check_patch_stack(source, patch, patches)
    config = gclient_config()
    ast.parse(config)
    (root / ".gclient").write_text(config, encoding="utf-8")
    run(["gclient", "sync", "--no-history", "--revision", "src@" + REVISION,
         "--jobs=2"], root, env)
    for item in patches[:-1]:
        run(["git", "apply", "--check", str(item)], source)
        run(["git", "apply", str(item)], source)
    branch, revision, maintenance = publisher["record"]["version"]["WEBRTC_BUILD_VERSION"].split(".")
    version = source / "sdk/android/api/org/webrtc/WebrtcBuildVersion.java"
    version.write_text("package org.webrtc;\npublic interface WebrtcBuildVersion {\n"
                       f'  String webrtc_branch = "{branch}";\n'
                       f'  String webrtc_commit = "{REVISION}";\n'
                       f'  String webrtc_revision = "{revision}";\n'
                       f'  String maint_version = "{maintenance}-tiplay-source-rate";\n}}\n')
    run(["git", "apply", "--check", str(patch)], source)
    run(["git", "apply", str(patch)], source)
    state.write_text(json.dumps(expected_state, indent=2) + "\n")
    return source, env


def gclient_config():
    solutions = [{"name": "src", "url": REPOSITORY, "deps_file": "DEPS",
                  "managed": False, "custom_deps": {}}]
    return "solutions = " + repr(solutions) + "\n" + 'target_os = ["android"]\n'


def focused_tests(source, root, env, state):
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
        "binary_sha256": hashlib.sha256((build_dir / "tiplay_source_rate_tests").read_bytes()).hexdigest(),
        "prepared_state_sha256": state_digest(state),
    }, indent=2) + "\n")


def build_aar(source, output, architectures, env, publisher):
    # build_aar.py requires its per-architecture GN directories to be in SRC_DIR.
    # The AAR and generated license files are intentionally written separately.
    run([sys.executable, "tools_webrtc/android/build_aar.py", "--output", str(output),
         "--build-dir", str(source / "out_tiplay_aar"), "--arch", *architectures,
         "--extra-gn-args", "is_debug=false", *publisher["record"]["android_gn_args"],
         *publisher["record"]["common_gn_args"],
         "--extra-ninja-switches=-local_jobs=2"], source, env)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("snapshot", "check-patches", "check-publisher", "prepare", "test", "build"))
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--depot-tools", type=Path)
    parser.add_argument("--publisher-build", type=Path)
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
    if args.publisher_build is None:
        parser.error("--publisher-build is required")
    if args.command == "check-publisher":
        publisher_inputs(args.publisher_build)
        print("Pinned publisher build checkout, Android patches and environment script verified")
        return
    if args.depot_tools is None:
        parser.error("--depot-tools is required")
    patch = Path(__file__).resolve().with_name("source-rate-video.patch")
    source, env = prepare(args.work_dir.resolve(), args.depot_tools.resolve(), patch, args.publisher_build)
    if args.command == "prepare":
        return
    if args.command == "test":
        publisher = publisher_inputs(args.publisher_build)
        focused_tests(source, args.work_dir.resolve(), env, prepared_state(patch, publisher))
        return
    if args.output is None:
        parser.error("--output is required for build")
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    test_result = json.loads((args.work_dir.resolve() / "focused-tests.json").read_text())
    patch_hash = hashlib.sha256(patch.read_bytes()).hexdigest()
    publisher = publisher_inputs(args.publisher_build)
    if (test_result.get("passed") is not True or test_result.get("revision") != REVISION
            or test_result.get("patch_sha256") != patch_hash
            or test_result.get("prepared_state_sha256") != state_digest(prepared_state(patch, publisher))):
        raise RuntimeError("Run focused native tests for these prepared build inputs before building the AAR")
    build_aar(source, output, args.arch, env, publisher)
    record = {"repository": REPOSITORY, "revision": REVISION,
              "depot_tools_revision": subprocess.check_output(
                  ["git", "rev-parse", "HEAD"], cwd=args.depot_tools, text=True).strip(),
              "patch_sha256": patch_hash,
              "publisher_build_configuration_reference": PUBLISHER_BUILD_REFERENCE,
              "publisher_reference_is_original_producer_provenance": False,
              "publisher_build": publisher["record"],
              "publisher_compat_sha256": hashlib.sha256(patch.with_name("publisher-compat.patch").read_bytes()).hexdigest(),
              "publisher_compat_role": "legacy equivalence reference; not applied by this build",
              "publisher_compat_is_original_publisher_artifact": False,
              "focused_tests": test_result,
              "aar_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
              "architectures": args.arch}
    output.with_suffix(".provenance.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps(record, indent=2))


if __name__ == "__main__":
    main()
