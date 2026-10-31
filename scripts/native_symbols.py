#!/usr/bin/env python3
"""Preserve producer ELF symbols without changing the shipped native library."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import struct
import subprocess
import tempfile
import zipfile

FORMAT = 'tiplay-native-symbols-v1'
ABIS = {'arm64-v8a': (2, 183), 'armeabi-v7a': (1, 40), 'x86': (1, 3), 'x86_64': (2, 62)}
ELF_ABIS = {**ABIS, 'armeabi': (1, 40), 'mips': (1, 8), 'mips64': (2, 8)}
PRODUCER_KEYS = {'component', 'source_revision', 'source_lock_sha256', 'patch_sha256',
                 'aar_sha256', 'apk_sha256', 'build_commit', 'workflow_run_id',
                 'workflow_run_attempt', 'gn_args', 'cmake_build_type', 'debug_flags',
                 'publisher_revision', 'prepared_state_sha256', 'archive_policy'}


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_elf(path, abi, readelf='readelf', require_build_id=True):
    path = Path(path)
    with path.open('rb') as stream:
        header = stream.read(20)
    if (abi not in ELF_ABIS or len(header) != 20 or header[:4] != b'\x7fELF'
            or header[5:7] != b'\x01\x01'
            or (header[4], struct.unpack_from('<H', header, 18)[0]) != ELF_ABIS[abi]):
        raise ValueError('ELF architecture does not match ' + abi)
    try:
        output = subprocess.check_output([str(readelf), '-W', '-S', '-n', str(path)],
                                         stderr=subprocess.PIPE, text=True)
    except subprocess.CalledProcessError:
        raise ValueError('Cannot inspect native ELF sections and Build ID') from None
    ids = set(value.lower() for value in re.findall(r'Build ID:\s*([0-9a-fA-F]+)', output))
    if len(ids) > 1 or (require_build_id and not ids) or any(
            not re.fullmatch(r'(?:[0-9a-f]{2}){4,64}', value) for value in ids):
        raise ValueError('Expected one nonempty GNU Build ID')
    return {'build_id': ids.pop() if ids else None,
            'debug_line': bool(re.search(r'\]\s+\.debug_line\s', output)),
            'symtab': bool(re.search(r'\]\s+\.symtab\s+SYMTAB\b', output))}


def producer_context(component, **inputs):
    trusted = (os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
               and os.environ.get('GITHUB_REF') == 'refs/heads/main'
               and os.environ.get('GITHUB_REPOSITORY') == 'uJZk/TiPlay')
    return {'component': component, **inputs,
            'build_commit': os.environ.get('GITHUB_SHA'),
            'workflow_run_id': os.environ.get('GITHUB_RUN_ID'),
            'workflow_run_attempt': os.environ.get('GITHUB_RUN_ATTEMPT'),
            'archive_policy': 'trusted-main-archive-job-required' if trusted else 'artifact-only'}


def write_index(directory, index):
    directory = Path(directory)
    with tempfile.NamedTemporaryFile(mode='w', dir=directory, prefix='index-', delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(index, stream, indent=2, sort_keys=True)
        stream.write('\n')
    try:
        temporary.replace(directory / 'index.json')
    finally:
        temporary.unlink(missing_ok=True)


def record(directory, abi, library, unstripped, packaged, producer, readelf='readelf'):
    """Record only an ELF from this build paired with its actual stripped output."""
    directory, unstripped, packaged = map(Path, (directory, unstripped, packaged))
    if (abi not in ABIS or not re.fullmatch(r'lib[A-Za-z0-9_.+-]+\.so', library)
            or set(producer) - PRODUCER_KEYS
            or producer.get('component') not in ('webrtc', 'rtc-audio', 'android-jni')):
        raise ValueError('Invalid native symbols identity or producer fields')
    source, output = inspect_elf(unstripped, abi, readelf), inspect_elf(packaged, abi, readelf)
    if source['build_id'] != output['build_id']:
        raise ValueError('Unstripped ELF and packaged ELF have different Build IDs')
    if not source['debug_line'] or not source['symtab']:
        raise ValueError('Producer ELF must retain DWARF line tables and a full symbol table')
    index_path = directory / 'index.json'
    index = json.loads(index_path.read_text()) if index_path.exists() else {
        'format': FORMAT, 'producer': producer, 'entries': []}
    if index.get('format') != FORMAT or index.get('producer') != producer:
        raise ValueError('Do not mix symbols from different producer inputs')
    relative = PurePosixPath(abi, source['build_id'], library)
    target = directory / relative
    entry = {'abi': abi, 'library': library, 'build_id': source['build_id'],
             'packaged_sha256': sha(packaged), 'packaged_bytes': packaged.stat().st_size,
             'symbol_file': relative.as_posix(), 'symbol_sha256': sha(unstripped),
             'symbol_bytes': unstripped.stat().st_size, 'debug_line': True, 'symtab': True}
    previous = [e for e in index['entries'] if (e['abi'], e['library']) == (abi, library)]
    if previous and previous != [entry]:
        raise ValueError('Refusing to replace a different native artifact in this index')
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_symlink() or (target.exists() and sha(target) != entry['symbol_sha256']):
        raise ValueError('Refusing to replace different symbols for the same Build ID')
    if not target.exists():
        shutil.copyfile(unstripped, target)
        target.chmod(0o600)
    index['entries'] = sorted([e for e in index['entries'] if (e['abi'], e['library']) != (abi, library)]
                              + [entry], key=lambda e: (e['abi'], e['library']))
    write_index(directory, index)
    return entry


def verify(directory, readelf='readelf'):
    directory = Path(directory).resolve()
    index_path = directory / 'index.json'
    if index_path.is_symlink():
        raise ValueError('Symbols index must not be a symlink')
    index = json.loads(index_path.read_text())
    producer = index.get('producer', {})
    if (set(index) - {'format', 'producer', 'entries', 'prebuilt_libraries'}
            or index.get('format') != FORMAT or not index.get('entries')
            or set(producer) - PRODUCER_KEYS
            or producer.get('component') not in ('webrtc', 'rtc-audio', 'android-jni')):
        raise ValueError('Invalid native symbols index')
    expected = {'index.json'}
    identities = set()
    for entry in index['entries']:
        if set(entry) != {'abi', 'library', 'build_id', 'packaged_sha256', 'packaged_bytes',
                          'symbol_file', 'symbol_sha256', 'symbol_bytes', 'debug_line', 'symtab'}:
            raise ValueError('Unexpected native symbol entry fields')
        abi, build_id, library = (entry[key] for key in ('abi', 'build_id', 'library'))
        if (abi not in ABIS or not re.fullmatch(r'(?:[0-9a-f]{2}){4,64}', build_id)
                or not re.fullmatch(r'lib[A-Za-z0-9_.+-]+\.so', library)
                or (abi, library) in identities):
            raise ValueError('Invalid or duplicate native symbol entry')
        identities.add((abi, library))
        relative = PurePosixPath(abi, build_id, library).as_posix()
        if entry['symbol_file'] != relative:
            raise ValueError('Unexpected native symbols path')
        path = directory / relative
        if path.is_symlink() or not path.resolve().is_relative_to(directory):
            raise ValueError('Native symbols must stay inside the dedicated directory')
        info = inspect_elf(path, abi, readelf)
        if (info['build_id'] != build_id or not info['debug_line'] or not info['symtab']
                or path.stat().st_size != entry['symbol_bytes'] or sha(path) != entry['symbol_sha256']
                or entry.get('debug_line') is not True or entry.get('symtab') is not True
                or not re.fullmatch(r'[0-9a-f]{64}', entry['packaged_sha256'])
                or entry['packaged_bytes'] < 1):
            raise ValueError('Native symbols do not match their index')
        expected.add(relative)
    for entry in index.get('prebuilt_libraries', []):
        if (set(entry) - {'abi', 'library', 'build_id', 'packaged_sha256', 'packaged_bytes', 'status', 'producer_archive'}
                or entry['abi'] not in ELF_ABIS or not re.fullmatch(r'lib[A-Za-z0-9_.+-]+\.so', entry['library'])
                or entry['status'] not in ('historical-missing', 'producer-archive')
                or not re.fullmatch(r'[0-9a-f]{64}', entry['packaged_sha256'])
                or entry['packaged_bytes'] < 1
                or (entry.get('build_id') is not None and not re.fullmatch(r'(?:[0-9a-f]{2}){4,64}', entry['build_id']))):
            raise ValueError('Invalid prebuilt symbols coverage record')
        reference = entry.get('producer_archive')
        if entry['status'] == 'producer-archive':
            if (not isinstance(reference, dict)
                    or set(reference) != {'index_sha256', 'archive_tag', 'archive_visibility'}
                    or not re.fullmatch(r'[0-9a-f]{64}', reference['index_sha256'])
                    or reference['archive_tag'] not in ('native-symbols-webrtc-' + reference['index_sha256'],
                                                       'native-symbols-rtc-audio-' + reference['index_sha256'])
                    or reference['archive_visibility'] != 'authenticated-draft-only'):
                raise ValueError('Invalid prebuilt producer archive reference')
        elif reference is not None:
            raise ValueError('Historical missing symbols must not claim an archive')
    actual = set()
    for path in directory.rglob('*'):
        if path.is_symlink():
            raise ValueError('Native symbols directory must not contain symlinks')
        if path.is_file():
            actual.add(path.relative_to(directory).as_posix())
    if actual != expected:
        raise ValueError('Symbols archive may contain only indexed ELF files and index.json')
    return index


def archive(directory, output, readelf='readelf'):
    directory, output = Path(directory).resolve(), Path(output).resolve()
    index = verify(directory, readelf)
    if output.is_relative_to(directory):
        raise ValueError('Archive must be outside the symbols directory')
    output.parent.mkdir(parents=True, exist_ok=True)
    paths = sorted(['index.json'] + [e['symbol_file'] for e in index['entries']])
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as target:
        for name in paths:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100600 << 16
            with (directory / name).open('rb') as source, target.open(info, 'w') as sink:
                shutil.copyfileobj(source, sink, 1024 * 1024)
    if output.stat().st_size >= 2 * 1024 ** 3:
        raise ValueError('Native symbols archive exceeds the GitHub Release asset limit')
    return output


def archive_tag(directory):
    directory = Path(directory)
    index = json.loads((directory / 'index.json').read_text())
    return 'native-symbols-' + index['producer']['component'] + '-' + sha(directory / 'index.json')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('verify', 'archive'))
    parser.add_argument('directory', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--readelf', default='readelf')
    args = parser.parse_args()
    if args.command == 'archive':
        if args.output is None:
            parser.error('--output is required for archive')
        archive(args.directory, args.output, args.readelf)
    else:
        verify(args.directory, args.readelf)
    print(archive_tag(args.directory))


if __name__ == '__main__':
    main()
