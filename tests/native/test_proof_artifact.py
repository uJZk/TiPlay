#!/usr/bin/env python3
"""Synthetic artifact identity checks; no Android or downloaded binaries are used."""
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import verify_proof_artifact as proof
from verify_producer_tree import PRODUCER_BLOBS


class ProofArtifactTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.patch = self.root / "patch"
        self.patch.write_bytes(b"patch")
        self.patch_sha = hashlib.sha256(b"patch").hexdigest()
        nested = io.BytesIO()
        with zipfile.ZipFile(nested, "w") as aar:
            aar.writestr("classes.jar", b"synthetic")
            aar.writestr("jni/x86_64/libjingle_peerconnection_so.so", b"synthetic")
        self.aar = nested.getvalue()
        self.sha = hashlib.sha256(self.aar).hexdigest()
        self.commit = "a" * 40
        self.run = {"id": 5, "head_sha": self.commit, "event": "workflow_dispatch", "conclusion": "success",
                    "path": ".github/workflows/native-source-rate.yml@refs/heads/temporary"}
        self.artifacts = {"artifacts": [{"id": 6, "name": "tiplay-source-rate-x86_64", "expired": False}]}
        self.record = {"aar_sha256": self.sha, "revision": proof.REVISION, "patch_sha256": self.patch_sha,
                       "architectures": ["x86_64"], "focused_tests": {"passed": True, "patch_sha256": self.patch_sha}}
        self.tree = {"truncated": False, "tree": []}
        for producer, reviewed in PRODUCER_BLOBS.items():
            content = ("reviewed:" + reviewed).encode()
            path = self.root / reviewed
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            sha = hashlib.sha1(f"blob {len(content)}\0".encode() + content).hexdigest()
            self.tree["tree"].append({"path": producer, "type": "blob", "mode": "100644", "sha": sha})

    def tearDown(self):
        self.temp.cleanup()

    def check(self, record=None, run=None, artifacts=None, tree=None, sha=None, include_aar=True):
        archive = self.root / "artifact.zip"
        with zipfile.ZipFile(archive, "w") as bundle:
            if include_aar:
                bundle.writestr(proof.EXPECTED[0], self.aar)
            bundle.writestr(proof.EXPECTED[1], json.dumps(record or self.record))
        return proof.verify(run or self.run, artifacts or self.artifacts, tree or self.tree, archive, self.root / "out",
                            run_id="5", head_sha=self.commit, aar_sha=sha or self.sha, patch=self.patch, root=self.root)

    def test_correct_identity_and_abi_is_accepted(self):
        self.assertEqual(self.check(), 6)
        self.assertEqual((self.root / "out" / proof.EXPECTED[0]).read_bytes(), self.aar)

    def test_bad_run_hash_or_patch_is_rejected(self):
        for change in ({"head_sha": "b" * 40}, {"conclusion": "failure"}, {"event": "push"}, {"id": 7},
                       {"path": ".github/workflows/android-release.yml@refs/heads/temporary"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.check(run=self.run | change)
        with self.assertRaises(ValueError):
            self.check(sha="b" * 64)
        with self.assertRaises(ValueError):
            self.check(record=self.record | {"patch_sha256": "c" * 64})

    def test_rejects_missing_abi_tests_or_ambiguous_artifact(self):
        for change in ({"architectures": ["arm64-v8a"]}, {"focused_tests": {"passed": False}}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.check(record=self.record | change)
        with self.assertRaises(ValueError):
            self.check(include_aar=False)
        with self.assertRaises(ValueError):
            self.check(artifacts={"artifacts": self.artifacts["artifacts"] * 2})

    def test_rejects_modified_producer_workflow_or_build_script(self):
        for path in PRODUCER_BLOBS:
            tree = {"truncated": False, "tree": [item.copy() for item in self.tree["tree"]]}
            next(item for item in tree["tree"] if item["path"] == path)["sha"] = "c" * 40
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.check(tree=tree)
        with self.assertRaises(ValueError):
            self.check(tree={"truncated": True, "tree": self.tree["tree"]})

    def test_rejects_missing_duplicate_or_nonregular_producer_blob(self):
        path = "scripts/webrtc/test_compat_javac.py"
        original = next(item for item in self.tree["tree"] if item["path"] == path)
        others = [item.copy() for item in self.tree["tree"] if item["path"] != path]
        variants = {
            "missing": others,
            "duplicate": others + [original.copy(), original.copy()],
            "tree-instead-of-blob": others + [original | {"type": "tree"}],
            "symlink": others + [original | {"mode": "120000"}],
            "executable-file": others + [original | {"mode": "100755"}],
        }
        for label, entries in variants.items():
            with self.subTest(label=label), self.assertRaises(ValueError):
                self.check(tree={"truncated": False, "tree": entries})


if __name__ == "__main__":
    unittest.main()
