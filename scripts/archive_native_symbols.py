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
import time

from native_symbols import archive, archive_tag, sha, verify

TRUSTED_REPOSITORY = 'uJZk/TiPlay'
READ_ATTEMPTS = 5
READ_DELAY_SECONDS = 1
ASSET_NAMES = {'native-symbols.zip', 'native-symbols-index.json'}


def gh(*arguments):
    return subprocess.check_output(['gh', *arguments], text=True, stderr=subprocess.PIPE)


def fresh(path):
    return path + ('&' if '?' in path else '?') + 'nonce=' + str(time.time_ns())


def find_release(repo, tag):
    pages = json.loads(gh('api', '--paginate', '--slurp', fresh(f'repos/{repo}/releases?per_page=100'),
                          '--header', 'Cache-Control: no-cache'))
    matches = [release for page in pages for release in page if release['tag_name'] == tag]
    if len(matches) > 1:
        raise ValueError('Multiple symbol archives use the requested tag')
    return matches[0] if matches else None


def release_id(release):
    identifier = release.get('id')
    if type(identifier) is not int or identifier <= 0:
        raise ValueError('Expected a positive native symbols release ID')
    return identifier


def read_release(identifier):
    if type(identifier) is not int or identifier <= 0:
        raise ValueError('Expected a positive native symbols release ID')
    try:
        release = json.loads(gh('api', fresh(f'repos/{TRUSTED_REPOSITORY}/releases/{identifier}'),
                                '--header', 'Cache-Control: no-cache'))
    except subprocess.CalledProcessError as error:
        if re.search(r'\bHTTP 404\b', error.stderr or ''):
            return None  # Only a temporarily missing read may be retried.
        raise
    if release_id(release) != identifier:
        raise ValueError('Native symbols release ID differs')
    return release


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


def await_complete_release(identifier, tag, commit, files):
    for attempt in range(READ_ATTEMPTS):
        release = read_release(identifier)
        if release is not None:
            # Published, identity, unexpected asset and digest mismatches are fatal immediately.
            if not validate_release(release, tag, commit, files, allow_missing=True):
                return release
        if attempt + 1 < READ_ATTEMPTS:
            time.sleep(READ_DELAY_SECONDS)
    raise ValueError('Native symbols archive is not completely visible after bounded reads')


def upload_asset(identifier, name, path):
    if type(identifier) is not int or identifier <= 0 or name not in ASSET_NAMES:
        raise ValueError('Unexpected native symbols upload target')
    asset = json.loads(gh('api', '--method', 'POST',
        f'https://uploads.github.com/repos/{TRUSTED_REPOSITORY}/releases/{identifier}/assets?name={name}',
        '--header', 'Content-Type: application/octet-stream', '--input', str(path)))
    if (type(asset.get('id')) is not int or asset['id'] <= 0 or asset.get('name') != name
            or asset.get('size') != path.stat().st_size or asset.get('digest') != 'sha256:' + sha(path)):
        raise ValueError('Uploaded native symbols asset identity or digest differs')
    return asset


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
            notes = (
                f'Native symbols for producer commit {commit}.\n'
                f'Component: {index["producer"]["component"]}.\n'
                f'Index SHA-256: {sha(manifest)}.\n'
                'ABI/Build ID and published ELF SHA-256 are recorded in the index.\n'
                'Authenticated maintenance archive; keep draft to exclude it from APK downloads.\n')
            payload = temporary / 'create-release.json'
            payload.write_text(json.dumps({'tag_name': tag, 'target_commitish': commit,
                'name': 'Native symbols ' + index['producer']['component'], 'body': notes,
                'draft': True, 'prerelease': True}))
            release = json.loads(gh('api', '--method', 'POST',
                f'repos/{TRUSTED_REPOSITORY}/releases', '--input', str(payload)))
        identifier = release_id(release)
        missing = validate_release(release, tag, commit, files, allow_missing=True)
        for name in sorted(missing):
            # The ID comes directly from creation or an existing verified draft; no tag/list lookup.
            # No overwrite, edit, delete or publish path exists for mismatched assets.
            upload_asset(identifier, name, files[name])
        release = await_complete_release(identifier, tag, commit, files)
        print(release['html_url'])
        return release


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    persist(parser.parse_args().directory)
