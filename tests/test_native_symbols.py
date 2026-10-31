"""Real ELF pairing, narrow archives and immutable draft-only persistence."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import native_symbols as symbols
import archive_native_symbols as durable
import collect_apk_native_symbols as apk_symbols

SHA = 'a' * 40
TRUSTED = {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REF': 'refs/heads/main',
           'GITHUB_REPOSITORY': durable.TRUSTED_REPOSITORY, 'GITHUB_SHA': SHA}


@unittest.skipUnless(all(shutil.which(tool) for tool in ('cc', 'strip', 'readelf', 'objcopy')), 'Host ELF tools required')
class NativeSymbolsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='native-symbols-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'probe.c'
        self.source.write_text('int native_symbol_probe(int value) { return value + 1; }\n')
        self.full, self.stripped = self.library('probe')
        self.directory = self.root / 'symbols'
        self.producer = {'component': 'webrtc', 'source_revision': 'b' * 40, 'build_commit': SHA}

    def library(self, name, source=None, debug=True):
        full, stripped = self.root / (name + '.so'), self.root / (name + '-stripped.so')
        subprocess.run(['cc', '-shared', '-fPIC', '-O3', *(['-g'] if debug else []),
                        '-Wl,--build-id=sha1', str(source or self.source), '-o', str(full)],
                       check=True, capture_output=True)
        subprocess.run(['strip', '--strip-unneeded', '-o', str(stripped), str(full)], check=True)
        return full, stripped

    def record(self, directory=None, full=None, stripped=None, library='libprobe.so'):
        return symbols.record(directory or self.directory, 'x86_64', library,
                              full or self.full, stripped or self.stripped, self.producer)

    def test_real_unstripped_elf_matches_stripped_build_id_and_archive_round_trip(self):
        entry = self.record()
        self.assertEqual(symbols.inspect_elf(self.stripped, 'x86_64')['build_id'], entry['build_id'])
        self.assertNotEqual(symbols.sha(self.full), entry['packaged_sha256'])
        symbols.verify(self.directory)
        first = symbols.archive(self.directory, self.root / 'first.zip')
        second = symbols.archive(self.directory, self.root / 'second.zip')
        self.assertEqual(first.read_bytes(), second.read_bytes())
        with zipfile.ZipFile(first) as archive:
            self.assertEqual(set(archive.namelist()), {'index.json', entry['symbol_file']})
            self.assertEqual(archive.read(entry['symbol_file']), self.full.read_bytes())

    def test_wrong_build_id_or_stripped_input_or_architecture_is_rejected(self):
        other_source = self.root / 'other.c'
        other_source.write_text('int native_symbol_probe(int value) { return value + 2; }\n')
        _, other = self.library('other', other_source)
        with self.assertRaisesRegex(ValueError, 'different Build IDs'):
            self.record(stripped=other)
        with self.assertRaisesRegex(ValueError, 'DWARF line'):
            self.record(full=self.stripped)
        with self.assertRaisesRegex(ValueError, 'architecture'):
            symbols.record(self.directory, 'arm64-v8a', 'libprobe.so', self.full, self.stripped, self.producer)

    def test_missing_line_info_is_not_claimed_as_full_symbols(self):
        full, stripped = self.library('no-debug', debug=False)
        with self.assertRaisesRegex(ValueError, 'DWARF line'):
            self.record(full=full, stripped=stripped)

    def test_symbols_directory_rejects_unindexed_keys_apks_and_symlinks(self):
        self.record()
        for name in ('identity.pk8', 'release.apk', 'unexpected.txt'):
            path = self.directory / name
            path.write_bytes(b'unexpected private input')
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'only indexed ELF'):
                symbols.archive(self.directory, self.root / 'bad.zip')
            path.unlink()
        link = self.directory / 'linked.so'
        link.symlink_to(self.full)
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            symbols.verify(self.directory)

    def test_index_is_immutable_and_tampering_cannot_create_a_new_archive(self):
        self.record()
        before = (self.directory / 'index.json').read_bytes()
        self.record()
        self.assertEqual(before, (self.directory / 'index.json').read_bytes())
        with self.assertRaisesRegex(ValueError, 'producer inputs'):
            symbols.record(self.directory, 'x86_64', 'libprobe.so', self.full, self.stripped,
                           {**self.producer, 'source_revision': 'c' * 40})
        index = json.loads(before)
        index['entries'][0]['symbol_file'] = '../identity.pk8'
        symbols.write_index(self.directory, index)
        with self.assertRaisesRegex(ValueError, 'path'):
            symbols.verify(self.directory)

    def test_trusted_main_draft_archive_is_idempotent_and_never_public(self):
        self.record()
        commands, releases = [], []
        def fake_gh(*args):
            commands.append(args)
            self.assertEqual(args[0], 'api')
            if args[1:3] == ('--method', 'POST'):
                path = Path(args[args.index('--input') + 1])
                if args[3] == 'repos/' + durable.TRUSTED_REPOSITORY + '/releases':
                    payload = json.loads(path.read_text())
                    self.assertEqual(set(payload), {'draft', 'prerelease', 'tag_name', 'target_commitish', 'name', 'body'})
                    self.assertIs(payload['draft'], True)
                    self.assertIs(payload['prerelease'], True)
                    releases.append({'id': 71, 'draft': True, 'prerelease': True,
                        'tag_name': payload['tag_name'], 'target_commitish': payload['target_commitish'],
                        'assets': [], 'html_url': 'draft-url'})
                    return json.dumps(releases[0])
                prefix = f'https://uploads.github.com/repos/{durable.TRUSTED_REPOSITORY}/releases/71/assets?name='
                self.assertTrue(args[3].startswith(prefix))
                name = args[3].removeprefix(prefix)
                self.assertIn(name, durable.ASSET_NAMES)
                self.assertEqual(name, path.name)
                asset = {'id': len(releases[0]['assets']) + 1, 'name': name,
                         'size': path.stat().st_size, 'digest': 'sha256:' + symbols.sha(path)}
                releases[0]['assets'].append(asset)
                return json.dumps(asset)
            self.assertTrue(args[1].startswith(f'repos/{durable.TRUSTED_REPOSITORY}/releases/71?nonce='))
            self.assertIn('Cache-Control: no-cache', args)
            return json.dumps(releases[0])
        # Even if the list remains stale forever after creation, its returned ID is authoritative.
        with mock.patch.object(durable, 'find_release', return_value=None) as find, \
                mock.patch.object(durable, 'gh', side_effect=fake_gh):
            durable.persist(self.directory, TRUSTED)
            find.assert_called_once()
        writes = sum(call[1:3] == ('--method', 'POST') for call in commands)
        with mock.patch.object(durable, 'find_release', return_value=releases[0]), \
                mock.patch.object(durable, 'gh', side_effect=fake_gh):
            durable.persist(self.directory, TRUSTED)
        self.assertEqual(writes, sum(call[1:3] == ('--method', 'POST') for call in commands))
        self.assertEqual({asset['name'] for asset in releases[0]['assets']},
                         {'native-symbols.zip', 'native-symbols-index.json'})
        self.assertTrue(all('--clobber' not in call and 'edit' not in call and '--draft=false' not in call for call in commands))
        self.assertNotIn(releases[0], [release for release in releases if not release['draft']])

    def test_non_main_fork_and_published_or_different_assets_are_refused(self):
        self.record()
        for overrides in ({'GITHUB_REF': 'refs/heads/test'}, {'GITHUB_EVENT_NAME': 'pull_request'},
                          {'GITHUB_REPOSITORY': 'fork/TiPlay'}):
            with self.subTest(overrides=overrides), mock.patch.object(durable, 'gh') as gh, \
                    self.assertRaisesRegex(ValueError, 'trusted main'):
                durable.persist(self.directory, {**TRUSTED, **overrides})
            gh.assert_not_called()
        release = {'id': 71, 'draft': False, 'tag_name': symbols.archive_tag(self.directory),
                   'prerelease': True, 'target_commitish': SHA, 'assets': []}
        with mock.patch.object(durable, 'find_release', return_value=release), \
                mock.patch.object(durable, 'gh') as gh, self.assertRaisesRegex(ValueError, 'remain draft'):
            durable.persist(self.directory, TRUSTED)
        gh.assert_not_called()
        release['draft'] = True
        release['assets'] = [{'name': 'native-symbols.zip', 'size': 1, 'digest': 'sha256:' + '0' * 64}]
        with mock.patch.object(durable, 'find_release', return_value=release), \
                mock.patch.object(durable, 'gh') as gh, self.assertRaisesRegex(ValueError, 'overwrite'):
            durable.persist(self.directory, TRUSTED)
        gh.assert_not_called()

    def test_upload_confirmation_retries_only_missing_or_incomplete_visibility(self):
        self.record()
        release = {'id': 71, 'draft': True, 'prerelease': True, 'target_commitish': SHA,
                   'tag_name': symbols.archive_tag(self.directory), 'assets': [], 'html_url': 'draft-url'}
        uploaded, reads = [], []
        def fake_gh(*args):
            if args[1:3] == ('--method', 'POST'):
                path = Path(args[args.index('--input') + 1])
                self.assertEqual(args[3], f'https://uploads.github.com/repos/{durable.TRUSTED_REPOSITORY}/releases/71/assets?name={path.name}')
                asset = {'id': len(uploaded) + 1, 'name': path.name,
                         'size': path.stat().st_size, 'digest': 'sha256:' + symbols.sha(path)}
                uploaded.append(asset)
                return json.dumps(asset)
            reads.append(args[1])
            if len(reads) == 1:
                raise subprocess.CalledProcessError(1, ['gh'], stderr='gh: Not Found (HTTP 404)')
            return json.dumps({**release, 'assets': uploaded[:1] if len(reads) == 2 else uploaded})
        with mock.patch.object(durable, 'find_release', return_value=release), \
                mock.patch.object(durable, 'gh', side_effect=fake_gh), \
                mock.patch.object(durable.time, 'sleep') as pause:
            result = durable.persist(self.directory, TRUSTED)
        self.assertEqual(len(result['assets']), 2)
        self.assertEqual(len(reads), 3)
        self.assertEqual(len(set(reads)), 3)
        self.assertEqual(pause.call_count, 2)

    def test_confirmation_mismatches_fail_immediately_and_missing_reads_are_bounded(self):
        self.record()
        release = {'id': 71, 'draft': True, 'prerelease': True, 'target_commitish': SHA,
                   'tag_name': symbols.archive_tag(self.directory), 'assets': [], 'html_url': 'draft-url'}
        mismatch = {'name': 'native-symbols.zip', 'size': 1, 'digest': 'sha256:' + '0' * 64}
        for changed in ({'draft': False}, {'target_commitish': 'f' * 40}, {'assets': [mismatch]},
                        {'assets': [{'name': 'identity.pk8'}]}):
            with self.subTest(changed=changed), mock.patch.object(durable, 'find_release', return_value=release), \
                    mock.patch.object(durable, 'upload_asset'), \
                    mock.patch.object(durable, 'read_release', return_value={**release, **changed}) as read, \
                    mock.patch.object(durable.time, 'sleep') as pause, self.assertRaises(ValueError):
                durable.persist(self.directory, TRUSTED)
            read.assert_called_once_with(71)
            pause.assert_not_called()
        for missing in (None, release):
            with self.subTest(missing=missing is None), mock.patch.object(durable, 'find_release', return_value=release), \
                    mock.patch.object(durable, 'upload_asset'), \
                    mock.patch.object(durable, 'read_release', return_value=missing) as read, \
                    mock.patch.object(durable.time, 'sleep') as pause, \
                    self.assertRaisesRegex(ValueError, 'bounded reads'):
                durable.persist(self.directory, TRUSTED)
            self.assertEqual(read.call_count, durable.READ_ATTEMPTS)
            self.assertEqual(pause.call_count, durable.READ_ATTEMPTS - 1)

    def test_direct_id_upload_rejects_response_mismatch_and_nonpositive_targets(self):
        good = {'id': 19, 'name': 'native-symbols.zip', 'size': self.full.stat().st_size,
                'digest': 'sha256:' + symbols.sha(self.full)}
        for changed in ({'id': 0}, {'name': 'identity.pk8'}, {'size': 1}, {'digest': 'sha256:' + '0' * 64}):
            with self.subTest(changed=changed), mock.patch.object(durable, 'gh', return_value=json.dumps({**good, **changed})) as gh, \
                    self.assertRaisesRegex(ValueError, 'asset identity or digest'):
                durable.upload_asset(71, 'native-symbols.zip', self.full)
            self.assertEqual(gh.call_args.args[3], f'https://uploads.github.com/repos/{durable.TRUSTED_REPOSITORY}/releases/71/assets?name=native-symbols.zip')
        for identifier in (0, -1, True, '71'):
            with self.subTest(identifier=identifier), mock.patch.object(durable, 'gh') as gh, self.assertRaises(ValueError):
                durable.upload_asset(identifier, 'native-symbols.zip', self.full)
            gh.assert_not_called()
        with mock.patch.object(durable, 'gh', side_effect=subprocess.CalledProcessError(1, ['gh'], stderr='gh: Forbidden (HTTP 403)')), \
                self.assertRaises(subprocess.CalledProcessError):
            durable.read_release(71)

    def test_agp_ndk_layout_is_matched_to_apk_and_old_prebuilt_symbols_remain_missing(self):
        ndk = self.root / 'cxx'
        entries = []
        for library in apk_symbols.JNI_LIBRARIES:
            target = ndk / 'Release/fixture/obj/local/x86_64' / library
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.full, target)
            entries.append((f'lib/x86_64/{library}', self.stripped.read_bytes()))
        entries.append(('lib/x86_64/liboldvendor.so', self.stripped.read_bytes()))
        apk = self.root / 'test.apk'
        with zipfile.ZipFile(apk, 'w') as archive:
            for name, data in entries:
                archive.writestr(name, data)
        directory = self.root / 'apk-symbols'
        historical = {('x86_64', 'liboldvendor.so'):
                      (symbols.sha(self.stripped), self.stripped.stat().st_size)}
        index = apk_symbols.collect(apk, ndk, directory, abis=('x86_64',), historical=historical)
        self.assertEqual(len(index['entries']), len(apk_symbols.JNI_LIBRARIES))
        self.assertEqual(index['prebuilt_libraries'][0]['status'], 'historical-missing')
        self.assertNotIn('producer_archive', index['prebuilt_libraries'][0])
        symbols.verify(directory)
        with self.assertRaisesRegex(ValueError, 'New or changed prebuilt'):
            apk_symbols.collect(apk, ndk, self.root / 'unreviewed', abis=('x86_64',))
        with self.assertRaisesRegex(ValueError, 'New or changed prebuilt'):
            apk_symbols.collect(apk, ndk, self.root / 'changed', abis=('x86_64',), historical={
                ('x86_64', 'liboldvendor.so'): ('0' * 64, self.stripped.stat().st_size)})
        first = ndk / 'Release/fixture/obj/local/x86_64' / apk_symbols.JNI_LIBRARIES[0]
        first.unlink()
        with self.assertRaisesRegex(ValueError, 'no matching JNI'):
            apk_symbols.collect(apk, ndk, self.root / 'missing', abis=('x86_64',))

    def test_agp_full_metadata_fallback_requires_matching_debug_elf(self):
        apk = self.root / 'test.apk'
        metadata = self.root / 'native-debug-symbols.zip'
        debug_only = self.root / 'probe.so.dbg'
        subprocess.run(['objcopy', '--only-keep-debug', str(self.full), str(debug_only)], check=True)
        with zipfile.ZipFile(apk, 'w') as package, zipfile.ZipFile(metadata, 'w') as full:
            for library in apk_symbols.JNI_LIBRARIES:
                package.writestr(f'lib/x86_64/{library}', self.stripped.read_bytes())
                full.writestr(f'x86_64/{library}.dbg', debug_only.read_bytes())
        result = apk_symbols.collect(apk, self.root / 'empty-cxx', self.root / 'from-full',
                                     metadata, abis=('x86_64',))
        self.assertEqual(len(result['entries']), len(apk_symbols.JNI_LIBRARIES))

    def test_new_prebuilt_references_must_already_exist_and_match_the_apk(self):
        self.record()
        source_index = (self.directory / 'index.json').read_bytes()
        source_digest = symbols.sha(self.directory / 'index.json')
        source = json.loads(source_index)['entries'][0]
        tag = symbols.archive_tag(self.directory)
        prebuilt = {key: source[key] for key in ('abi', 'library', 'build_id', 'packaged_sha256', 'packaged_bytes')}
        prebuilt.update(status='producer-archive', producer_archive={
            'archive_tag': tag, 'index_sha256': source_digest, 'archive_visibility': 'authenticated-draft-only'})
        container = {'prebuilt_libraries': [prebuilt]}
        with mock.patch.object(durable, 'find_release', return_value=None), \
                self.assertRaisesRegex(ValueError, 'unavailable'):
            durable.validate_producer_archives(container)
        release = {'draft': True, 'prerelease': True, 'assets': [
            {'name': 'native-symbols.zip', 'size': 100, 'digest': 'sha256:' + '1' * 64},
            {'name': 'native-symbols-index.json', 'id': 20, 'size': len(source_index), 'digest': 'sha256:' + source_digest}]}
        with mock.patch.object(durable, 'find_release', return_value=release), \
                mock.patch.object(durable, 'gh', return_value=source_index.decode()):
            durable.validate_producer_archives(container)
            prebuilt['packaged_sha256'] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'does not match'):
                durable.validate_producer_archives(container)
        with mock.patch.object(durable, 'find_release') as query:
            durable.validate_producer_archives({'prebuilt_libraries': [{
                'status': 'historical-missing'}]})
        query.assert_not_called()

    def test_compiled_jni_inventory_matches_the_current_ndk_build_definition(self):
        android_mk = (SCRIPTS.parent / 'shared/src/main/jni/Android.mk').read_text()
        modules = []
        for block in android_mk.split('include $(CLEAR_VARS)')[1:]:
            if 'include $(BUILD_SHARED_LIBRARY)' in block:
                modules.append('lib' + re.search(r'^LOCAL_MODULE := (\w+)$', block, re.M).group(1) + '.so')
        self.assertEqual(set(modules), set(apk_symbols.JNI_LIBRARIES))


class ProducerWorkflowTest(unittest.TestCase):
    def test_historical_migration_is_explicit_and_cannot_exempt_owned_jni(self):
        exceptions = apk_symbols.historical_exceptions()
        self.assertEqual(len(exceptions), 27)
        self.assertTrue(all(library not in apk_symbols.JNI_LIBRARIES for _, library in exceptions))
        self.assertEqual(set(abi for abi, _ in exceptions), set(symbols.ELF_ABIS))

    def test_final_apk_gate_precedes_artifact_preparation_and_draft_requires_symbols(self):
        text = (SCRIPTS.parent / '.github/workflows/android-release.yml').read_text()
        gate = text.index('python3 scripts/webrtc/verify_release_apk.py mobile/build/outputs/apk/release/mobile-release.apk')
        self.assertLess(gate, text.index('output = Path(\'release-artifacts\')'))
        self.assertIn('needs: [release, symbols]', text)
        self.assertIn('python3 scripts/collect_apk_native_symbols.py', text)
        for name in ('android-release.yml', 'native-source-rate.yml', 'native-rtc-audio.yml'):
            workflow = (SCRIPTS.parent / '.github/workflows' / name).read_text()
            self.assertIn('github.ref == \'refs/heads/main\'', workflow)
            self.assertIn('github.repository == \'uJZk/TiPlay\'', workflow)
            self.assertIn('retention-days: 90', workflow)
            self.assertIn('python3 scripts/archive_native_symbols.py', workflow)


if __name__ == '__main__':
    unittest.main()
