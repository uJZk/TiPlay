#!/usr/bin/env python3
"""Publish the current browser at /webrtc/ alongside an unchanged stable site.

    python3 scripts/assemble_beta_site.py [OUT] [--stable-ref FULL_COMMIT]

The stable build runs entirely inside a private temporary checkout containing only
public site inputs. Neither the working tree's download pages nor its stable root
are rebuilt from beta inputs. Only site/play/ is copied into the beta directory.
"""
import argparse
import io
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
PAGE = SITE / 'play'
STABLE_REF = 'ef0834151040d7c4f63dd3ce68787d146f48afe6'
INPUTS = ('site', 'scripts/build_site.py', 'scripts/assemble_site.py', 'gradle.properties')
MARKER = '.tiplay-beta-output'
MARKER_CONTENT = 'TiPlay isolated WebRTC beta output v1\n'


def validate_output(out: Path) -> Path:
    # Resolve parents, while rejecting symlinks before resolution could conceal them.
    out = out.absolute()
    if any(path.is_symlink() for path in (out, *out.parents)):
        raise ValueError('Refusing a symlink output or parent')
    out = out.resolve()
    if out == ROOT or out in ROOT.parents or out == SITE or SITE in out.parents:
        raise ValueError('Choose an output outside site/ and not above the repository')
    if out.exists():
        if not out.is_dir():
            raise ValueError('Output must be a directory')
        if any(out.iterdir()):
            marker = out / 'webrtc' / MARKER
            if not marker.is_file() or marker.is_symlink() or marker.read_text() != MARKER_CONTENT:
                raise ValueError('Refusing to replace a nonempty directory that is not beta output')
            # Even a valid marker cannot authorize traversing links or replacing tracked source.
            if any(path.is_symlink() for path in out.rglob('*')):
                raise ValueError('Refusing links in an existing beta output')
            tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).split(b'\0')
            if any((ROOT / os.fsdecode(name)).is_relative_to(out) for name in tracked if name):
                raise ValueError('Refusing to replace tracked repository files')
    return out


def validate_public_files(directory: Path) -> None:
    blocked = {'.pk8', '.p7b', '.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.apk', '.aab'}
    private_block = re.compile(rb'-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{40,}')
    for path in (directory, *directory.rglob('*')):
        if path.is_symlink():
            raise ValueError('Links are forbidden in public site inputs')
        if not path.is_file():
            continue
        if ('.private' in path.parts or path.name == '.env' or path.name.startswith('.env.')
                or path.suffix.lower() in blocked or private_block.search(path.read_bytes())):
            raise ValueError('Credential or distribution files are forbidden in public site inputs')


def extract_stable(destination: Path, stable_ref: str) -> None:
    if re.fullmatch(r'[0-9a-fA-F]{40}', stable_ref) is None:
        raise ValueError('stable-ref must be a full 40-digit hexadecimal commit ID')
    kind = subprocess.check_output(['git', 'cat-file', '-t', stable_ref], cwd=ROOT, text=True).strip()
    if kind != 'commit':
        raise ValueError('stable-ref must identify a commit')
    archive = subprocess.check_output(['git', 'archive', '--format=tar', stable_ref, *INPUTS], cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:') as source:
        for member in source:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not path.parts:
                raise ValueError('Unsafe path in stable archive')
            name = path.as_posix().rstrip('/')
            if not (name in INPUTS or name.startswith('site/') or name == 'scripts'):
                raise ValueError('Unexpected input in stable archive')
            target = destination.joinpath(*path.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as data, target.open('wb') as output:
                    shutil.copyfileobj(data, output)
            else:
                raise ValueError('Links and special files are forbidden in stable inputs')


def assemble(out: Path, stable_ref: str = STABLE_REF) -> None:
    out = validate_output(out)
    if not (PAGE / 'index.html').is_file():
        raise ValueError('site/play/index.html is missing')
    validate_public_files(PAGE)
    # The baseline scripts need no credentials. Inherit only their public URL setting.
    environment = {'PATH': os.defpath, 'LANG': 'C.UTF-8'}
    if os.environ.get('SITE_BASE_URL'):
        environment['SITE_BASE_URL'] = os.environ['SITE_BASE_URL']
    with tempfile.TemporaryDirectory(prefix='tiplay-beta-site-') as temporary:
        checkout = Path(temporary)
        extract_stable(checkout, stable_ref)
        validate_public_files(checkout / 'site')
        stable = checkout / '_stable'
        for arguments in [('scripts/build_site.py',), ('scripts/assemble_site.py', str(stable))]:
            subprocess.run([sys.executable, *arguments], cwd=checkout, env=environment, check=True)
        if (stable / 'webrtc').exists():
            raise ValueError('Stable site already reserves webrtc/')
        shutil.copytree(PAGE, stable / 'webrtc')
        (stable / 'webrtc' / MARKER).write_text(MARKER_CONTENT)
        # Finish and validate the build before replacing an authorized generated output.
        if out.exists():
            shutil.rmtree(out)
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(stable, out)
    print(f'Assembled {out}: stable {stable_ref.lower()} preserved, beta at webrtc/')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('out', nargs='?', type=Path, default=ROOT / '_site')
    parser.add_argument('--stable-ref', default=STABLE_REF)
    arguments = parser.parse_args()
    try:
        assemble(arguments.out, arguments.stable_ref)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error


if __name__ == '__main__':
    main()
