#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Build TiPlay's replaceable libsoxr WebAssembly reactor from complete source.

Requires Python 3.12+, patch, pinned WASI SDK 34 and Binaryen 132.
The browser build does not apply the historical float32-only source reduction.
"""
import argparse
import hashlib
import pathlib
import re
import subprocess
import tarfile
import tempfile

COMMIT = '945b592b70470e29f917f4de89b4281fbbd540c0'
SOURCE_SHA256 = 'ae970b44833c7dd2b088d5928b27c7f1796198ff5bc5386b90393aaf33e53d51'
SDK_SHA256 = 'b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4'
SDK_URL = 'https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/wasi-sdk-34.0-x86_64-linux.tar.gz'
BINARYEN_URL = 'https://registry.npmjs.org/binaryen/-/binaryen-132.0.0.tgz'
BINARYEN_INTEGRITY = 'sha512-4Usg7yEvwO3FMso3Oov6qkOOHSod1IEv+boKkh77kTljM+eNBouqCTbqWswGzbG+vDNO/b/v2C4gfEh1WgB9Lg=='
EXPORTS = ['tiplay_create', 'tiplay_process', 'tiplay_ratio', 'tiplay_input_done',
           'tiplay_output_done', 'tiplay_delete', 'malloc', 'free']
PUBLIC_API = ['soxr_version', 'soxr_create', 'soxr_process', 'soxr_set_input_fn',
              'soxr_output', 'soxr_error', 'soxr_num_clips', 'soxr_delay',
              'soxr_engine', 'soxr_clear', 'soxr_delete', 'soxr_oneshot',
              'soxr_set_io_ratio', 'soxr_quality_spec', 'soxr_runtime_spec',
              'soxr_io_spec', 'soxr_set_error', 'soxr_set_num_channels']
SOURCES = ['soxr', 'data-io', 'dbesi0', 'filter', 'fft4g64', 'cr', 'cr32', 'fft4g32', 'cr64', 'vr32']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=pathlib.Path, required=True)
    parser.add_argument('--binaryen', type=pathlib.Path, required=True,
                        help='binaryen npm package directory (containing bin/)')
    root = pathlib.Path(__file__).resolve().parents[2]
    parser.add_argument('--output', type=pathlib.Path, default=root / 'site/play/vendor/soxr/soxr.wasm')
    parser.add_argument('--source-dir', type=pathlib.Path, default=root / 'site/play/vendor/soxr/source')
    args = parser.parse_args()
    source = args.source_dir.resolve()
    sdk = args.sdk.resolve()
    binaryen = args.binaryen.resolve() / 'bin'
    archive = source / 'soxr-source.tar.gz'
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise SystemExit('source checksum mismatch')
    if subprocess.check_output([str(binaryen / 'wasm-opt'), '--version'], text=True).strip() != 'wasm-opt version 132 (version_132)':
        raise SystemExit('expected binaryen version 132')
    with tempfile.TemporaryDirectory(prefix='tiplay-soxr-wasm-') as temp:
        build = pathlib.Path(temp)
        with tarfile.open(archive) as tar:
            tar.extractall(build, filter='data')
        tree = build / ('soxr-' + COMMIT)
        subprocess.run(['patch', '-p1', '--batch', '--forward', '-i', str(source / 'wasm.patch')], cwd=tree, check=True)
        enabled = {'HAVE_FENV_H', 'HAVE_STDBOOL_H', 'HAVE_STDINT_H', 'HAVE_LRINT',
                   'WITH_VR32', 'WITH_CR32', 'WITH_CR64', 'WITH_HI_PREC_CLOCK'}
        config = re.sub(r'#cmakedefine01 (\w+)',
                        lambda match: '#define ' + match[1] + ' ' + str(int(match[1] in enabled)),
                        (tree / 'soxr-config.h.in').read_text())
        (build / 'soxr-config.h').write_text(config)
        command = [str(sdk / 'bin/clang'), '-O3', '-flto', '-DNDEBUG', '-DSOXR_LIB',
                   '-I' + str(tree / 'src'), '-I' + str(build),
                   *[str(tree / 'src' / (name + '.c')) for name in SOURCES],
                   str(source / 'soxr-wrapper.c'), '-mexec-model=reactor',
                   '-Wl,--initial-memory=16777216', '-Wl,--max-memory=16777216',
                   *['-Wl,--export=' + name for name in EXPORTS + PUBLIC_API],
                   '-Wl,--strip-all', '-lm', '-o', str(build / 'engine.wasm')]
        subprocess.run(command, check=True)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([str(binaryen / 'wasm-opt'), str(build / 'engine.wasm'),
                        '--enable-bulk-memory', '--enable-bulk-memory-opt',
                        '--enable-nontrapping-float-to-int', '--enable-sign-ext',
                        '--enable-mutable-globals', '-O3', '-o', str(args.output.resolve())], check=True)
    print(hashlib.sha256(args.output.read_bytes()).hexdigest(), args.output)


if __name__ == '__main__':
    main()
