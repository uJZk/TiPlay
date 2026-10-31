#!/usr/bin/env python3
"""Focused build-driver checks; no network, compiler, or Android SDK required."""
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location("webrtc_build", Path(__file__).with_name("build.py"))
build = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build)


class BuildDriverTest(unittest.TestCase):
    def compatibility_source(self, *trees):
        legacy_patch = Path(__file__).with_name("publisher-compat.patch")
        for section in legacy_patch.read_text().split("diff --git ")[1:]:
            lines = section.splitlines(keepends=True)
            name = next(line[6:].strip() for line in lines if line.startswith("+++ b/"))
            old = []
            hunk = False
            for line in lines:
                if line.startswith("@@ "):
                    hunk = True
                elif hunk and line[:1] in (" ", "-"):
                    old.append(line[1:])
            for tree in trees:
                target = tree / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("".join(old))
                if name == "tools_webrtc/libs/generate_licenses.py":
                    target.chmod(0o755)

    def publisher_fixture(self, root):
        publisher = root / "publisher"
        scripts = publisher / "build/scripts"
        scripts.mkdir(parents=True)
        (scripts / "apt_install_x86_64.sh").write_text("#!/bin/sh\ntrue\n")
        common = ["rtc_use_h264=false", "is_component_build=false", "rtc_build_examples=false",
                  "use_rtti=true", "rtc_build_tools=false", "rtc_enable_protobuf=false"]
        (publisher / "build/run.py").write_text(
            "PATCHES = " + repr({"android": list(build.ANDROID_PATCHES)}) + "\nCOMMON_GN_ARGS = " + repr(common) + "\n"
            "def build_webrtc_android():\n"
            "    gn_args_base = [f'is_debug={False}', f'is_java_debug={False}',\n"
            "                    'treat_warnings_as_errors=false', *common_gn_args()]\n")
        (publisher / "build/VERSION").write_text(
            "WEBRTC_BUILD_VERSION=150.7871.01\nWEBRTC_COMMIT=" + build.REVISION + "\n")
        patches = publisher / "build/patches"
        patches.mkdir()
        legacy = Path(__file__).with_name("publisher-compat.patch").read_text()
        sections = ["diff --git " + section for section in legacy.split("diff --git ")[1:]]
        for name, section in zip(build.ANDROID_PATCHES, (sections[0], sections[2], sections[1])):
            (patches / name).write_text(section)
        subprocess.run(["git", "init", "-q", str(publisher)], check=True)
        subprocess.run(["git", "add", "."], cwd=publisher, check=True)
        subprocess.run(["git", "-c", "user.name=Build test", "-c", "user.email=test@localhost",
                        "commit", "-qm", "Publisher fixture"], cwd=publisher, check=True)
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=publisher, text=True).strip()
        with mock.patch.object(build, "PUBLISHER_BUILD_REFERENCE", revision):
            inputs = build.publisher_inputs(publisher)
        return publisher, revision, inputs

    def test_publisher_pin_and_clean_tracked_environment_inputs_are_required(self):
        with tempfile.TemporaryDirectory() as directory:
            publisher, revision, inputs = self.publisher_fixture(Path(directory))
            with self.assertRaisesRegex(RuntimeError, "Publisher build revision mismatch"):
                build.publisher_inputs(publisher)
            for name in ("build/run.py", "build/VERSION", "build/scripts/apt_install_x86_64.sh",
                         "build/patches/fix_mocks.patch"):
                with self.subTest(name=name):
                    path = publisher / name
                    original = path.read_bytes()
                    path.write_bytes(original + b"# modified\n")
                    with mock.patch.object(build, "PUBLISHER_BUILD_REFERENCE", revision):
                        with self.assertRaisesRegex(RuntimeError, "modified tracked inputs"):
                            build.publisher_inputs(publisher)
                    path.write_bytes(original)
            (publisher / "build/VERSION").write_text("modified\n")
            subprocess.run(["git", "add", "build/VERSION"], cwd=publisher, check=True)
            with mock.patch.object(build, "PUBLISHER_BUILD_REFERENCE", revision):
                with self.assertRaisesRegex(RuntimeError, "modified tracked inputs"):
                    build.publisher_inputs(publisher)
            self.assertIn("build/scripts/apt_install_x86_64.sh", inputs["record"]["inputs_sha256"])

    def test_warning_policy_is_taken_from_the_android_function_not_an_unrelated_literal(self):
        with tempfile.TemporaryDirectory() as directory:
            publisher, _, _ = self.publisher_fixture(Path(directory))
            driver = publisher / "build/run.py"
            driver.write_text(driver.read_text().replace("'treat_warnings_as_errors=false'",
                                                       "'treat_warnings_as_errors=true'")
                              + "unrelated = 'treat_warnings_as_errors=false'\n")
            subprocess.run(["git", "add", "build/run.py"], cwd=publisher, check=True)
            subprocess.run(["git", "-c", "user.name=Build test", "-c", "user.email=test@localhost",
                            "commit", "-qm", "Changed Android policy"], cwd=publisher, check=True)
            revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=publisher, text=True).strip()
            with mock.patch.object(build, "PUBLISHER_BUILD_REFERENCE", revision):
                with self.assertRaisesRegex(RuntimeError, "Android warning policy"):
                    build.publisher_inputs(publisher)

    def test_upstream_patches_preserve_legacy_compatibility_effects_and_leave_java_unmodified(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _, _, publisher = self.publisher_fixture(root)
            legacy_patch = Path(__file__).with_name("publisher-compat.patch")
            legacy, current = root / "legacy", root / "current"
            self.compatibility_source(legacy, current)
            java = Path("sdk/android/api/org/webrtc/WrappedVideoDecoderFactory.java")
            pristine_java = (current / java).read_bytes()
            subprocess.run(["git", "apply", str(legacy_patch.resolve())], cwd=legacy, check=True, capture_output=True)
            for patch in build.compatibility_patches(publisher):
                subprocess.run(["git", "apply", str(patch)], cwd=current, check=True, capture_output=True)
            for path in legacy.rglob("*"):
                if path.is_file():
                    if path.relative_to(legacy) == java:
                        self.assertEqual(pristine_java, (current / java).read_bytes())
                        self.assertNotEqual(path.read_bytes(), pristine_java)
                    else:
                        self.assertEqual(path.read_bytes(), (current / path.relative_to(legacy)).read_bytes())

    def test_patch_stack_is_checked_in_production_order_without_changing_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            (source / "fixture").write_text("base\n")
            compat = root / "publisher-compat.patch"
            compat.write_text("--- a/fixture\n+++ b/fixture\n@@ -1 +1 @@\n-base\n+compat\n")
            patch = root / "source-rate-video.patch"
            patch.write_text("--- a/fixture\n+++ b/fixture\n@@ -1 +1 @@\n-compat\n+source\n")
            build.check_patch_stack(source, patch)
            self.assertEqual((source / "fixture").read_text(), "base\n")

    def test_patch_stack_accepts_new_files_but_not_missing_modified_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            (source / "fixture").write_text("base\n")
            (root / "publisher-compat.patch").write_text(
                "--- a/fixture\n+++ b/fixture\n@@ -1 +1 @@\n-base\n+compat\n")
            patch = root / "source-rate-video.patch"
            patch.write_text("--- /dev/null\n+++ b/new/header.h\n"
                             "@@ -0,0 +1 @@\n+header\n")
            build.check_patch_stack(source, patch)
            self.assertFalse((source / "new/header.h").exists())
            patch.write_text("--- a/missing\n+++ b/missing\n"
                             "@@ -1 +1 @@\n-old\n+new\n")
            with self.assertRaises(FileNotFoundError):
                build.check_patch_stack(source, patch)

    def test_gclient_is_executable_configuration_with_actual_line_breaks(self):
        config = build.gclient_config()
        ast.parse(config)
        values = {}
        exec(config, values)
        self.assertEqual(values["target_os"], ["android"])
        self.assertEqual(values["solutions"][0]["url"], build.REPOSITORY)
        self.assertFalse(values["solutions"][0]["managed"])
        self.assertNotIn("\\n", config)

    def prepared_fixture(self, root):
        publisher_root, _, publisher = self.publisher_fixture(root)
        depot = root / "depot"
        depot.mkdir()
        (depot / "gclient").touch()
        work = root / "work"
        (work / "src").mkdir(parents=True)
        patch = root / "source-rate-video.patch"
        patch.write_text("source patch\n")
        state = build.prepared_state(patch, publisher)
        (work / "tiplay-prepared.json").write_text(json.dumps(state))
        return work, depot, patch, publisher_root, publisher

    def test_fresh_prepare_applies_upstream_stack_and_preserves_generated_version(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            publisher_root, _, publisher = self.publisher_fixture(root)
            depot = root / "depot"
            depot.mkdir()
            (depot / "gclient").touch()
            work = root / "work"
            source = work / "src"
            self.compatibility_source(source)
            patch = root / "source-rate-video.patch"
            patch.write_text("diff --git a/source.txt b/source.txt\nnew file mode 100644\n"
                             "--- /dev/null\n+++ b/source.txt\n@@ -0,0 +1 @@\n+source-rate\n")
            original_run = build.run
            def invoke(args, cwd=None, env=None):
                if args[:2] in (["git", "fetch"], ["git", "checkout"]) or args[0] == "gclient":
                    return
                original_run(args, cwd, env)
            with mock.patch.object(build, "publisher_inputs", return_value=publisher), \
                    mock.patch.object(build.subprocess, "check_output",
                                      side_effect=[build.DEPOT_REVISION, build.DEPOT_REVISION, build.REVISION]), \
                    mock.patch.object(build, "ensure_depot_bootstrapped"), \
                    mock.patch.object(build, "run", side_effect=invoke) as run:
                prepared, _ = build.prepare(work, depot, patch, publisher_root)
            self.assertEqual(prepared, source)
            self.assertEqual((source / "source.txt").read_text(), "source-rate\n")
            self.assertEqual((source / "sdk/android/api/org/webrtc/WebrtcBuildVersion.java").read_text(),
                             'package org.webrtc;\npublic interface WebrtcBuildVersion {\n'
                             '  String webrtc_branch = "150";\n'
                             f'  String webrtc_commit = "{build.REVISION}";\n'
                             '  String webrtc_revision = "7871";\n'
                             '  String maint_version = "01-tiplay-source-rate";\n}\n')
            self.assertEqual(json.loads((work / "tiplay-prepared.json").read_text()),
                             build.prepared_state(patch, publisher))
            applied = [call.args[0][-1] for call in run.call_args_list
                       if call.args[0][:2] == ["git", "apply"] and "--check" not in call.args[0]
                       and len(call.args) > 1 and call.args[1] == source]
            self.assertEqual(applied, [str(p) for p in (*build.compatibility_patches(publisher), patch)])
            java = (source / "sdk/android/api/org/webrtc/WrappedVideoDecoderFactory.java").read_text()
            self.assertIn("new LinkedHashSet();", java)
            self.assertNotIn("new LinkedHashSet<>();", java)

    def test_focused_native_tests_keep_host_configuration_and_bind_prepared_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / "native-tests/tiplay_source_rate_tests"
            binary.parent.mkdir()
            binary.write_bytes(b"native test binary")
            state = {"publisher_build": {"revision": "fixture"}, "patch_sha256": "test"}
            with mock.patch.object(build, "run") as run:
                build.focused_tests(root / "src", root, {}, state)
            self.assertEqual(run.call_args_list[0].args[0][-1],
                             "--args=is_debug=false rtc_include_tests=true rtc_enable_protobuf=true "
                             "rtc_use_h264=false use_rtti=true rtc_build_examples=false "
                             "rtc_build_tools=false rtc_use_pipewire=false")
            self.assertEqual(run.call_args_list[1].args[0][-2:],
                             ["-j2", "modules/pacing:tiplay_source_rate_tests"])
            result = json.loads((root / "focused-tests.json").read_text())
            self.assertEqual(result["prepared_state_sha256"], build.state_digest(state))

    def test_prepared_reuse_checks_every_applied_patch_without_sync_or_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            work, depot, patch, publisher_root, publisher = self.prepared_fixture(Path(directory))
            with mock.patch.object(build.subprocess, "check_output",
                                   side_effect=[build.DEPOT_REVISION, build.DEPOT_REVISION, build.REVISION]), \
                    mock.patch.object(build, "publisher_inputs", return_value=publisher), \
                    mock.patch.object(build, "ensure_depot_bootstrapped") as bootstrap, \
                    mock.patch.object(build, "run") as run:
                source, env = build.prepare(work, depot, patch, publisher_root)
            self.assertEqual(source, work / "src")
            self.assertEqual(env["DEPOT_TOOLS_UPDATE"], "0")
            self.assertEqual(env["DEPOT_TOOLS_DIR"], str(depot))
            self.assertEqual(env["DEPOT_TOOLS_BOOTSTRAP_PYTHON3"], "1")
            bootstrap.assert_called_once_with(depot, env)
            expected = [patch, *reversed(build.compatibility_patches(publisher))]
            self.assertEqual(run.call_count, len(expected))
            for call, item in zip(run.call_args_list, expected):
                self.assertEqual(call.args[0][:4], ["git", "apply", "--reverse", "--check"])
                self.assertEqual(call.args[0][-1], str(item))

    def test_changed_patch_cannot_reuse_prepared_source(self):
        with tempfile.TemporaryDirectory() as directory:
            work, depot, patch, publisher_root, publisher = self.prepared_fixture(Path(directory))
            for change in ("source", "publisher", "android-gn"):
                with self.subTest(change=change):
                    original = patch.read_bytes()
                    changed = json.loads(json.dumps(publisher["record"]))
                    if change == "source": patch.write_text("different source patch\n")
                    if change == "publisher": changed["inputs_sha256"]["build/patches/fix_mocks.patch"] = "0" * 64
                    if change == "android-gn": changed["android_gn_args"] = ["treat_warnings_as_errors=true"]
                    with mock.patch.object(build.subprocess, "check_output", return_value=build.DEPOT_REVISION), \
                            mock.patch.object(build, "publisher_inputs", return_value={**publisher, "record": changed}), \
                            mock.patch.object(build, "ensure_depot_bootstrapped"), \
                            mock.patch.object(build, "run") as run:
                        with self.assertRaisesRegex(RuntimeError, "different patch"):
                            build.prepare(work, depot, patch, publisher_root)
                    run.assert_not_called()
                    patch.write_bytes(original)

    def test_missing_marker_bootstraps_and_checks_exact_checkout_wrapper(self):
        with tempfile.TemporaryDirectory() as directory:
            depot = Path(directory)
            (depot / "ensure_bootstrap").touch()
            (depot / "python-bin").mkdir()
            (depot / "python-bin" / "python3").touch()
            env = {"DEPOT_TOOLS_DIR": str(depot), "DEPOT_TOOLS_UPDATE": "0"}
            def invoke(command, cwd, actual_env):
                self.assertEqual(cwd, depot)
                self.assertIs(actual_env, env)
                if command == [str(depot / "ensure_bootstrap")]:
                    (depot / "python3_bin_reldir.txt").write_text("python3/bin\n")
            with mock.patch.object(build, "run", side_effect=invoke) as run:
                build.ensure_depot_bootstrapped(depot, env)
            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args_list[1].args[0][0], str(depot / "python-bin" / "python3"))

    def test_bootstrap_without_marker_fails_before_any_build(self):
        with tempfile.TemporaryDirectory() as directory:
            depot = Path(directory)
            (depot / "ensure_bootstrap").touch()
            (depot / "python-bin").mkdir()
            (depot / "python-bin" / "python3").touch()
            with mock.patch.object(build, "run") as run:
                with self.assertRaisesRegex(RuntimeError, "did not install"):
                    build.ensure_depot_bootstrapped(depot, {})
            self.assertEqual(run.call_count, 1)

    def test_bootstrap_then_execute_python_wrapper_in_pinned_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            depot = Path(directory)
            bootstrap = depot / "ensure_bootstrap"
            bootstrap.write_text('#!/bin/sh\nprintf "python3/bin\\n" > "$DEPOT_TOOLS_DIR/python3_bin_reldir.txt"\n')
            bootstrap.chmod(0o755)
            (depot / "python-bin").mkdir()
            wrapper = depot / "python-bin" / "python3"
            wrapper.write_text('#!/bin/sh\ntouch "$DEPOT_TOOLS_DIR/wrapper-ran"\n')
            wrapper.chmod(0o755)
            env = dict(os.environ, DEPOT_TOOLS_DIR=str(depot), DEPOT_TOOLS_UPDATE="0")
            build.ensure_depot_bootstrapped(depot, env)
            self.assertTrue((depot / "wrapper-ran").is_file())
            self.assertEqual((depot / "python3_bin_reldir.txt").read_text(), "python3/bin\n")

    def test_aar_builder_receives_source_internal_build_dir_and_external_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "src"
            script = source / "tools_webrtc" / "android" / "build_aar.py"
            script.parent.mkdir(parents=True)
            # Match upstream's path admission, and capture the actual argv passed
            # through subprocess rather than only inspecting a mocked helper.
            script.write_text("""\
import argparse, json, pathlib
parser = argparse.ArgumentParser()
parser.add_argument('--build-dir', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--arch', nargs='*', required=True)
parser.add_argument('--extra-gn-args', nargs='*')
parser.add_argument('--extra-ninja-switches', nargs='*')
args = parser.parse_args()
src = pathlib.Path(__file__).resolve().parents[2]
assert pathlib.Path(args.build_dir).is_relative_to(src)
pathlib.Path(args.output).write_text(json.dumps(vars(args)))
""")
            output = root / "artifacts" / "test.aar"
            output.parent.mkdir()
            _, _, publisher = self.publisher_fixture(root)
            build.build_aar(source, output, ["arm64-v8a", "x86_64"], dict(os.environ), publisher)
            actual = json.loads(output.read_text())
            self.assertTrue(Path(actual["build_dir"]).is_relative_to(source))
            self.assertEqual(actual["arch"], ["arm64-v8a", "x86_64"])
            self.assertEqual(Path(actual["output"]), output)
            self.assertIn("rtc_use_h264=false", actual["extra_gn_args"])
            self.assertEqual(set(actual["extra_gn_args"]), {
                "is_debug=false", "use_rtti=true", "rtc_use_h264=false", "is_component_build=false",
                "rtc_build_examples=false", "rtc_build_tools=false", "rtc_enable_protobuf=false",
                "treat_warnings_as_errors=false"})
            # build_aar invokes Siso directly, so Ninja's compact -j2 is invalid;
            # Siso's -j is also ineffective. Keep a real local concurrency cap.
            self.assertEqual(actual["extra_ninja_switches"], ["-local_jobs=2"])
            self.assertNotIn("-j2", actual["extra_ninja_switches"])

    def test_floating_depot_tools_is_rejected_before_source_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            work, depot, patch, publisher_root, publisher = self.prepared_fixture(Path(directory))
            with mock.patch.object(build.subprocess, "check_output", return_value="unexpected"), \
                    mock.patch.object(build, "publisher_inputs", return_value=publisher), \
                    mock.patch.object(build, "run") as run:
                with self.assertRaisesRegex(RuntimeError, "depot_tools revision mismatch"):
                    build.prepare(work, depot, patch, publisher_root)
            run.assert_not_called()

    def test_focused_results_from_other_prepared_inputs_cannot_build_an_aar(self):
        with tempfile.TemporaryDirectory() as directory:
            work, depot, patch, publisher_root, publisher = self.prepared_fixture(Path(directory))
            stale = {"passed": True, "revision": build.REVISION,
                     "patch_sha256": hashlib.sha256(Path(build.__file__).with_name("source-rate-video.patch").read_bytes()).hexdigest(),
                     "prepared_state_sha256": "0" * 64}
            (work / "focused-tests.json").write_text(json.dumps(stale))
            argv = ["build.py", "build", "--work-dir", str(work), "--depot-tools", str(depot),
                    "--publisher-build", str(publisher_root), "--output", str(work / "output.aar")]
            with mock.patch.object(build.sys, "argv", argv), \
                    mock.patch.object(build, "prepare", return_value=(work / "src", {})), \
                    mock.patch.object(build, "publisher_inputs", return_value=publisher), \
                    mock.patch.object(build, "build_aar") as aar:
                with self.assertRaisesRegex(RuntimeError, "prepared build inputs"):
                    build.main()
            aar.assert_not_called()


if __name__ == "__main__":
    unittest.main()
