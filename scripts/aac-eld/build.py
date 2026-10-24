#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Build the browser's AAC-ELD WASM from complete, unmodified FDK AAC 2.0.3.

Pinned toolchains: WASI SDK 34.0 (LLVM 23), CMake 4.1.2, Ninja 1.13.0.
The full upstream library is compiled; ordinary link-time dead-code elimination
retains the code reachable through the raw ELD interface. No source is pruned.
"""
import argparse
import hashlib
import pathlib
import subprocess
import shutil
import tempfile
import zipfile

SOURCE_SHA256 = '8237094063469f5442fbae764cf4277c311915785a1b9a7b0f9b78b0414c95bd'
EXPORTS = ['eld_input', 'eld_pcm', 'eld_close', 'eld_init', 'eld_decode', 'eld_conceal', 'eld_delay']


def main():
    root = pathlib.Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=pathlib.Path, required=True)
    parser.add_argument('--cmake', default='cmake')
    parser.add_argument('--ninja', default='ninja')
    parser.add_argument('--jobs', type=int, default=4)
    parser.add_argument('--output', type=pathlib.Path, default=root / 'site/play/vendor/aac-eld/aac-eld.wasm')
    args = parser.parse_args()
    vendor = root / 'site/play/vendor/aac-eld'
    source = vendor / 'aac-eld-source.zip'
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise SystemExit('FDK source checksum mismatch')
    sdk = args.sdk.resolve()
    if 'clang version 23.1.0-wasi-sdk' not in subprocess.check_output([str(sdk / 'bin/clang'), '--version'], text=True):
        raise SystemExit('Use WASI SDK 34.0 (clang 23.1.0)')
    if subprocess.check_output([args.cmake, '--version'], text=True).splitlines()[0] != 'cmake version 4.1.2':
        raise SystemExit('Use CMake 4.1.2 for reproducible output')
    if subprocess.check_output([args.ninja, '--version'], text=True).strip().startswith('1.13.0') is False:
        raise SystemExit('Use Ninja 1.13.0 for reproducible output')
    ninja = shutil.which(args.ninja)
    if ninja is None:
        raise SystemExit('Ninja executable not found')
    flags = '-O3 -flto -DNDEBUG -DSUPPRESS_BUILD_DATE_INFO'
    with tempfile.TemporaryDirectory(prefix='tiplay-eld-wasm-') as temporary:
        work = pathlib.Path(temporary)
        with zipfile.ZipFile(source) as archive:
            archive.extractall(work)
        build = work / 'build'
        subprocess.run([args.cmake, '-S', str(work / 'fdk'), '-B', str(build), '-G', 'Ninja',
                        '-DCMAKE_MAKE_PROGRAM=' + ninja,
                        '-DCMAKE_TOOLCHAIN_FILE=' + str(sdk / 'share/cmake/wasi-sdk-p1.cmake'),
                        '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF',
                        '-DFDK_AAC_INSTALL_CMAKE_CONFIG_MODULE=OFF', '-DFDK_AAC_INSTALL_PKGCONFIG_MODULE=OFF',
                        '-DCMAKE_C_FLAGS_RELEASE=' + flags, '-DCMAKE_CXX_FLAGS_RELEASE=' + flags,
                        '-DCMAKE_EXE_LINKER_FLAGS=-mexec-model=reactor'], check=True)
        subprocess.run([args.cmake, '--build', str(build), '-j', str(args.jobs)], check=True)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([str(sdk / 'bin/clang++'), *flags.split(), '-fno-exceptions', '-fno-rtti',
                        '-I' + str(work / 'fdk/libAACdec/include'), '-I' + str(work / 'fdk/libSYS/include'),
                        str(vendor / 'source/decoder.cpp'), str(build / 'libfdk-aac.a'),
                        '-mexec-model=reactor', '-Wl,--initial-memory=16777216', '-Wl,--max-memory=16777216',
                        '-Wl,--stack-first', '-Wl,-z,stack-size=1048576',
                        *['-Wl,--export=' + name for name in EXPORTS], '-Wl,--strip-all', '-lm',
                        '-o', str(args.output.resolve())], check=True)
    print(hashlib.sha256(args.output.read_bytes()).hexdigest(), args.output)


if __name__ == '__main__':
    main()
