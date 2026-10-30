#!/usr/bin/env python3
"""Fail closed before executing an AAR downloaded from a targeted Actions run."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile
from verify_producer_tree import verify_tree

REVISION = "73cb8180f7258ee292878d6edd05177f41883962"
EXPECTED = ("tiplay-source-rate.aar", "tiplay-source-rate.provenance.json")
MAX_AAR_BYTES = 1024 * 1024 * 1024


def verify(run, artifacts, tree, archive, output, *, run_id, head_sha, aar_sha, patch, root=None):
    if not re.fullmatch(r"[1-9][0-9]*", run_id):
        raise ValueError("Invalid native workflow run ID")
    if not re.fullmatch(r"[0-9a-f]{40}", head_sha) or not re.fullmatch(r"[0-9a-f]{64}", aar_sha):
        raise ValueError("Expected native commit and AAR hashes must be lowercase hex")
    if (run.get("id") != int(run_id) or run.get("head_sha") != head_sha
            or run.get("event") != "workflow_dispatch" or run.get("conclusion") != "success"
            or run.get("path", "").split("@")[0] != ".github/workflows/android-release.yml"):
        raise ValueError("Native run identity, workflow, or success does not match")
    verify_tree(tree, **({"root": root} if root is not None else {}))
    matching = [a for a in artifacts.get("artifacts", [])
                if a.get("name") == "tiplay-source-rate-x86_64" and not a.get("expired")]
    if len(matching) != 1:
        raise ValueError("Expected exactly one x86_64 native artifact")
    with zipfile.ZipFile(archive) as bundle:
        names = bundle.namelist()
        if any(names.count(name) != 1 for name in EXPECTED):
            raise ValueError("Artifact lacks unique AAR and provenance")
        if bundle.getinfo(EXPECTED[0]).file_size > MAX_AAR_BYTES or bundle.getinfo(EXPECTED[1]).file_size > 1024 * 1024:
            raise ValueError("Artifact payload too large")
        data = bundle.read(EXPECTED[0])
        provenance_bytes = bundle.read(EXPECTED[1])
    record = json.loads(provenance_bytes)
    patch_sha = hashlib.sha256(patch.read_bytes()).hexdigest()
    if (hashlib.sha256(data).hexdigest() != aar_sha or record.get("aar_sha256") != aar_sha
            or record.get("revision") != REVISION or record.get("patch_sha256") != patch_sha
            or record.get("architectures") != ["x86_64"]
            or record.get("focused_tests", {}).get("passed") is not True
            or record.get("focused_tests", {}).get("patch_sha256") != patch_sha):
        raise ValueError("AAR hash, native source, patch, ABI or focused-test provenance mismatch")
    output.mkdir(parents=True, exist_ok=True)
    aar_path = output / EXPECTED[0]
    aar_path.write_bytes(data)
    with zipfile.ZipFile(aar_path) as aar:
        if "classes.jar" not in aar.namelist() or "jni/x86_64/libjingle_peerconnection_so.so" not in aar.namelist():
            raise ValueError("Expected x86_64 JNI library and classes are missing")
    (output / EXPECTED[1]).write_bytes(provenance_bytes)
    return matching[0]["id"]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--run", type=Path, required=True)
    p.add_argument("--artifacts", type=Path, required=True)
    p.add_argument("--tree", type=Path, required=True)
    p.add_argument("--archive", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--run-id", required=True)
    p.add_argument("--head-sha", required=True)
    p.add_argument("--aar-sha", required=True)
    p.add_argument("--patch", type=Path, required=True)
    a = p.parse_args()
    artifact_id = verify(json.loads(a.run.read_text()), json.loads(a.artifacts.read_text()), json.loads(a.tree.read_text()), a.archive,
                         a.output, run_id=a.run_id, head_sha=a.head_sha, aar_sha=a.aar_sha, patch=a.patch)
    print(f"Validated x86_64 native artifact {artifact_id}; Android runtime remains unverified.")


if __name__ == "__main__":
    main()
