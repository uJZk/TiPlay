#!/usr/bin/env python3
"""Build the fixed libdatachannel encoded-media transport without codec libraries."""
import argparse, hashlib, json, os, pathlib, shutil, struct, subprocess, sys, tarfile, urllib.request
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import native_symbols
ROOT = pathlib.Path(__file__).resolve().parents[2]
VENDOR = ROOT / 'shared/src/main/jni/rtc-audio'
ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']
NOTICES = ROOT / 'shared/src/main/assets/licenses/rtc-audio'

def notice_sources():
    return [*(VENDOR / 'licenses').iterdir(), VENDOR / 'sources.lock.json', VENDOR / 'artifacts.json']

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def verify_library(path):
    data = path.read_bytes()
    if data[:4] != b'\x7fELF' or data[5] != 1: raise RuntimeError('Expected little-endian ELF: ' + str(path))
    bits = data[4]
    offset = struct.unpack_from('<Q' if bits == 2 else '<I', data, 32 if bits == 2 else 28)[0]
    size, count = struct.unpack_from('<HH', data, 54 if bits == 2 else 42)
    alignments = []
    for i in range(count):
        at = offset + i * size
        if struct.unpack_from('<I', data, at)[0] == 1:
            alignments.append(struct.unpack_from('<Q' if bits == 2 else '<I', data, at + (48 if bits == 2 else 28))[0])
    if not alignments or any(n < 16384 for n in alignments): raise RuntimeError('ELF does not support 16 KiB pages: ' + str(path))
    return {'bytes': len(data), 'sha256': sha(path), 'loadAlignments': alignments}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir', type=pathlib.Path, default=pathlib.Path('/tmp/tiplay-rtc-audio'))
    parser.add_argument('--abi', action='append', choices=ABIS)
    parser.add_argument('--ndk', type=pathlib.Path, default=os.environ.get('ANDROID_NDK_HOME'))
    parser.add_argument('--cmake', default=shutil.which('cmake'))
    parser.add_argument('--ninja', default=shutil.which('ninja'))
    parser.add_argument('--jobs', default='4')
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--host', action='store_true', help='Build a Linux host transport for browser/JNI tests; never package it for Android.')
    parser.add_argument('--symbols-dir', type=pathlib.Path, help='Dedicated unstripped ELF/index output (Android only).')
    args = parser.parse_args()
    if args.verify:
        manifest = json.loads((VENDOR / 'artifacts.json').read_text())
        for abi in ABIS:
            result = verify_library(VENDOR / 'prebuilt' / abi / 'libdatachannel.so')
            if result['sha256'] != manifest[abi]['sha256']: raise RuntimeError('Artifact checksum mismatch: ' + abi)
            print(abi, result['bytes'], result['sha256'])
        for source in notice_sources():
            if not (NOTICES / source.name).exists() or sha(NOTICES / source.name) != sha(source):
                raise RuntimeError('Packaged notice/provenance differs from native source: ' + source.name)
        if not (NOTICES / 'PROVENANCE.txt').is_file(): raise RuntimeError('Packaged source notice missing')
        return
    if not args.cmake or not args.ninja: parser.error('Supply CMake and Ninja executables.')
    if not args.host and not args.ndk: parser.error('--ndk or ANDROID_NDK_HOME is required.')
    work = args.work_dir.resolve(); (work / 'archives').mkdir(parents=True, exist_ok=True)
    sources = json.loads((VENDOR / 'sources.lock.json').read_text())
    for name, entry in sources.items():
        archive = work / 'archives' / (entry['repository'].rsplit('/', 1)[1] + '-' + entry['commit'] + '.tar.gz')
        if not archive.exists():
            with urllib.request.urlopen(entry['url'], timeout=90) as response: archive.write_bytes(response.read())
        if sha(archive) != entry['sha256']: raise RuntimeError('Source checksum mismatch: ' + name)
        target = work / 'src' / name
        if not (target / '.source-commit').exists():
            target.mkdir(parents=True, exist_ok=True)
            with tarfile.open(archive) as source:
                for member in source.getmembers():
                    parts = pathlib.PurePosixPath(member.name).parts
                    if len(parts) < 2: continue
                    member.name = str(pathlib.PurePosixPath(*parts[1:])); source.extract(member, target, filter='data')
            (target / '.source-commit').write_text(entry['commit'] + '\n')
        elif (target / '.source-commit').read_text().strip() != entry['commit']:
            raise RuntimeError('Stale source tree: ' + name)
    def run(command):
        print(' '.join(map(str, command)), flush=True)
        subprocess.run(list(map(str, command)), check=True)
    artifacts = json.loads((VENDOR / 'artifacts.json').read_text()) if (VENDOR / 'artifacts.json').exists() else {}
    symbols = (args.symbols_dir or work / 'native-symbols').resolve()
    producer = native_symbols.producer_context('rtc-audio',
        source_lock_sha256=sha(VENDOR / 'sources.lock.json'), cmake_build_type='Release',
        debug_flags=['-gline-tables-only'])
    for abi in ['host'] if args.host else args.abi or ABIS:
        build = work / 'build' / abi; prefix = work / 'install' / abi
        debug_flags = ' -gline-tables-only' if abi != 'host' else ''
        common = ['-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_POSITION_INDEPENDENT_CODE=ON',
            '-DCMAKE_C_FLAGS=-DMBEDTLS_SSL_DTLS_SRTP' + debug_flags,
            '-DCMAKE_CXX_FLAGS=-DMBEDTLS_SSL_DTLS_SRTP' + debug_flags,
            '-DCMAKE_MAKE_PROGRAM=' + args.ninja]
        if abi != 'host': common += ['-DCMAKE_TOOLCHAIN_FILE=' + str(args.ndk / 'build/cmake/android.toolchain.cmake'),
            '-DANDROID_ABI=' + abi, '-DANDROID_PLATFORM=android-25', '-DANDROID_STL=c++_static',
            '-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384 -Wl,--version-script=' + str(VENDOR / 'export-c-api.map')]
        run([args.cmake, '-S', work / 'src/mbedtls', '-B', build / 'mbedtls', *common,
            '-DENABLE_PROGRAMS=OFF', '-DENABLE_TESTING=OFF', '-DUSE_STATIC_MBEDTLS_LIBRARY=ON',
            '-DUSE_SHARED_MBEDTLS_LIBRARY=OFF', '-DCMAKE_INSTALL_PREFIX=' + str(prefix)])
        run([args.cmake, '--build', build / 'mbedtls', '--parallel', args.jobs])
        run([args.cmake, '--install', build / 'mbedtls'])
        host_link = ['-DCMAKE_CXX_STANDARD_LIBRARIES=-Wl,--start-group ' + ' '.join(str(prefix / ('lib/' + name)) for name in ['libmbedtls.a', 'libmbedx509.a', 'libmbedcrypto.a']) + ' -Wl,--end-group', '-DCMAKE_SHARED_LINKER_FLAGS=-Wl,--no-undefined -Wl,--version-script=' + str(VENDOR / 'export-c-api.map')] if abi == 'host' else []
        run([args.cmake, '-S', work / 'src/libdatachannel', '-B', build / 'libdatachannel', *common, *host_link,
            '-DUSE_MBEDTLS=ON', '-DUSE_GNUTLS=OFF', '-DNO_MEDIA=OFF', '-DNO_WEBSOCKET=ON', '-DNO_EXAMPLES=ON',
            '-DNO_TESTS=ON', '-DBUILD_SHARED_LIBS=ON', '-DBUILD_SHARED_DEPS_LIBS=OFF',
            '-DENABLE_WARNINGS_AS_ERRORS=OFF', '-DBUILD_WITH_WARNINGS=OFF', '-DTEST_APPS=OFF',
            '-DCMAKE_PREFIX_PATH=' + str(prefix), '-DMbedTLS_INCLUDE_DIR=' + str(prefix / 'include'),
            '-DMbedTLS_LIBRARY=' + str(prefix / 'lib/libmbedtls.a'), '-DMbedCrypto_LIBRARY=' + str(prefix / 'lib/libmbedcrypto.a'),
            '-DMbedX509_LIBRARY=' + str(prefix / 'lib/libmbedx509.a'), '-DMBEDTLS_LIBRARIES=' + str(prefix / 'lib/libmbedcrypto.a')])
        run([args.cmake, '--build', build / 'libdatachannel', '--target', 'datachannel', '--parallel', args.jobs])
        if abi == 'host':
            java_home = pathlib.Path(os.environ.get('JAVA_HOME', '/usr/lib/jvm/default-java'))
            run([os.environ.get('CC', 'cc'), '-shared', '-fPIC', '-pthread', '-O2', '-Wall', '-Wextra', '-Werror',
                '-DRTC_ENABLE_MEDIA=1', '-DRTC_ENABLE_WEBSOCKET=0', '-I' + str(java_home / 'include'),
                '-I' + str(java_home / 'include/linux'), '-I' + str(VENDOR / 'include'), VENDOR / 'rtc_audio_jni.c',
                '-L' + str(build / 'libdatachannel'), '-ldatachannel', '-Wl,-rpath,$ORIGIN/libdatachannel',
                '-o', build / 'libtiplay_rtc_audio.so'])
        if abi != 'host':
            output = VENDOR / 'prebuilt' / abi / 'libdatachannel.so'; output.parent.mkdir(parents=True, exist_ok=True)
            strip = args.ndk / 'toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip'
            run([strip, '--strip-unneeded', build / 'libdatachannel/libdatachannel.so', '-o', output])
            symbol_entry = native_symbols.record(symbols, abi, 'libdatachannel.so',
                build / 'libdatachannel/libdatachannel.so', output, producer,
                args.ndk / 'toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf')
            artifacts[abi] = {**verify_library(output), 'build_id': symbol_entry['build_id']}
            (VENDOR / 'artifacts.json').write_text(json.dumps(artifacts, indent=2) + '\n')
    if not args.host:
        native_symbols.verify(symbols, args.ndk / 'toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf')
        reference = {'format': native_symbols.FORMAT,
            'index_sha256': native_symbols.sha(symbols / 'index.json'),
            'archive_tag': native_symbols.archive_tag(symbols),
            'archive_visibility': 'authenticated-draft-only'}
        for abi in args.abi or ABIS:
            artifacts[abi]['native_symbols'] = reference
        (VENDOR / 'artifacts.json').write_text(json.dumps(artifacts, indent=2) + '\n')
        NOTICES.mkdir(parents=True, exist_ok=True)
        for source in notice_sources(): shutil.copyfile(source, NOTICES / source.name)

if __name__ == '__main__': main()
