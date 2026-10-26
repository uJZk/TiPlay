#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Rebuild WASI audio-core/NetEq/SoundTouch; libav.js uses its separate Emscripten builder."""
import argparse
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / 'site/play'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=Path, required=True)
    parser.add_argument('--binaryen', type=Path, help=argparse.SUPPRESS)  # Legacy workflow argument; no longer needed.
    parser.add_argument('--cmake', default='cmake')
    parser.add_argument('--ninja', default='ninja')
    parser.add_argument('--check', action='store_true', help='Compare fresh builds without changing shipped files')
    args = parser.parse_args()
    sdk = str(args.sdk.resolve())
    with tempfile.TemporaryDirectory(prefix='tiplay-wasm-') as temporary:
        out = Path(temporary) if args.check else PAGE
        commands = [
            ['scripts/build_audio_core.py', '--output', str(out / 'wasm/audio-core.wasm')],
            ['scripts/neteq/build.py', '--cmake', args.cmake, '--ninja', args.ninja,
             '--output', str(out / 'vendor/neteq/neteq.wasm')],
            ['scripts/soundtouch/build.py', '--output', str(out / 'vendor/soundtouch')],
        ]
        for command in commands:
            subprocess.run([sys.executable, *command, '--sdk', sdk], cwd=ROOT, check=True)
        if args.check:
            for binary in sorted(out.rglob('*.wasm')):
                relative = binary.relative_to(out)
                if binary.read_bytes() != (PAGE / relative).read_bytes():
                    raise SystemExit(f'WASM build differs: {relative}')
                print('Verified', hashlib.sha256(binary.read_bytes()).hexdigest(), relative)


if __name__ == '__main__':
    main()
