#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Build the allocation-free audio signal kernels with pinned WASI SDK 34."""
import argparse
import hashlib
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
EXPORTS = ['audio_input16', 'audio_input', 'audio_output', 'audio_last',
           'audio_recovery', 'audio_gain', 'audio_peak', 'audio_remaining',
           'audio_nonzero', 'audio_pcm16', 'audio_unpack', 'audio_quantize_planar',
           'audio_scan16', 'audio_fresh', 'audio_tail',
           'audio_mix_begin', 'audio_mix_add', 'audio_mix_tail', 'audio_mix_end']

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'site/play/wasm/audio-core.wasm')
    args = parser.parse_args()
    compiler = args.sdk / 'bin/clang'
    version = subprocess.check_output([str(compiler), '--version'], text=True)
    if 'clang version 23.1.0-wasi-sdk' not in version:
        raise SystemExit('Expected WASI SDK 34 / clang 23.1.0')
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([str(compiler), '-O3', '-flto', '-ffp-contract=off',
                    '-nostdlib', '-Wl,--no-entry', '-Wl,--export-memory',
                    '-Wl,--initial-memory=1048576', '-Wl,--max-memory=1048576',
                    '-Wl,--strip-all', *['-Wl,--export=' + name for name in EXPORTS],
                    str(ROOT / 'site/play/wasm/audio-core.c'), '-o', str(output)], check=True)
    print(hashlib.sha256(output.read_bytes()).hexdigest(), output)

if __name__ == '__main__':
    main()
