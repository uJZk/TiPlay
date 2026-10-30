#!/usr/bin/env python3
"""Focused build-driver checks; no network, compiler, or Android SDK required."""
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location("webrtc_build", Path(__file__).with_name("build.py"))
build = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build)


class BuildDriverTest(unittest.TestCase):
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
        depot = root / "depot"
        depot.mkdir()
        (depot / "gclient").touch()
        work = root / "work"
        (work / "src").mkdir(parents=True)
        patch = root / "source-rate-video.patch"
        patch.write_text("source patch\n")
        compat = root / "publisher-compat.patch"
        compat.write_text("compat patch\n")
        state = {"revision": build.REVISION,
                 "patch_sha256": hashlib.sha256(patch.read_bytes()).hexdigest(),
                 "publisher_compat_sha256": hashlib.sha256(compat.read_bytes()).hexdigest()}
        (work / "tiplay-prepared.json").write_text(json.dumps(state))
        return work, depot, patch

    def test_prepared_reuse_checks_both_patches_without_sync_or_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            work, depot, patch = self.prepared_fixture(Path(directory))
            with mock.patch.object(build.subprocess, "check_output",
                                   side_effect=[build.DEPOT_REVISION, build.DEPOT_REVISION, build.REVISION]), \
                    mock.patch.object(build, "ensure_depot_bootstrapped") as bootstrap, \
                    mock.patch.object(build, "run") as run:
                source, env = build.prepare(work, depot, patch)
            self.assertEqual(source, work / "src")
            self.assertEqual(env["DEPOT_TOOLS_UPDATE"], "0")
            self.assertEqual(env["DEPOT_TOOLS_DIR"], str(depot))
            self.assertEqual(env["DEPOT_TOOLS_BOOTSTRAP_PYTHON3"], "1")
            bootstrap.assert_called_once_with(depot, env)
            self.assertEqual(run.call_count, 2)
            for call in run.call_args_list:
                self.assertEqual(call.args[0][:4], ["git", "apply", "--reverse", "--check"])

    def test_changed_patch_cannot_reuse_prepared_source(self):
        with tempfile.TemporaryDirectory() as directory:
            work, depot, patch = self.prepared_fixture(Path(directory))
            patch.write_text("different source patch\n")
            with mock.patch.object(build.subprocess, "check_output", return_value=build.DEPOT_REVISION), \
                    mock.patch.object(build, "ensure_depot_bootstrapped"), \
                    mock.patch.object(build, "run") as run:
                with self.assertRaisesRegex(RuntimeError, "different patch"):
                    build.prepare(work, depot, patch)
            run.assert_not_called()

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
            build.build_aar(source, output, ["arm64-v8a", "x86_64"], dict(os.environ))
            actual = json.loads(output.read_text())
            self.assertTrue(Path(actual["build_dir"]).is_relative_to(source))
            self.assertEqual(actual["arch"], ["arm64-v8a", "x86_64"])
            self.assertEqual(Path(actual["output"]), output)
            self.assertIn("rtc_use_h264=false", actual["extra_gn_args"])
            # build_aar invokes Siso directly, so Ninja's compact -j2 is invalid;
            # Siso's -j is also ineffective. Keep a real local concurrency cap.
            self.assertEqual(actual["extra_ninja_switches"], ["-local_jobs=2"])
            self.assertNotIn("-j2", actual["extra_ninja_switches"])

    def test_floating_depot_tools_is_rejected_before_source_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            work, depot, patch = self.prepared_fixture(Path(directory))
            with mock.patch.object(build.subprocess, "check_output", return_value="unexpected"), \
                    mock.patch.object(build, "run") as run:
                with self.assertRaisesRegex(RuntimeError, "depot_tools revision mismatch"):
                    build.prepare(work, depot, patch)
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
