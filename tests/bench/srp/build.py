#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Build the complete, unpruned LibTomMath 1.3.0 library with WASI SDK 34."""
import argparse
import hashlib
from pathlib import Path
import subprocess
import tarfile
import tempfile

VENDOR = Path(__file__).resolve().parent / 'libtommath'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=VENDOR / 'libtommath.wasm')
    args = parser.parse_args()
    compiler = args.sdk.resolve() / 'bin/clang'
    if 'clang version 23.1.0-wasi-sdk' not in subprocess.check_output([str(compiler), '--version'], text=True):
        raise SystemExit('Expected WASI SDK 34 / clang 23.1.0')
    archive = VENDOR / 'source/libtommath-v1.3.0.tar.gz'
    if hashlib.sha256(archive.read_bytes()).hexdigest() != '6d099e93ff00fa9b18346f4bcd97dcc48c3e91286f7e16c4ac5515a7171c3149':
        raise SystemExit('LibTomMath source archive checksum mismatch')
    with tempfile.TemporaryDirectory(prefix='tiplay-srp-') as temporary:
        with tarfile.open(archive) as package:
            package.extractall(temporary, filter='data')
        source = Path(temporary) / 'libtommath-1.3.0'
        args.output.parent.mkdir(parents=True, exist_ok=True)
        # Every library translation unit is compiled and every public function
        # remains exported. No custom feature header, MP_* pruning or JS fallback.
        subprocess.run([str(compiler), '-O3', '-flto', '-D__STDC_IEC_559__=1',
                        '-mexec-model=reactor', '-I', str(source),
                        '-Wl,--export-all', '-Wl,--strip-all',
                        '-Wl,--initial-memory=2097152', '-Wl,--max-memory=2097152',
                        *map(str, sorted(source.glob('bn_*.c'))),
                        str(VENDOR / 'source/srp-wrapper.c'), '-o', str(args.output)], check=True)
    print(hashlib.sha256(args.output.read_bytes()).hexdigest(), args.output)


if __name__ == '__main__':
    main()
