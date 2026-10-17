#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Reproduce/check Android's checked-in sources from the browser's pinned libsoxr archive."""
import argparse, hashlib, pathlib, re, shutil, subprocess, tarfile, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'site/play/vendor/soxr/source'
TARGET = ROOT / 'shared/src/main/jni/soxr'
FILES = ['soxr.c', 'soxr.h', 'data-io.c', 'data-io.h', 'vr32.c', 'vr-coefs.h',
         'internal.h', 'std-types.h', 'math-wrap.h', 'fifo.h', 'filter.h']

def prepare(output):
    archive = SOURCE / 'soxr-source.tar.gz'
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == 'ae970b44833c7dd2b088d5928b27c7f1796198ff5bc5386b90393aaf33e53d51'
    with tempfile.TemporaryDirectory() as temp:
        base = pathlib.Path(temp)
        with tarfile.open(archive) as tar:
            tar.extractall(base, filter='data')
        tree = base / 'soxr-945b592b70470e29f917f4de89b4281fbbd540c0'
        subprocess.run(['patch', '-p1', '--batch', '--forward', '-i', str(SOURCE / 'tiplay.patch')], cwd=tree, check=True)
        output.mkdir(parents=True, exist_ok=True)
        for name in FILES:
            shutil.copyfile(tree / 'src' / name, output / name)
        enabled = {'HAVE_FENV_H', 'HAVE_STDBOOL_H', 'HAVE_STDINT_H', 'HAVE_LRINT', 'WITH_VR32', 'WITH_HI_PREC_CLOCK'}
        (output / 'soxr-config.h').write_text(re.sub(r'#cmakedefine01 (\w+)',
            lambda match: '#define ' + match[1] + ' ' + str(int(match[1] in enabled)),
            (tree / 'soxr-config.h.in').read_text()))
        for name in ['COPYING.LGPL', 'LICENCE']:
            shutil.copyfile(ROOT / 'site/play/vendor/soxr' / name, output / name)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.check:
        with tempfile.TemporaryDirectory() as temp:
            output = pathlib.Path(temp)
            prepare(output)
            for path in output.iterdir():
                assert path.read_bytes() == (TARGET / path.name).read_bytes(), path.name
        print('Native sources match the browser source archive, patch and configuration.')
    else:
        prepare(TARGET)
