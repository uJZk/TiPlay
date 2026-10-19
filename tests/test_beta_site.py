import hashlib
import io
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from scripts import assemble_beta_site as beta


def files(directory, exclude_beta=False):
    return {str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in directory.rglob('*') if path.is_file()
            and not (exclude_beta and path.relative_to(directory).parts[0] == 'webrtc')}


class BetaSiteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='tiplay-beta-test-')
        cls.directory = Path(cls.temporary.name)
        cls.output = cls.directory / 'published'
        beta.assemble(cls.output)
        # Independent oracle: build the actual pinned commit's own scripts and compare every
        # stable/download asset. This catches accidentally assembling stable from beta inputs.
        original = cls.directory / 'baseline'
        original.mkdir()
        archive = subprocess.check_output(['git', 'archive', beta.STABLE_REF,
                                           'site', 'scripts', 'gradle.properties'], cwd=beta.ROOT)
        with tarfile.open(fileobj=io.BytesIO(archive)) as source:
            source.extractall(original, filter='data')
        subprocess.run([sys.executable, 'scripts/build_site.py'], cwd=original, check=True,
                       stdout=subprocess.DEVNULL)
        cls.expected = original / '_published'
        subprocess.run([sys.executable, 'scripts/assemble_site.py', str(cls.expected)],
                       cwd=original, check=True, stdout=subprocess.DEVNULL)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_stable_root_and_downloads_match_pinned_commit_byte_for_byte(self):
        self.assertEqual(files(self.expected), files(self.output, exclude_beta=True))
        self.assertFalse((self.output / '.git').exists())
        self.assertFalse((self.output / 'gradle.properties').exists())
        self.assertFalse((self.output / 'scripts').exists())

    def test_beta_uses_current_browser_assets_and_does_not_change_working_tree(self):
        current = files(beta.PAGE)
        actual = files(self.output / 'webrtc')
        actual.pop(beta.MARKER)
        self.assertEqual(current, actual)
        self.assertEqual((beta.PAGE / 'app-version.js').read_bytes(),
                         (self.output / 'webrtc/app-version.js').read_bytes())
        self.assertFalse((self.output / 'rtc-transport.js').exists())
        self.assertTrue((self.output / 'webrtc/rtc-transport.js').is_file())

    def test_output_can_be_rebuilt_without_mutating_the_sources(self):
        before = files(beta.SITE)
        beta.assemble(self.output)
        self.assertEqual(before, files(beta.SITE))
        self.assertEqual(files(self.expected), files(self.output, exclude_beta=True))

    def test_ref_must_be_a_full_existing_commit_id(self):
        destination = self.directory / 'invalid-ref'
        destination.mkdir()
        for ref in ['HEAD', 'main', '--help', 'a' * 39, 'z' * 40, 'f' * 40]:
            with self.subTest(ref=ref), self.assertRaises((ValueError, subprocess.CalledProcessError)):
                beta.extract_stable(destination, ref)
        blob = subprocess.check_output(['git', 'rev-parse', f'{beta.STABLE_REF}:gradle.properties'],
                                       cwd=beta.ROOT, text=True).strip()
        with self.assertRaisesRegex(ValueError, 'commit'):
            beta.extract_stable(destination, blob)
        self.assertEqual([], list(destination.iterdir()))

    def test_rejects_source_paths_ancestors_symlinks_and_unowned_output(self):
        sentinel_directory = self.directory / 'personal'
        sentinel_directory.mkdir()
        sentinel = sentinel_directory / 'keep.txt'
        sentinel.write_text('keep')
        symlink = self.directory / 'link'
        symlink.symlink_to(sentinel_directory, target_is_directory=True)
        for destination in [beta.ROOT, beta.ROOT.parent, beta.SITE, beta.PAGE,
                            beta.PAGE / 'nested', sentinel_directory, symlink, symlink / 'nested']:
            with self.subTest(destination=destination), self.assertRaises(ValueError):
                beta.validate_output(destination)
        self.assertEqual('keep', sentinel.read_text())
        target_file = self.directory / 'regular-file'
        target_file.write_text('keep')
        with self.assertRaises(ValueError):
            beta.validate_output(target_file)

    def test_private_environment_is_not_forwarded_to_baseline_scripts(self):
        with patch.dict(os.environ, {'BETA_TEST_SECRET': 'do-not-forward'}), \
             patch.object(beta.subprocess, 'run', wraps=subprocess.run) as run:
            beta.assemble(self.directory / 'environment-output')
        script_calls = [call for call in run.call_args_list if 'env' in call.kwargs]
        self.assertEqual(2, len(script_calls))
        for call in script_calls:
            self.assertNotIn('BETA_TEST_SECRET', call.kwargs['env'])
            self.assertNotIn('HOME', call.kwargs['env'])
            self.assertLessEqual(set(call.kwargs['env']), {'PATH', 'LANG', 'SITE_BASE_URL'})

    def test_public_inputs_reject_credentials_including_untracked_files(self):
        for name, content in [('.env', b'TOKEN=private'), ('identity.pk8', b'private'),
                              ('ordinary.txt', b'-----BEGIN PRIVATE KEY-----\n' + b'A' * 48)]:
            with tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                (directory / name).write_bytes(content)
                with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'Credential'):
                    beta.validate_public_files(directory)

    def test_stable_extraction_rejects_links_and_traversal_before_writing(self):
        for name, kind in [('site/../../escape', tarfile.REGTYPE), ('site/link', tarfile.SYMTYPE)]:
            archive = io.BytesIO()
            with tarfile.open(fileobj=archive, mode='w') as target:
                member = tarfile.TarInfo(name)
                member.type = kind
                member.linkname = '/tmp/private'
                target.addfile(member)
            with patch.object(beta.subprocess, 'check_output', side_effect=['commit\n', archive.getvalue()]):
                with self.assertRaises(ValueError):
                    beta.extract_stable(self.directory / 'unsafe-extract', beta.STABLE_REF)


if __name__ == '__main__':
    unittest.main()
