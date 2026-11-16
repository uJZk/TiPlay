#!/usr/bin/env python3
"""Admission evidence must stay debug-only, public-API and independent of media CI."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]


class MicrophoneWorkflowContract(unittest.TestCase):
    def test_manual_read_only_bounded_api36_job(self):
        source = (ROOT / '.github/workflows/android-microphone.yml').read_text()
        trigger = source.split('on:\n', 1)[1].split('permissions:', 1)[0]
        self.assertEqual(trigger.strip(), 'workflow_dispatch:')
        self.assertIn('contents: read', source)
        self.assertNotIn('contents: write', source)
        self.assertIn('system-images;android-36;google_apis;x86_64', source)
        self.assertIn('if [ ! -c /dev/kvm ]', source)
        self.assertIn('-accel on', source)
        self.assertIn('timeout-minutes: 25', source)
        self.assertIn(':mobile:assembleDebug --no-daemon', source)
        for excluded in ('assembleDebugAndroidTest', 'am instrument', 'testDebugUnitTest', 'lintDebug',
                         'rtc-audio-native.mjs', 'playwright', 'upload-release', 'continue-on-error'):
            self.assertNotIn(excluded, source)
        self.assertIn('if: always()', source)
        self.assertIn('tiplay-microphone-admission/*.json', source)

    def test_components_exist_only_in_debug_and_reuse_the_actual_helper(self):
        package = ROOT / 'common/src/debug/java/com/shilapi/xcertplay/foregroundproof'
        files = list(package.glob('*.kt'))
        self.assertEqual(len(files), 4)
        source = '\n'.join(p.read_text() for p in files)
        self.assertIn('SessionForegroundStart.start(types', source)
        self.assertIn('startForeground(30_002', source)
        self.assertIn('throw error', source)
        self.assertNotRegex(source, r'(?:new\s+)?AudioRecord\s*\(')
        self.assertNotRegex(source, r'throw\s+SecurityException\s*\(')
        for excluded in ('MediaRecorder(', 'startBluetoothSco(', 'setCommunicationDevice(',
                         'getUserMedia(', 'adoptShellPermissionIdentity', 'UiAutomation'):
            self.assertNotIn(excluded, source)
        manifest = (ROOT / 'common/src/debug/AndroidManifest.xml').read_text()
        self.assertEqual(manifest.count('android:exported="false"'), 2)
        self.assertIn('android:foregroundServiceType="connectedDevice"', manifest)
        self.assertIn('android:foregroundServiceType="connectedDevice|microphone"', manifest)
        for filename in ('common/src/main/AndroidManifest.xml', 'mobile/src/main/AndroidManifest.xml'):
            self.assertNotIn('ForegroundAdmissionProof', (ROOT / filename).read_text())

    def test_controller_never_drives_a_measured_service_from_shell(self):
        source = (ROOT / 'tests/native/android-mic-foreground-probe.mjs').read_text()
        self.assertEqual(len(re.findall(r"command\(\['shell', 'am', 'start',", source)), 1)
        self.assertNotRegex(source, r"command\(\['shell', 'am', '(?:instrument|startservice|start-foreground-service|broadcast)'")
        self.assertNotIn('adoptShellPermissionIdentity', source)
        self.assertIn("probe.startReason, 'PROC_STATE_FGS'", source)
        self.assertIn("probe[key], 'DENIED'", source)
        self.assertIn("state.recordAudioRawMode, FOREGROUND_MODE", source)
        self.assertIn("result.status = 'failed'", source)
        self.assertIn('result.forcedCleanup = forcedCleanup', source)
        self.assertIn('permissionRevocationProcessKillClaimed: false', source)


if __name__ == '__main__':
    unittest.main()
