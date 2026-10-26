import hashlib
import io
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from scripts.neteq import build


class NetEqSourceTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.cache = self.root / 'cache'
        self.cache.mkdir()

    def upstream(self):
        upstream = self.root / 'upstream'
        upstream.mkdir()
        subprocess.run(['git', 'init', '--quiet', str(upstream)], check=True)
        self.git(upstream, 'config', 'user.name', 'Source fixture')
        self.git(upstream, 'config', 'user.email', 'fixture@example.invalid')
        (upstream / 'input.cc').write_text('pinned source\n')
        (upstream / 'run').write_text('#!/bin/sh\nexit 0\n')
        (upstream / 'run').chmod(0o755)
        (upstream / 'alias').symlink_to('input.cc')
        self.git(upstream, 'add', '.')
        self.git(upstream, 'commit', '--quiet', '-m', 'pinned source')
        revision = self.git(upstream, 'rev-parse', 'HEAD')
        return upstream, {'name': 'webrtc', 'url': str(upstream), 'revision': revision,
                          'gitTree': self.git(upstream, 'rev-parse', 'HEAD^{tree}')}

    @staticmethod
    def git(repository, *arguments):
        return subprocess.check_output(['git', '-C', str(repository), *arguments], text=True).strip()

    def destination(self, name):
        destination = self.root / name
        destination.mkdir()
        return destination

    def test_pinned_commit_ignores_newer_remote_head_and_verified_cache_works_offline(self):
        upstream, source = self.upstream()
        (upstream / 'input.cc').write_text('later source\n')
        self.git(upstream, 'commit', '--quiet', '-a', '-m', 'later source')
        destination = self.destination('first')
        build.git_source(source, self.cache, destination)
        self.assertEqual((destination / 'input.cc').read_text(), 'pinned source\n')
        self.assertTrue((destination / 'run').stat().st_mode & 0o111)
        self.assertEqual((destination / 'alias').readlink(), Path('input.cc'))
        self.assertFalse((destination / '.git').exists())
        shutil.rmtree(upstream)
        offline = self.destination('offline')
        build.git_source(source, self.cache, offline)
        self.assertEqual((offline / 'input.cc').read_bytes(), (destination / 'input.cc').read_bytes())

    def test_wrong_tree_pin_rejects_source_before_materializing_files(self):
        _, source = self.upstream()
        source['gitTree'] = '0' * 40
        destination = self.destination('wrong-tree')
        with self.assertRaisesRegex(SystemExit, 'commit/tree mismatch'):
            build.git_source(source, self.cache, destination)
        self.assertEqual(list(destination.iterdir()), [])

    def test_damaged_cached_blob_is_rejected_even_when_commit_and_tree_names_match(self):
        _, source = self.upstream()
        build.git_source(source, self.cache, self.destination('first'))
        repository = self.cache / f'webrtc-{source["revision"]}.git'
        blob = self.git(repository, 'rev-parse', source['revision'] + ':input.cc')
        loose = repository / 'objects' / blob[:2] / blob[2:]
        loose.parent.mkdir(exist_ok=True)
        loose.unlink(missing_ok=True)  # Local Git transfers may share read-only object inodes.
        loose.write_bytes(b'corrupt cached object')
        destination = self.destination('damaged')
        with self.assertRaisesRegex(SystemExit, 'integrity failure'):
            build.git_source(source, self.cache, destination)
        self.assertEqual(list(destination.iterdir()), [])

    def test_malformed_git_pins_cannot_be_interpreted_as_git_options(self):
        source = {'name': 'webrtc', 'url': 'unused', 'revision': '--help', 'gitTree': '0' * 40}
        with self.assertRaisesRegex(SystemExit, 'Invalid Git source pin'):
            build.git_source(source, self.cache, self.destination('bad-pin'))
        self.assertEqual(list(self.cache.iterdir()), [])

    @staticmethod
    def archive():
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode='w:gz') as archive:
            entry = tarfile.TarInfo('release/source.c')
            data = b'pinned release source\n'
            entry.size = len(data)
            archive.addfile(entry, io.BytesIO(data))
        data = output.getvalue()
        return data, {'name': 'release', 'url': 'https://example.invalid/source.tar.gz',
                      'sha256': hashlib.sha256(data).hexdigest()}

    def test_release_archive_download_still_requires_exact_sha256(self):
        _, source = self.archive()
        with patch.object(build.urllib.request, 'urlopen', return_value=io.BytesIO(b'wrong archive')):
            with self.assertRaisesRegex(SystemExit, 'download checksum mismatch'):
                build.archive_source(source, self.cache, self.destination('bad-download'))
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_release_archive_cache_corruption_is_not_hidden_by_a_download(self):
        data, source = self.archive()
        destination = self.destination('release')
        with patch.object(build.urllib.request, 'urlopen', return_value=io.BytesIO(data)):
            build.archive_source(source, self.cache, destination)
        self.assertEqual((destination / 'release/source.c').read_bytes(), b'pinned release source\n')
        (self.cache / (source['sha256'] + '.tar.gz')).write_bytes(b'corrupt cached archive')
        with patch.object(build.urllib.request, 'urlopen') as download:
            with self.assertRaisesRegex(SystemExit, 'Cached source checksum mismatch'):
                build.archive_source(source, self.cache, self.destination('bad-cache'))
        download.assert_not_called()


if __name__ == '__main__':
    unittest.main()
