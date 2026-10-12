#!/usr/bin/env python3
"""Upload a verified APK, matching source and checksums to a release draft."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile


def gh(*args):
    return subprocess.check_output(['gh', *args], text=True)


def find_release(repo, tag):
    result = subprocess.run(
        ['gh', 'api', '--paginate', '--slurp', f'repos/{repo}/releases?per_page=100'],
        text=True, capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())
    # The tag endpoint can return 404 for an unpublished draft. List releases
    # with authentication instead, including all pages so reruns find old drafts.
    matches = [release for page in json.loads(result.stdout) for release in page
               if release['tag_name'] == tag]
    if len(matches) > 1:
        raise ValueError('Multiple releases have the requested tag')
    return matches[0] if matches else None


def validate_artifacts(directory):
    apks = list(directory.glob('TiPlay-*.apk'))
    if len(apks) != 1:
        raise ValueError('Expected exactly one TiPlay APK')
    apk = apks[0]
    match = re.fullmatch(r'TiPlay-([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)\.apk', apk.name)
    if not match:
        raise ValueError('Invalid release APK name')
    version = match.group(1)
    source = directory / f'TiPlay-{version}-source.zip'
    checksum = directory / 'SHA256SUMS.txt'
    files = [apk, source, checksum]
    if {p.name for p in directory.iterdir()} != {p.name for p in files}:
        raise ValueError('Expected exactly APK, source ZIP and SHA256SUMS.txt')
    sums = ''.join(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name + '\n' for path in [apk, source])
    if checksum.read_text() != sums:
        raise ValueError('APK or source checksum mismatch')
    blocked = {'.pk8', '.p7b', '.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.apk', '.aab'}
    private = re.compile(rb'-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{40,}')
    with zipfile.ZipFile(source) as archive:
        for name in archive.namelist():
            if Path(name).suffix.lower() in blocked or private.search(archive.read(name)):
                raise ValueError('Credential or distribution file in source archive')
    return files, version


def publish(directory, repo, commit):
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('A full build commit is required')
    files, version = validate_artifacts(directory)
    digest = hashlib.sha256(files[0].read_bytes()).hexdigest()
    tag = f'v{version}'
    release = find_release(repo, tag)
    if release is not None and not release['draft']:
        raise ValueError('Refusing to modify an already published release')
    notes = (
        f'TiPlay {version} — signed release APK for Android phone + car browser use.\n\n'
        f'Build commit: `{commit}`.\n\n'
        'CarPlay runtime identity extracted unchanged from the hash-verified upstream '
        '[DiPlay 0.2.18 APK](https://github.com/shihabal3amri/DiPlay/releases/tag/v0.2.18). '
        'This experimental identity is extractable from the APK; signing keys are excluded.\n\n'
        'Real-car CarPlay, complete Bluetooth audio and iPhone AirPlay acceptance remain pending.\n\n'
        f'APK SHA-256: `{digest}`.\n'
    )
    with tempfile.TemporaryDirectory() as temp:
        notes_file = Path(temp) / 'notes.md'
        notes_file.write_text(notes)
        command = 'create' if release is None else 'edit'
        gh('release', command, tag, '--repo', repo, '--draft', '--prerelease',
           '--target', commit, '--title', f'TiPlay {version}', '--notes-file', str(notes_file))
    gh('release', 'upload', tag, *(str(path) for path in files), '--repo', repo, '--clobber')
    release = find_release(repo, tag)
    if not release or not release['draft']:
        raise ValueError('Release must remain a draft')
    expected = {path.name for path in files}
    for asset in release['assets']:
        if asset['name'] not in expected:
            gh('api', '--method', 'DELETE', f'repos/{repo}/releases/assets/{asset["id"]}')
    release = find_release(repo, tag)
    if not release or not release['draft'] or not release['prerelease']:
        raise ValueError('Expected a beta release draft')
    assets = {asset['name']: asset for asset in release['assets']}
    if set(assets) != expected or release['target_commitish'] != commit:
        raise ValueError('Unexpected draft assets or build target')
    for path in files:
        asset = assets[path.name]
        expected_digest = 'sha256:' + hashlib.sha256(path.read_bytes()).hexdigest()
        if asset['size'] != path.stat().st_size or asset.get('digest') != expected_digest:
            raise ValueError(f'Remote asset mismatch: {path.name}')
    print(release['html_url'])


if __name__ == '__main__':
    publish(Path('release-artifacts'), os.environ['GH_REPO'], os.environ['GITHUB_SHA'])
