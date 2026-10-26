#!/usr/bin/env python3
"""Build identical minimal libav.js audio configurations, scalar and SIMD128.

Activate Emscripten 4.0.7 and Node 22 before running. Requires make, patch,
pkg-config and cmake on PATH. All upstream sources are in the pinned npm archive.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

URL = 'https://registry.npmjs.org/libav.js/-/libav.js-6.10.9.tgz'
SHA256 = '73f7a945d637c564edb050df7fd329845d4a9f556c6ce019bbcab7d778f16b97'
FRAGMENTS = ['avcodec', 'avformat', 'avfilter', 'decoder-aac', 'decoder-alac',
             'swresample', 'filter-aresample', 'filter-aformat']
ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-cache', type=Path, default=Path('/tmp/tiplay-libav-cache'))
    parser.add_argument('--output', type=Path, default=ROOT / 'site/play/vendor/libav')
    parser.add_argument('--jobs', type=int, default=min(os.cpu_count() or 2, 6))
    args = parser.parse_args()
    version = subprocess.check_output(['emcc', '--version'], text=True).splitlines()[0]
    if '4.0.7' not in version:
        raise SystemExit('Activate pinned Emscripten 4.0.7 before building')
    args.source_cache.mkdir(parents=True, exist_ok=True)
    archive = args.source_cache / 'libav.js-6.10.9.tgz'
    if not archive.exists():
        with urllib.request.urlopen(URL) as response:
            archive.write_bytes(response.read())
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
        raise SystemExit('libav.js archive checksum mismatch')
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='tiplay-libav-') as temporary:
        work = Path(temporary)
        with tarfile.open(archive) as source:
            source.extractall(work / 'npm', filter='data')
        sources = work / 'npm/package/sources'
        build = work / 'build'
        build.mkdir()
        with tarfile.open(sources / 'libav.js.tar.xz') as source:
            source.extractall(build, filter='data')
        (build / 'build').mkdir(exist_ok=True)
        for name in ['ffmpeg-9.0.tar.xz', 'emfiberthreads-1.3.tar.gz']:
            shutil.copyfile(sources / name, build / 'build' / name)
        source_records = {}
        (args.output / 'source').mkdir(exist_ok=True)
        for filename in ['libav.js.tar.xz', 'ffmpeg-9.0.tar.xz', 'emfiberthreads-1.3.tar.gz']:
            content = (sources / filename).read_bytes()
            (args.output / 'source' / filename).write_bytes(content)
            source_records[filename] = {'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content)}
        artifacts = {}
        for variant, flags in [('tiplay', '-O3'), ('tiplay-simd', '-O3 -msimd128')]:
            subprocess.run(['node', 'mkconfig.js', variant, json.dumps(FRAGMENTS)],
                           cwd=build / 'configs', check=True)
            name = f'libav-6.10.9.0-{variant}.wasm'
            subprocess.run(['make', f'-j{args.jobs}', f'OPTFLAGS={flags}',
                            f'dist/{name}.mjs'], cwd=build, env={**os.environ, 'PWD': str(build)}, check=True)
            for suffix in ['mjs', 'wasm']:
                filename = f'{name}.{suffix}'
                content = (build / 'dist' / filename).read_bytes()
                (args.output / filename).write_bytes(content)
                artifacts[filename] = {'sha256': hashlib.sha256(content).hexdigest(),
                                       'bytes': len(content)}
        (args.output / 'provenance.json').write_text(json.dumps({
            'upstream': URL, 'sourceSha256': SHA256, 'emscripten': '4.0.7',
            'ffmpeg': '9.0', 'fragments': FRAGMENTS,
            'flags': {'portable': '-O3', 'simd': '-O3 -msimd128'},
            'artifacts': artifacts, 'sources': source_records,
        }, indent=2) + '\n')


if __name__ == '__main__':
    main()
