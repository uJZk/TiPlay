import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from scripts import publish_release_draft as release


class ReleaseDraftTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.directory = Path(temp.name)
        self.apk = self.directory / 'TiPlay-0.2.14-beta.1.apk'
        self.apk.write_bytes(b'apk fixture')
        self.source = self.directory / 'TiPlay-0.2.14-beta.1-source.zip'
        with zipfile.ZipFile(self.source, 'w') as archive:
            archive.writestr('TiPlay-0.2.14-beta.1/README.md', 'public source')
        self.checksum = self.directory / 'SHA256SUMS.txt'
        self.files = [self.apk, self.source, self.checksum]
        self.checksum.write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name + '\n' for p in self.files[:2]))
        self.commit = 'a' * 40
        self.metadata = {
            'draft': True, 'prerelease': True, 'target_commitish': self.commit,
            'html_url': 'https://github.com/example/repo/releases/draft',
            'assets': [{'id': i, 'name': p.name, 'size': p.stat().st_size,
                        'digest': 'sha256:' + hashlib.sha256(p.read_bytes()).hexdigest()}
                       for i, p in enumerate(self.files)],
        }

    def test_rejects_corrupt_apk_or_source(self):
        for path in self.files[:2]:
            with self.subTest(path=path.name):
                original = path.read_bytes()
                path.write_bytes(original + b'corrupt')
                with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                    release.validate_artifacts(self.directory)
                path.write_bytes(original)

    def test_rejects_credentials_in_source(self):
        with zipfile.ZipFile(self.source, 'a') as archive:
            archive.writestr('TiPlay-0.2.14-beta.1/identity.pk8', b'private')
        self.checksum.write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name + '\n' for p in self.files[:2]))
        with self.assertRaisesRegex(ValueError, 'source archive'):
            release.validate_artifacts(self.directory)

    @patch.object(release, 'gh')
    @patch.object(release, 'find_release', return_value={'draft': False})
    def test_preserves_published_release(self, find, gh):
        with self.assertRaisesRegex(ValueError, 'already published'):
            release.publish(self.directory, 'example/repo', self.commit)
        gh.assert_not_called()

    @patch.object(release, 'gh')
    @patch.object(release, 'find_release')
    def test_creates_missing_draft_with_three_assets(self, find, gh):
        find.side_effect = [None, self.metadata, self.metadata]
        release.publish(self.directory, 'example/repo', self.commit)
        self.assertEqual(gh.call_args_list[0].args[:2], ('release', 'create'))
        for path in self.files:
            self.assertIn(str(path), gh.call_args_list[1].args)
        self.assertEqual(gh.call_count, 2)

    @patch.object(release, 'gh')
    @patch.object(release, 'find_release')
    def test_rerun_removes_only_obsolete_assets(self, find, gh):
        legacy = dict(self.metadata, assets=self.metadata['assets'] + [{'id': 42, 'name': 'old.apk'}])
        find.side_effect = [legacy, legacy, self.metadata]
        release.publish(self.directory, 'example/repo', self.commit)
        self.assertEqual(gh.call_args_list[0].args[:2], ('release', 'edit'))
        self.assertIn('--clobber', gh.call_args_list[1].args)
        self.assertEqual(gh.call_args_list[2].args, ('api', '--method', 'DELETE', 'repos/example/repo/releases/assets/42'))

    @patch.object(release, 'gh')
    @patch.object(release, 'find_release')
    def test_upload_failure_preserves_other_assets(self, find, gh):
        find.return_value = self.metadata
        gh.side_effect = ['', subprocess.CalledProcessError(1, ['gh', 'release', 'upload'])]
        with self.assertRaises(subprocess.CalledProcessError):
            release.publish(self.directory, 'example/repo', self.commit)
        self.assertEqual(gh.call_count, 2)

    @patch.object(release.subprocess, 'run')
    def test_auth_failure_is_not_missing_draft(self, run):
        run.return_value = subprocess.CompletedProcess([], 1, '', 'HTTP 403')
        with self.assertRaisesRegex(RuntimeError, 'HTTP 403'):
            release.find_release('example/repo', 'v0.2.14-beta.1')

    @patch.object(release, 'gh')
    @patch.object(release, 'find_release')
    def test_checks_remote_digests(self, find, gh):
        corrupt = dict(self.metadata, assets=[dict(a, digest='sha256:bad') for a in self.metadata['assets']])
        find.side_effect = [None, corrupt, corrupt]
        with self.assertRaisesRegex(ValueError, 'Remote asset mismatch'):
            release.publish(self.directory, 'example/repo', self.commit)


if __name__ == '__main__':
    unittest.main()
