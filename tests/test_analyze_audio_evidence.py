import base64
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('audio_evidence', ROOT / 'scripts/analyze_audio_evidence.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AudioEvidenceAnalysisTest(unittest.TestCase):
    def test_actual_browser_waveform_is_exported_without_inventing_a_cpu_or_acoustic_verdict(self):
        event = json.loads((ROOT / 'shared/src/test/resources/Browser-audio-evidence-v1.json').read_text())
        payload = json.dumps(event).encode()
        line = f'1000\t5\tbrowser/audio-evidence\t{len(payload)}\t{base64.b64encode(payload).decode()}\n'
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / 'capture.zip'
            with zipfile.ZipFile(source, 'w') as archive:
                archive.writestr('captures/traffic.tsv', line + line)
            output = Path(temp) / 'evidence'
            report = module.analyze(source, output)
            self.assertEqual(1, report['count'])
            self.assertIsNone(report['events'][0]['cpuLimited'])
            self.assertIsNone(report['events'][0]['acousticCause'])
            self.assertEqual(base64.b64decode(event['blocks'][0]['pcm']), (output / 'event-0000-block-0.f32le').read_bytes())

    def test_missing_evidence_is_not_reported_as_no_faults(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / 'old-capture.zip'
            with zipfile.ZipFile(source, 'w') as archive:
                archive.writestr('capture.txt', 'old capture')
            report = module.analyze(source, Path(temp) / 'evidence')
            self.assertEqual(0, report['count'])
            self.assertIn('does not prove clean audio', report['limitations'][0])
