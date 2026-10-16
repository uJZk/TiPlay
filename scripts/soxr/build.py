#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Rebuild the replaceable offline soxr reactor with a Linux WASI SDK."""
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', required=True, type=pathlib.Path, help='Extracted wasi-sdk-34.0-x86_64-linux directory')
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[2]
    vendor = root / 'site/play/vendor/soxr'
    archive = vendor / 'soxr-source.tar.gz'
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise SystemExit('Pinned libsoxr source checksum mismatch')
    with tempfile.TemporaryDirectory(prefix='tiplay-soxr-') as directory:
        build = pathlib.Path(directory)
        with tarfile.open(archive) as source_archive:
            source_archive.extractall(build, filter='data')
        source = build / f'soxr-{COMMIT}'
        enabled = {'HAVE_FENV_H', 'HAVE_STDBOOL_H', 'HAVE_STDINT_H', 'HAVE_LRINT', 'WITH_VR32', 'WITH_HI_PREC_CLOCK'}
        config = re.sub(r'#cmakedefine01 (\w+)', lambda match: '#define ' + match[1] + ' ' + str(int(match[1] in enabled)), (source / 'soxr-config.h.in').read_text())
        (build / 'soxr-config.h').write_text(config)
        # Native ABI permits this return-type mismatch; WASM indirect calls require an exact signature.
        variable = (source / 'src/vr32.c').read_text()
        variable = variable.replace('typedef void (* fn_t)(void);', 'static void vr_process_wasm(rate_t * p, size_t n) { (void)vr_process(p, (int)n); }\n\ntypedef void (* fn_t)(void);')
        variable = variable.replace('(fn_t)vr_process,', '(fn_t)vr_process_wasm,')
        (build / 'vr32.c').write_text(variable)
        exports = ['tiplay_create', 'tiplay_process', 'tiplay_ratio', 'tiplay_input_done', 'tiplay_output_done', 'tiplay_delete', 'malloc', 'free']
        command = [str(args.sdk / 'bin/clang'), '-O3', '-DNDEBUG', '-DSOXR_LIB', '-I' + str(source / 'src'), '-I' + str(build),
                   str(source / 'src/soxr.c'), str(source / 'src/data-io.c'), str(build / 'vr32.c'), str(root / 'scripts/soxr/soxr-wrapper.c'),
                   '-mexec-model=reactor', '-Wl,--initial-memory=16777216', '-Wl,--max-memory=33554432',
                   *['-Wl,--export=' + name for name in exports], '-Wl,--strip-all', '-lm', '-o', str(vendor / 'soxr.wasm')]
        subprocess.run(command, check=True)
    print(hashlib.sha256((vendor / 'soxr.wasm').read_bytes()).hexdigest(), vendor / 'soxr.wasm')


if __name__ == '__main__':
    main()
