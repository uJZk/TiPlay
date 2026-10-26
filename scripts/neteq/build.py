#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Build official NetEq and Opus for one-thread-per-instance browser audio.

WebRTC is pinned by Git commit/tree; release archives retain SHA-256 pins. Only platform services,
the decoder factory and the C ABI live in TiPlay; NetEq algorithms are unchanged.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
VENDOR = ROOT / 'site/play/vendor/neteq'


def git_source(source, cache, destination):
    """Materialize verified Git objects, independent of Gitiles' generated tar metadata."""
    revision, tree = source['revision'], source['gitTree']
    if not all(re.fullmatch(r'[0-9a-f]{40}', value) for value in (revision, tree)):
        raise SystemExit('Invalid Git source pin: ' + source['name'])
    repository = cache / (source['name'] + '-' + revision + '.git')
    if not repository.exists():
        subprocess.run(['git', 'init', '--bare', '--quiet', str(repository)], check=True)
    git = ['git', '--git-dir=' + str(repository)]
    exists = subprocess.run([*git, 'cat-file', '-e', revision + '^{commit}'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if not exists:
        subprocess.run([*git, 'fetch', '--depth=1', source['url'], revision], check=True)
    actual_commit = subprocess.check_output([*git, 'rev-parse', '--verify', revision + '^{commit}'], text=True).strip()
    actual_tree = subprocess.check_output([*git, 'rev-parse', '--verify', revision + '^{tree}'], text=True).strip()
    if actual_commit != revision or actual_tree != tree:
        raise SystemExit('Git source commit/tree mismatch: ' + source['name'])
    # A cached repository is not trusted merely because its object names match the manifest.
    integrity = subprocess.run([*git, 'fsck', '--full', '--strict'], capture_output=True)
    if integrity.returncode:
        raise SystemExit('Cached Git source integrity failure: ' + source['name'])
    with tempfile.TemporaryFile() as archive:
        subprocess.run([*git, 'archive', '--format=tar', revision], stdout=archive, check=True)
        archive.seek(0)
        with tarfile.open(fileobj=archive) as tar:
            tar.extractall(destination, filter='data')


def archive_source(source, cache, destination):
    archive = cache / (source['sha256'] + '.tar.gz')
    if not archive.exists():
        with urllib.request.urlopen(source['url'], timeout=120) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != source['sha256']:
            raise SystemExit('Upstream download checksum mismatch: ' + source['name'])
        archive.write_bytes(data)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != source['sha256']:
        raise SystemExit('Cached source checksum mismatch: ' + source['name'])
    with tarfile.open(archive) as tar:
        tar.extractall(destination, filter='data')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=Path, required=True)
    parser.add_argument('--cmake', default='cmake')
    parser.add_argument('--ninja', default='ninja')
    parser.add_argument('--jobs', type=int, default=4)
    parser.add_argument('--cache', type=Path, default=Path('/tmp/tiplay-neteq-sources'))
    parser.add_argument('--output', type=Path, default=VENDOR / 'neteq.wasm')
    args = parser.parse_args()
    if 'clang version 23.1.0-wasi-sdk' not in subprocess.check_output([str(args.sdk / 'bin/clang'), '--version'], text=True):
        raise SystemExit('Use WASI SDK 34.0')
    if subprocess.check_output([args.cmake, '--version'], text=True).splitlines()[0] != 'cmake version 4.1.2':
        raise SystemExit('Use CMake 4.1.2')
    if not subprocess.check_output([args.ninja, '--version'], text=True).startswith('1.13.0'):
        raise SystemExit('Use Ninja 1.13.0')
    sources = json.loads((VENDOR / 'provenance.json').read_text())['upstream']
    args.cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='tiplay-neteq-') as temporary:
        work = Path(temporary)
        for source in sources:
            destination = work / 'webrtc' if source['name'] == 'webrtc' else work
            destination.mkdir(exist_ok=True)
            if 'gitTree' in source:
                git_source(source, args.cache, destination)
            else:
                archive_source(source, args.cache, destination)
        opus_link = work / 'webrtc/third_party/opus/src'
        opus_link.parent.mkdir(parents=True)
        opus_link.symlink_to(work / 'opus-1.5.2', target_is_directory=True)
        shutil.copytree(VENDOR / 'source', work / 'port')
        shutil.copyfile(Path(__file__).with_name('CMakeLists.txt'), work / 'CMakeLists.txt')
        build = work / 'build'
        subprocess.run([args.cmake, '-S', str(work), '-B', str(build), '-G', 'Ninja',
                        '-DCMAKE_MAKE_PROGRAM=' + str(Path(shutil.which(args.ninja)).resolve()),
                        '-DCMAKE_TOOLCHAIN_FILE=' + str(args.sdk.resolve() / 'share/cmake/wasi-sdk-p1.cmake'),
                        '-DCMAKE_BUILD_TYPE=Release'], check=True)
        subprocess.run([args.cmake, '--build', str(build), '--target', 'neteq', '-j', str(args.jobs)], check=True)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(build / 'neteq', args.output)
    print(hashlib.sha256(args.output.read_bytes()).hexdigest(), args.output)


if __name__ == '__main__':
    main()
