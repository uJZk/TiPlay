#!/usr/bin/env python3
"""Print a bounded, redacted failure tail from the isolated emulator proof directory."""
import argparse
from collections import deque
from pathlib import Path
import re

MAX_LINES = 80
MAX_LINE_LENGTH = 400
ALLOWED_LOG = re.compile(r"(?:serial|bundle)-0-0(?:-source-rate)?\.log\Z")
SENSITIVE_FIELD = re.compile(r"\b(?:authorization|credential|password|passwd|token|ice[-_ ]?(?:pwd|ufrag))\b", re.I)
IPV4 = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")
IPV6 = re.compile(r"(?<![0-9a-f:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![0-9a-f:])", re.I)
URL = re.compile(r"https?://\S+", re.I)


def summarize(root, log):
    root = root.resolve(strict=True)
    candidate = log.resolve(strict=False)
    if not candidate.is_relative_to(root) or not ALLOWED_LOG.fullmatch(candidate.name):
        raise ValueError("Only known synthetic scenario logs within the proof directory are permitted")
    if not candidate.is_file():
        return "No synthetic scenario console log was created."
    with candidate.open(encoding="utf-8", errors="replace") as source:
        lines = deque(source, maxlen=MAX_LINES)
    result = []
    for raw in lines:
        line = raw.rstrip("\r\n")
        if SENSITIVE_FIELD.search(line):
            result.append("[line containing authentication material omitted]")
            continue
        line = "".join(ch if ch.isprintable() or ch == "\t" else "?" for ch in line)
        line = URL.sub("[URL]", IPV6.sub("[address]", IPV4.sub("[address]", line)))
        result.append(line[:MAX_LINE_LENGTH] + ("…" if len(line) > MAX_LINE_LENGTH else ""))
    return "\n".join(result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--log", type=Path, required=True)
    args = parser.parse_args()
    print(summarize(args.root, args.log))


if __name__ == "__main__":
    main()
