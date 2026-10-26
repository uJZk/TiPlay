#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Synchronize the offline runtime manifest; sources and licenses remain public."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / 'site/play'
RUNTIME_SUFFIXES = {'.js', '.mjs', '.wasm', '.css', '.html', '.svg', '.png'}


def assets():
    return ['./', *sorted(path.relative_to(PAGE).as_posix() for path in PAGE.rglob('*')
                          if path.is_file() and path.name != 'sw.js'
                          and path.suffix in RUNTIME_SUFFIXES
                          and 'source' not in path.relative_to(PAGE).parts
                          and path.relative_to(PAGE).parts[0] != 'chatgpt')]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    worker = PAGE / 'sw.js'
    old = worker.read_text()
    new, count = re.subn(r'const ASSETS = \[.*?\];', 'const ASSETS = ' + json.dumps(assets(), separators=(',', ':')) + ';', old)
    if count != 1:
        raise SystemExit('Expected exactly one browser runtime manifest')
    if args.check:
        if new != old:
            raise SystemExit('Browser cache is stale: run python3 scripts/update_browser_cache.py')
    else:
        worker.write_text(new)


if __name__ == '__main__':
    main()
