"""Exact pinned source preparation for the encoded-audio producer."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tarfile
import urllib.request

FORMAT = 'tiplay-native-source-patches-v1'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def relative(value):
    if not isinstance(value, str):
        raise RuntimeError('Invalid source-relative path')
    path = PurePosixPath(value)
    if (not value or '\\' in value or path.is_absolute()
            or any(part in ('', '.', '..') for part in value.split('/'))):
        raise RuntimeError('Invalid source-relative path')
    return path


def patch_identity(source_lock, manifest_path):
    source_lock, manifest_path = Path(source_lock), Path(manifest_path)
    sources = json.loads(source_lock.read_text())
    manifest = json.loads(manifest_path.read_text())
    if (set(manifest) != {'format', 'patches'} or manifest['format'] != FORMAT
            or not isinstance(manifest['patches'], list) or len(manifest['patches']) != 1):
        raise RuntimeError('Expected the recorded encoded-audio source patch')
    for entry in manifest['patches']:
        if set(entry) != {'id', 'dependency', 'upstream_commit', 'file', 'sha256', 'targets'}:
            raise RuntimeError('Invalid source patch record')
        relative(entry['dependency'])
        if (entry['dependency'] not in sources
                or entry['upstream_commit'] != sources[entry['dependency']]['commit']
                or not re.fullmatch(r'[A-Za-z0-9._-]+', entry['id'])
                or relative(entry['file']).name != entry['file']
                or not re.fullmatch(r'[0-9a-f]{64}', entry['sha256'])
                or sha(manifest_path.parent / entry['file']) != entry['sha256']
                or not isinstance(entry['targets'], list) or not entry['targets']):
            raise RuntimeError('Source patch identity mismatch')
        seen = set()
        for target in entry['targets']:
            if set(target) != {'path', 'before_sha256', 'after_sha256'}:
                raise RuntimeError('Invalid source patch target')
            relative(target['path'])
            if (target['path'] in seen or not all(re.fullmatch(r'[0-9a-f]{64}', target[key])
                    for key in ('before_sha256', 'after_sha256'))
                    or target['before_sha256'] == target['after_sha256']):
                raise RuntimeError('Invalid source patch target identity')
            seen.add(target['path'])
    return {'format': FORMAT, 'manifest_sha256': sha(manifest_path), 'patches': manifest['patches']}


def source_identity(source_lock, manifest_path):
    """Deterministic recipe identity; every source file is separately checked before use."""
    lock_sha = sha(source_lock)
    patches = patch_identity(source_lock, manifest_path)
    prepared = {'format': 'tiplay-rtc-audio-prepared-v1',
                'source_lock_sha256': lock_sha, 'source_patches': patches}
    encoded = json.dumps(prepared, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('utf-8')
    return {'source_lock_sha256': lock_sha, 'source_patches': patches,
            'prepared_state_sha256': hashlib.sha256(encoded).hexdigest()}


def archive_inventory(archive):
    expected = {}
    with tarfile.open(archive) as package:
        for member in package.getmembers():
            parts = PurePosixPath(member.name).parts
            if len(parts) < 2 or member.isdir():
                continue
            path = str(relative(str(PurePosixPath(*parts[1:]))))
            if path in expected:
                raise RuntimeError('Duplicate source archive entry: ' + path)
            if member.isfile():
                with package.extractfile(member) as stream:
                    digest = hashlib.sha256(stream.read()).hexdigest()
                # Match Python's data extraction filter, including owner read/write.
                mode = member.mode & 0o755
                if not mode & 0o100:
                    mode &= ~0o111
                expected[path] = ('file', digest, mode | 0o600)
            elif member.issym():
                expected[path] = ('symlink', member.linkname)
            else:
                raise RuntimeError('Unsupported source archive entry: ' + path)
    return expected


def tree_inventory(target, nested):
    found = {}
    for directory, dirs, files in os.walk(target, followlinks=False):
        parent = Path(directory)
        for name in list(dirs):
            path = parent / name
            rel = path.relative_to(target).as_posix()
            if rel in nested:
                dirs.remove(name)
            elif path.is_symlink():
                found[rel] = ('symlink', os.readlink(path))
                dirs.remove(name)
        for name in files:
            path = parent / name
            rel = path.relative_to(target).as_posix()
            if rel == '.source-commit':
                continue
            found[rel] = ('symlink', os.readlink(path)) if path.is_symlink() else (
                'file', sha(path), stat.S_IMODE(path.stat().st_mode))
    return found


def verify_tree(target, expected, nested, targets, patched):
    allowed = dict(expected)
    for change in targets:
        record = expected.get(change['path'])
        if not record or record[0] != 'file' or record[1] != change['before_sha256']:
            raise RuntimeError('Patch preimage differs from pinned archive: ' + change['path'])
        actual = sha(target / change['path'])
        permitted = [change['after_sha256']] if patched else [change['before_sha256'], change['after_sha256']]
        if actual not in permitted:
            raise RuntimeError('Dirty source patch target: ' + change['path'])
        allowed[change['path']] = ('file', actual, record[2])
    found = tree_inventory(target, nested)
    if found != allowed:
        different = sorted(key for key in set(found) | set(allowed) if found.get(key) != allowed.get(key))
        raise RuntimeError('Dirty or unknown source tree: ' + ', '.join(different[:8]))
    return hashlib.sha256(json.dumps(found, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def verify_prepared_sources(work, source_lock, manifest_path):
    """After compilation, verify only; never silently repair a changed build input."""
    work, source_lock, manifest_path = map(Path, (work, source_lock, manifest_path))
    identity = source_identity(source_lock, manifest_path)
    sources = json.loads(source_lock.read_text())
    tree_hashes = {}
    for name, entry in sources.items():
        archive = work / 'archives' / (entry['repository'].rsplit('/', 1)[1] + '-' + entry['commit'] + '.tar.gz')
        if sha(archive) != entry['sha256']:
            raise RuntimeError('Source checksum mismatch: ' + name)
        target = work / 'src' / name
        marker = target / '.source-commit'
        if marker.is_symlink() or marker.read_text() != entry['commit'] + '\n':
            raise RuntimeError('Stale source tree: ' + name)
        nested = [other[len(name) + 1:] for other in sources if other.startswith(name + '/')]
        expected = {key: value for key, value in archive_inventory(archive).items()
                    if not any(key == child or key.startswith(child + '/') for child in nested)}
        changes = [change for patch in identity['source_patches']['patches'] if patch['dependency'] == name
                   for change in patch['targets']]
        tree_hashes[name] = verify_tree(target, expected, nested, changes, patched=True)
    return {**identity, 'verified_tree_sha256': tree_hashes}


def prepare_sources(work, source_lock, manifest_path):
    work, source_lock, manifest_path = map(Path, (work, source_lock, manifest_path))
    identity = source_identity(source_lock, manifest_path)
    sources = json.loads(source_lock.read_text())
    (work / 'archives').mkdir(parents=True, exist_ok=True)
    for name, entry in sources.items():
        relative(name)
        archive = work / 'archives' / (entry['repository'].rsplit('/', 1)[1] + '-' + entry['commit'] + '.tar.gz')
        if not archive.exists():
            with urllib.request.urlopen(entry['url'], timeout=90) as response:
                archive.write_bytes(response.read())
        if sha(archive) != entry['sha256']:
            raise RuntimeError('Source checksum mismatch: ' + name)
        target = work / 'src' / name
        marker = target / '.source-commit'
        if not marker.exists():
            if target.exists() and any(target.iterdir()):
                raise RuntimeError('Unmarked nonempty source tree: ' + name)
            target.mkdir(parents=True, exist_ok=True)
            with tarfile.open(archive) as package:
                for member in package.getmembers():
                    parts = PurePosixPath(member.name).parts
                    if len(parts) < 2:
                        continue
                    member.name = str(relative(str(PurePosixPath(*parts[1:]))))
                    package.extract(member, target, filter='data')
            marker.write_text(entry['commit'] + '\n')
        elif marker.is_symlink() or marker.read_text() != entry['commit'] + '\n':
            raise RuntimeError('Stale source tree: ' + name)
        nested = [other[len(name) + 1:] for other in sources if other.startswith(name + '/')]
        expected = archive_inventory(archive)
        expected = {key: value for key, value in expected.items()
                    if not any(key == child or key.startswith(child + '/') for child in nested)}
        changes = [change for patch in identity['source_patches']['patches'] if patch['dependency'] == name
                   for change in patch['targets']]
        verify_tree(target, expected, nested, changes, patched=False)
    for entry in identity['source_patches']['patches']:
        target = work / 'src' / entry['dependency']
        values = [sha(target / change['path']) for change in entry['targets']]
        if values == [change['after_sha256'] for change in entry['targets']]:
            continue
        if values != [change['before_sha256'] for change in entry['targets']]:
            raise RuntimeError('Partially applied source patch: ' + entry['id'])
        tool = shutil.which('patch')
        if not tool:
            raise RuntimeError('GNU patch is required to prepare the fixed source')
        command = [tool, '--batch', '--fuzz=0', '--no-backup-if-mismatch', '-p1',
                   '--input', str((manifest_path.parent / entry['file']).resolve())]
        for dry in (True, False):
            result = subprocess.run([*command, *(['--dry-run'] if dry else [])], cwd=target,
                                    capture_output=True, text=True)
            if result.returncode:
                raise RuntimeError('Cannot apply exact source patch: ' + entry['id'])
    prepared = verify_prepared_sources(work, source_lock, manifest_path)
    (work / 'prepared-source.json').write_text(json.dumps(prepared, indent=2) + '\n')
    return prepared
