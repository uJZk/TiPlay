#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Build complete, unmodified SoundTouch 2.4.0 DSP as replaceable WebAssembly.

Use WASI SDK 34 (scripts/soxr/prepare-toolchain.py) and Python 3.12+.
Both portable and SIMD binaries retain a 16 MiB per-instance memory ceiling.
"""
import argparse
import hashlib
import pathlib
import subprocess
import tarfile
import tempfile

SOURCE_SHA256 = '3dda3c9ab1e287f15028c010a66ab7145fa855dfa62763538f341e70b4d10abd'
EXPORTS = ['tempo_live_create', 'tempo_set', 'tempo_create', 'tempo_delete', 'tempo_put', 'tempo_put_planar', 'tempo_available', 'tempo_receive', 'tempo_finish', 'malloc', 'free']

def main():
    root = pathlib.Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, default=root / 'site/play/vendor/soundtouch')
    args = parser.parse_args()
    vendor = root / 'site/play/vendor/soundtouch'
    archive = vendor / 'source/soundtouch-2.4.0.tar.gz'
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise SystemExit('SoundTouch source checksum mismatch')
    compiler = args.sdk.resolve() / 'bin/clang++'
    if not subprocess.check_output([str(compiler), '--version'], text=True).startswith('clang version 23.'):
        raise SystemExit('Expected WASI SDK 34 / clang 23')
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='tiplay-soundtouch-') as directory:
        build = pathlib.Path(directory)
        with tarfile.open(archive) as source:
            source.extractall(build, filter='data')
        upstream = build / 'soundtouch'
        # All upstream library translation units, including the BPM and rate/pitch
        # engines. Platform-specific SSE/MMX blocks naturally compile out on WASM.
        sources = sorted((upstream / 'source/SoundTouch').glob('*.cpp'))
        for simd in (False, True):
            output = args.output / ('soundtouch.simd.wasm' if simd else 'soundtouch.wasm')
            subprocess.run([str(compiler), '-O3', '-flto', '-ffast-math', '-fno-exceptions',
                '-DST_NO_EXCEPTION_HANDLING=1', '-DSOUNDTOUCH_FLOAT_SAMPLES=1', '-DNDEBUG',
                '-I' + str(upstream / 'include'), *map(str, sources),
                str(vendor / 'source/tempo-wrapper.cpp'),
                '-mexec-model=reactor', '-Wl,--initial-memory=4194304', '-Wl,--max-memory=16777216',
                *['-Wl,--export=' + name for name in EXPORTS], '-Wl,--strip-all',
                *(['-msimd128'] if simd else []), '-o', str(output)], check=True)
            print(hashlib.sha256(output.read_bytes()).hexdigest(), output)

if __name__ == '__main__':
    main()
