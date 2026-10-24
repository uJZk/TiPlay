"""The single Pages product is current WebRTC at root with its download pages beside it."""
import hashlib
import json
from pathlib import Path
import re
import tempfile
import unittest

from scripts import assemble_site as site


class SiteDeploymentTest(unittest.TestCase):
    def test_root_is_current_product_and_isolated_webrtc_subsites_are_absent(self):
        before = {str(p.relative_to(site.SITE)): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in site.SITE.rglob('*') if p.is_file()}
        with tempfile.TemporaryDirectory(prefix='tiplay-root-site-') as temporary:
            out = Path(temporary) / 'published'
            site.assemble(out)
            for source in site.PAGE.rglob('*'):
                if source.is_file():
                    self.assertEqual(source.read_bytes(), (out / source.relative_to(site.PAGE)).read_bytes())
            self.assertIn("'./webrtc-transport.js'", (out / 'app.js').read_text())
            self.assertIn("'./rtc-pairing.js'", (out / 'app.js').read_text())
            self.assertIn("const VERSION = 'v82'", (out / 'sw.js').read_text())
            self.assertFalse((out / 'webrtc').exists())
            self.assertFalse((out / 'WebRTC').exists())
            self.assertFalse((out / 'rtc-transport.js').exists())
            for private in ['.git', 'scripts', 'tests', 'gradle.properties', '.env']:
                self.assertFalse((out / private).exists())
            properties = dict(line.split('=', 1) for line in (site.ROOT / 'gradle.properties').read_text().splitlines()
                              if line.strip() and not line.lstrip().startswith('#') and '=' in line)
            version = properties['tiplayVersionName']
            editions = json.loads((site.SITE / 'content.json').read_text())
            for language in editions:
                page = 'index.html' if language == 'en' else f'{language}/index.html'
                downloads = (out / 'download' / page).read_text()
                self.assertIn('class="button" href="https://github.com/uJZk/TiPlay/releases"', downloads, language)
                self.assertIn(f'<bdi>{version}</bdi>', downloads, language)
                self.assertNotIn('/releases/tag/', downloads, language)
            self.assertEqual((site.PAGE / 'app-version.js').read_bytes(), (out / 'app-version.js').read_bytes())
            assets = json.loads(re.search(r'const ASSETS = (\[.*?\]);', (out / 'sw.js').read_text()).group(1))
            for asset in assets:
                self.assertTrue((out / ('index.html' if asset == './' else asset)).is_file(), asset)
        after = {str(p.relative_to(site.SITE)): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in site.SITE.rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_public_inputs_reject_symlinks_credentials_and_private_blocks(self):
        for name, data in [('.env', b'TOKEN=private'), ('identity.pk8', b'private'),
                           ('ordinary.txt', b'-----BEGIN PRIVATE KEY-----\n' + b'A' * 48)]:
            with tempfile.TemporaryDirectory() as temporary:
                folder = Path(temporary)
                (folder / name).write_bytes(data)
                with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'Credential'):
                    site.validate_public_files(folder)
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            (folder / 'link').symlink_to('/etc/hosts')
            with self.assertRaisesRegex(ValueError, 'Links'):
                site.validate_public_files(folder)


if __name__ == '__main__':
    unittest.main()
