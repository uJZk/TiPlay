"""Exercise native source preparation with real local tar and patch fixtures."""

import contextlib
import copy
import difflib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts/rtc-audio"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


original_bytecode, original_path = sys.dont_write_bytecode, sys.path[:]
try:
    sys.dont_write_bytecode = True
    SOURCE_PATCHES = load_module("rtc_audio_source_patches_test_subject", SCRIPTS / "source_patches.py")
    with mock.patch.dict(sys.modules, {"source_patches": SOURCE_PATCHES}):
        BUILD = load_module("rtc_audio_build_patch_test_subject", SCRIPTS / "build.py")
finally:
    sys.dont_write_bytecode = original_bytecode
    sys.path[:] = original_path


def digest(data):
    return hashlib.sha256(data).hexdigest()


class SourcePatchPreparationTest(unittest.TestCase):
    def setUp(self):
        if not shutil.which("patch"):
            self.fail("GNU patch is required for this real source-preparation test")
        self.temporary = tempfile.TemporaryDirectory(prefix="tiplay-source-patch-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.config = self.root / "recipe"
        self.config.mkdir()
        self.work = self.root / "work"
        (self.work / "archives").mkdir(parents=True)
        self.commit = "a" * 40
        self.before = b"int candidate_allowed(void) {\n    return 0;\n}\n"
        self.after = b"int candidate_allowed(void) {\n    return 1;\n}\n"
        self.archive = self.work / "archives" / ("libjuice-" + self.commit + ".tar.gz")
        with tarfile.open(self.archive, "w:gz") as package:
            for name, content, mode in (
                    ("src/addr.c", self.before, 0o644),
                    ("src/unchanged.c", b"int unchanged = 7;\n", 0o644),
                    ("tools/generate.py", b"#!/usr/bin/python3\n", 0o755)):
                member = tarfile.TarInfo("upstream/" + name)
                member.size, member.mode, member.mtime = len(content), mode, 0
                package.addfile(member, io.BytesIO(content))
        self.patch = self.config / "ipv4-link-local.patch"
        self.patch.write_text("".join(difflib.unified_diff(
            self.before.decode().splitlines(keepends=True),
            self.after.decode().splitlines(keepends=True),
            fromfile="a/src/addr.c", tofile="b/src/addr.c")), encoding="utf-8")
        self.lock = self.config / "sources.lock.json"
        self.sources = {"libjuice": {
            "repository": "https://example.invalid/libjuice", "commit": self.commit,
            "url": "https://example.invalid/must-not-be-downloaded.tar.gz",
            "sha256": digest(self.archive.read_bytes()),
        }}
        self.write_json(self.lock, self.sources)
        self.manifest = self.config / "source-patches.json"
        self.patch_record = {
            "id": "libjuice-ipv4-link-local", "dependency": "libjuice",
            "upstream_commit": self.commit, "file": self.patch.name,
            "sha256": digest(self.patch.read_bytes()),
            "targets": [{"path": "src/addr.c", "before_sha256": digest(self.before),
                         "after_sha256": digest(self.after)}],
        }
        self.write_manifest()
        self.target = self.work / "src/libjuice"
        self.network = mock.patch.object(
            SOURCE_PATCHES.urllib.request, "urlopen",
            side_effect=AssertionError("tests must not download native sources"))
        self.network.start()
        self.addCleanup(self.network.stop)

    @staticmethod
    def write_json(path, value):
        path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")

    def write_manifest(self):
        self.write_json(self.manifest, {"format": SOURCE_PATCHES.FORMAT,
                                        "patches": [self.patch_record]})

    def prepare(self):
        return SOURCE_PATCHES.prepare_sources(self.work, self.lock, self.manifest)

    def verify(self):
        return SOURCE_PATCHES.verify_prepared_sources(self.work, self.lock, self.manifest)

    def reject_prepare_and_verify(self, reason):
        for operation in (self.prepare, self.verify):
            with self.subTest(operation=operation.__name__):
                with self.assertRaisesRegex(RuntimeError, reason):
                    operation()

    def test_exact_apply_is_idempotent_and_verifies(self):
        first = self.prepare()
        self.assertEqual((self.target / "src/addr.c").read_bytes(), self.after)
        self.assertEqual((self.target / ".source-commit").read_text(), self.commit + "\n")
        self.assertEqual((self.target / "tools/generate.py").stat().st_mode & 0o777, 0o755)
        marker = self.work / "prepared-source.json"
        first_marker = marker.read_bytes()
        with mock.patch.object(SOURCE_PATCHES.subprocess, "run",
                               side_effect=AssertionError("idempotent preparation reapplied patch")):
            self.assertEqual(self.prepare(), first)
        self.assertEqual(marker.read_bytes(), first_marker)
        self.assertEqual(self.verify(), first)
        self.assertEqual(json.loads(marker.read_text()), first)

    def test_dirty_patch_target_is_rejected_without_repair(self):
        self.prepare()
        path = self.target / "src/addr.c"
        path.write_bytes(self.after + b"/* dirty */\n")
        self.reject_prepare_and_verify("Dirty source patch target")
        self.assertEqual(path.read_bytes(), self.after + b"/* dirty */\n")

    def test_dirty_non_target_is_rejected(self):
        self.prepare()
        (self.target / "src/unchanged.c").write_text("int unchanged = 8;\n")
        self.reject_prepare_and_verify("Dirty or unknown source tree")

    def test_extra_file_is_rejected(self):
        self.prepare()
        (self.target / "unexpected.c").write_text("int extra;\n")
        self.reject_prepare_and_verify("Dirty or unknown source tree")

    def test_changed_file_mode_is_rejected(self):
        self.prepare()
        (self.target / "src/addr.c").chmod(0o755)
        self.reject_prepare_and_verify("Dirty or unknown source tree")

    def test_stale_marker_is_rejected(self):
        self.prepare()
        (self.target / ".source-commit").write_text("b" * 40 + "\n")
        self.reject_prepare_and_verify("Stale source tree")

    def test_patch_sha_mismatch_is_rejected(self):
        self.prepare()
        self.patch.write_bytes(self.patch.read_bytes() + b"\n")
        self.reject_prepare_and_verify("Source patch identity mismatch")

    def test_upstream_pin_mismatch_is_rejected(self):
        self.prepare()
        self.sources["libjuice"]["commit"] = "b" * 40
        self.write_json(self.lock, self.sources)
        self.reject_prepare_and_verify("Source patch identity mismatch")

    def test_archive_sha_mismatch_is_rejected(self):
        self.prepare()
        self.archive.write_bytes(self.archive.read_bytes() + b"changed archive")
        self.reject_prepare_and_verify("Source checksum mismatch")

    def test_wrong_preimage_hash_is_rejected(self):
        self.patch_record["targets"][0]["before_sha256"] = "0" * 64
        self.write_manifest()
        with self.assertRaisesRegex(RuntimeError, "Patch preimage differs from pinned archive"):
            self.prepare()

    def test_verify_does_not_reapply_removed_patch(self):
        self.prepare()
        (self.target / "src/addr.c").write_bytes(self.before)
        with self.assertRaisesRegex(RuntimeError, "Dirty source patch target"):
            self.verify()
        self.assertEqual((self.target / "src/addr.c").read_bytes(), self.before)

    def test_identity_is_canonical_and_independent_of_absolute_paths(self):
        identity = SOURCE_PATCHES.source_identity(self.lock, self.manifest)
        self.assertEqual(SOURCE_PATCHES.source_identity(self.lock, self.manifest), identity)
        relocated = self.root / "relocated"
        shutil.copytree(self.config, relocated)
        self.assertEqual(SOURCE_PATCHES.source_identity(
            relocated / self.lock.name, relocated / self.manifest.name), identity)
        prepared = {"format": "tiplay-rtc-audio-prepared-v1",
                    "source_lock_sha256": digest(self.lock.read_bytes()),
                    "source_patches": identity["source_patches"]}
        canonical = json.dumps(prepared, sort_keys=True, separators=(",", ":"),
                               ensure_ascii=True).encode("utf-8")
        self.assertEqual(identity["prepared_state_sha256"], digest(canonical))

    @contextlib.contextmanager
    def build_fixture(self):
        vendor, notices = self.root / "vendor", self.root / "notices"
        (vendor / "licenses").mkdir(parents=True)
        (vendor / "licenses/LICENSE").write_text("fixture license\n")
        shutil.copyfile(self.lock, vendor / "sources.lock.json")
        identity = SOURCE_PATCHES.source_identity(self.lock, self.manifest)
        artifacts = {abi: {**copy.deepcopy(identity), "sha256": "fixture-library", "bytes": 1}
                     for abi in BUILD.ABIS}
        self.write_json(vendor / "artifacts.json", artifacts)
        with mock.patch.multiple(BUILD, VENDOR=vendor, NOTICES=notices,
                                 PATCH_MANIFEST=self.manifest):
            yield vendor, notices, artifacts

    def run_build_verify(self):
        with mock.patch.object(sys, "argv", ["build.py", "--verify"]), \
                mock.patch.object(BUILD, "verify_library", return_value={
                    "sha256": "fixture-library", "bytes": 1}), \
                contextlib.redirect_stdout(io.StringIO()):
            BUILD.main()

    def test_notices_include_patch_and_manifest_and_verify_matching_bytes(self):
        with self.build_fixture() as (_, notices, _):
            sources = BUILD.notice_sources()
            self.assertIn(self.patch, sources)
            self.assertIn(self.manifest, sources)
            notices.mkdir()
            for source in sources:
                shutil.copyfile(source, notices / source.name)
            (notices / "PROVENANCE.txt").write_text("fixture provenance\n")
            self.run_build_verify()
            (notices / self.patch.name).write_bytes(b"wrong packaged patch")
            with self.assertRaisesRegex(RuntimeError, "Packaged notice/provenance differs"):
                self.run_build_verify()

    def test_build_verify_rejects_old_and_mismatched_patch_identities(self):
        with self.build_fixture() as (vendor, _, artifacts):
            for defect in ("legacy", "missing_patch", "missing_prepared", "wrong_patch", "wrong_prepared"):
                with self.subTest(defect=defect):
                    changed = copy.deepcopy(artifacts)
                    last = changed[BUILD.ABIS[-1]]
                    if defect == "legacy":
                        last.pop("source_patches")
                        last.pop("prepared_state_sha256")
                    elif defect == "missing_patch":
                        last.pop("source_patches")
                    elif defect == "missing_prepared":
                        last.pop("prepared_state_sha256")
                    elif defect == "wrong_patch":
                        last["source_patches"]["patches"][0]["sha256"] = "0" * 64
                    else:
                        last["prepared_state_sha256"] = "0" * 64
                    self.write_json(vendor / "artifacts.json", changed)
                    with self.assertRaisesRegex(RuntimeError, "Native source patch identity missing or mismatched"):
                        self.run_build_verify()


if __name__ == "__main__":
    unittest.main()
