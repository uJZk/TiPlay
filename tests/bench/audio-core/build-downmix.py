#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Build measurement-only downmix probes, never production browser assets."""
import argparse
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--sdk', type=Path, required=True)
parser.add_argument('--output', type=Path, default=Path('work/downmix-probes'))
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
compiler = args.sdk.resolve() / 'bin/clang'
if 'clang version 23.1.0-wasi-sdk' not in subprocess.check_output([str(compiler), '--version'], text=True):
    raise SystemExit('Use the pinned WASI SDK34')
for simd in (False, True):
    output = args.output / ('downmix.simd.wasm' if simd else 'downmix.wasm')
    subprocess.run([str(compiler), '-O3', '-flto', '-ffp-contract=off', '-nostdlib',
                    '-Wl,--no-entry', '-Wl,--export-memory', '-Wl,--strip-all',
                    '-Wl,--initial-memory=1048576', '-Wl,--max-memory=1048576',
                    '-Wl,--export=audio_input', '-Wl,--export=audio_output', '-Wl,--export=audio_downmix',
                    *(['-msimd128'] if simd else []), str(Path(__file__).with_name('downmix-probe.c')),
                    '-o', str(output)], check=True)
