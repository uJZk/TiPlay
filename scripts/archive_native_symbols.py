#!/usr/bin/env python3
"""Keep verified native symbols in a durable, authenticated draft Release only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from native_symbols import archive, archive_tag, sha, verify

TRUSTED_REPOSITORY = 'uJZk/TiPlay'


def gh(*arguments):
    return subprocess.check_output(['gh', *arguments], text=True)


def find_release(repo, tag):
    pages = json.loads(gh('api', '--paginate', '--slurp', f'repos/{repo}/releases?per_page=100'))
    matches = [release for page in pages for release in page if release['tag_name'] == tag]
    if len(matches) > 1:
        raise ValueError('Multiple symbol archives use the requested tag')
    return matches[0] if matches else None


def validate_release(release, tag, commit, files, allow_missing):
    # Drafts are retained indefinitely but omitted from the public APK release index.
    if not release['draft']:
        raise ValueError('Native symbols Release must remain draft; never modify a published release')
    if (release['tag_name'] != tag or release['target_commitish'] != commit
            or release['prerelease'] is not True):
        raise ValueError('Native symbols archive identity differs')
    actual = {asset['name']: asset for asset in release['assets']}
    if len(actual) != len(release['assets']) or set(actual) - set(files):
        raise ValueError('Unexpected native symbols archive assets')
    for name, asset in actual.items():
        path = files[name]
        if asset['size'] != path.stat().st_size or asset.get('digest') != 'sha256:' + sha(path):
            raise ValueError('Refusing to overwrite a different native symbols asset: ' + name)
    if not allow_missing and set(actual) != set(files):
        raise ValueError('Native symbols archive is incomplete')
    return set(files) - set(actual)


def validate_producer_archives(index):
    """New prebuilt producer references must exist before a main APK draft can ship."""
    retained = {}
    for entry in index.get('prebuilt_libraries', []):
        if entry['status'] == 'historical-missing':
            continue  # Old stripped binaries cannot acquire invented matching symbols.
        reference = entry['producer_archive']
        tag = reference['archive_tag']
        if tag not in retained:
            release = find_release(TRUSTED_REPOSITORY, tag)
            if release is None or not release['draft'] or not release['prerelease']:
                raise ValueError('Referenced producer symbols draft is unavailable')
            assets = {asset['name']: asset for asset in release['assets']}
            if set(assets) != {'native-symbols.zip', 'native-symbols-index.json'} or len(assets) != len(release['assets']):
                raise ValueError('Referenced producer symbols draft is incomplete')
            manifest = assets['native-symbols-index.json']
            if manifest.get('digest') != 'sha256:' + reference['index_sha256']:
                raise ValueError('Referenced producer index digest differs')
            raw = gh('api', f'repos/{TRUSTED_REPOSITORY}/releases/assets/{manifest["id"]}',
                     '--header', 'Accept: application/octet-stream').encode('utf-8')
            if hashlib.sha256(raw).hexdigest() != reference['index_sha256']:
                raise ValueError('Downloaded producer index digest differs')
            retained[tag] = json.loads(raw)
        candidates = [item for item in retained[tag]['entries']
                      if item['abi'] == entry['abi'] and item['library'] == entry['library']]
        if (len(candidates) != 1 or any(candidates[0][key] != entry[key]
                                      for key in ('build_id', 'packaged_sha256', 'packaged_bytes'))):
            raise ValueError('Producer symbols index does not match the APK native library')


def persist(directory, env=os.environ):
    if (env.get('GITHUB_EVENT_NAME') != 'workflow_dispatch'
            or env.get('GITHUB_REF') != 'refs/heads/main'
            or env.get('GITHUB_REPOSITORY') != TRUSTED_REPOSITORY):
        raise ValueError('Durable symbols archive is allowed only in the trusted main manual workflow')
    directory = Path(directory)
    index = verify(directory)
    commit = env.get('GITHUB_SHA', '')
    if not re.fullmatch(r'[0-9a-f]{40}', commit) or index['producer'].get('build_commit') != commit:
        raise ValueError('Symbols producer commit does not match this workflow')
    validate_producer_archives(index)
    tag = archive_tag(directory)
    with tempfile.TemporaryDirectory(prefix='tiplay-symbols-assets-') as temporary:
        temporary = Path(temporary)
        bundle = archive(directory, temporary / 'native-symbols.zip')
        manifest = temporary / 'native-symbols-index.json'
        shutil.copyfile(directory / 'index.json', manifest)
        files = {path.name: path for path in (bundle, manifest)}
        release = find_release(TRUSTED_REPOSITORY, tag)
        if release is None:
            notes = temporary / 'notes.txt'
            notes.write_text(
                f'Native symbols for producer commit {commit}.\n'
                f'Component: {index["producer"]["component"]}.\n'
                f'Index SHA-256: {sha(manifest)}.\n'
                'ABI/Build ID and published ELF SHA-256 are recorded in the index.\n'
                'Authenticated maintenance archive; keep draft to exclude it from APK downloads.\n')
            gh('release', 'create', tag, '--repo', TRUSTED_REPOSITORY, '--draft', '--prerelease',
               '--target', commit, '--title', 'Native symbols ' + index['producer']['component'],
               '--notes-file', str(notes))
            release = find_release(TRUSTED_REPOSITORY, tag)
        if release is None:
            raise ValueError('Native symbols draft was not created')
        missing = validate_release(release, tag, commit, files, allow_missing=True)
        if missing:
            # No --clobber, edit, delete or publish path: mismatched assets are immutable.
            gh('release', 'upload', tag, *(str(files[name]) for name in sorted(missing)),
               '--repo', TRUSTED_REPOSITORY)
        release = find_release(TRUSTED_REPOSITORY, tag)
        if release is None:
            raise ValueError('Native symbols draft disappeared')
        validate_release(release, tag, commit, files, allow_missing=False)
        print(release['html_url'])
        return release


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    persist(parser.parse_args().directory)
