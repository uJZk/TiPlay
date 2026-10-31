#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Compare native producer blobs with the reviewed proof checkout before fetching its AAR."""
import argparse
import json
from pathlib import Path
import re
import subprocess

REPO = Path(__file__).resolve().parents[2]
PRODUCER_BLOBS = {
    ".github/workflows/native-source-rate.yml": ".github/workflows/native-source-rate.yml",
    "scripts/webrtc/build.py": "scripts/webrtc/build.py",
    "scripts/webrtc/test_build.py": "scripts/webrtc/test_build.py",
    "scripts/webrtc/test_compat_javac.py": "scripts/webrtc/test_compat_javac.py",
    "scripts/webrtc/source-rate-video.patch": "scripts/webrtc/source-rate-video.patch",
    "scripts/webrtc/publisher-compat.patch": "scripts/webrtc/publisher-compat.patch",
}


def verify_tree(tree, root=REPO):
    if tree.get("truncated") is not False or not isinstance(tree.get("tree"), list):
        raise ValueError("Producer tree must be complete")
    entries = tree["tree"]
    for producer_path, reviewed_path in PRODUCER_BLOBS.items():
        matching = [entry for entry in entries if entry.get("path") == producer_path]
        if len(matching) != 1 or matching[0].get("type") != "blob" or matching[0].get("mode") != "100644":
            raise ValueError("Producer lacks unique regular blob: " + producer_path)
        expected = subprocess.check_output(["git", "hash-object", "--", str(root / reviewed_path)],
                                           cwd=root, text=True).strip()
        actual = matching[0].get("sha", "")
        if not re.fullmatch(r"[0-9a-f]{40}", actual) or actual != expected:
            raise ValueError("Producer blob differs from reviewed checkout: " + producer_path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tree", type=Path, required=True)
    args = parser.parse_args()
    verify_tree(json.loads(args.tree.read_text()))
    print("Producer workflow and native build blobs match reviewed checkout.")


if __name__ == "__main__":
    main()
