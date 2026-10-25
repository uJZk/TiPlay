import base64
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("capture", Path(__file__).resolve().parents[1] / "scripts/prepare_carplay_capture.py")
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class CaptureTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def fixture(self, offset=0, partial=False, size=None, bad_path=False, regression=False):
        data = struct.pack(">IBBBBIIIdhh", 28, 2, 0, 2, 0, 48000, 7, 3, 999999.25, 100, -100)
        name = "streams/session-a/1-audio.bin" if not bad_path else "../audio.bin"
        channel = base64.b64encode(b"browser/audio/rtc/3/records").decode()
        path = self.root / "input.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("capture.txt", "format=raw-streams-v1\ncoverage=" + ("partial" if partial else "no-observed-write-failure"))
            archive.writestr("streams.tsv", f"stream\tchannelBase64\tbytes\n{name}\t{channel}\t{len(data)*2 if size is None else size}\n")
            archive.writestr("sessions.tsv", "session\tstartEpochMillis\tconfigurationBase64\nsession-a\t1000\t\n")
            archive.writestr("events.tsv", f"epochMillis\tsequence\tstream\toffset\tlength\n1000\t1\t{name}\t{offset}\t32\n{990 if regression else 1020}\t2\t{name}\t32\t32\n")
            archive.writestr(name, data * 2)
        return path, data

    def test_preserves_bytes_and_capture_order(self):
        path, data = self.fixture(regression=True)
        result = capture.prepare(path, self.root / "out")
        self.assertEqual((self.root / "out/audio-0.bin").read_bytes(), data * 2)
        self.assertEqual([e["atMs"] for e in result["audio"][0]["events"]], [10, 0])
        self.assertEqual(result["audio"][0]["events"][0]["audio"]["presentationMs"], 999999.25)
        self.assertTrue(any("backwards" in w for w in result["warnings"]))
        self.assertEqual(json.loads((self.root / "out/manifest.json").read_text())["format"], "tiplay-capture-replay-v1")

    def test_rejects_invalid_ranges_without_output(self):
        path, _ = self.fixture(offset=1)
        with self.assertRaisesRegex(ValueError, "bounds"):
            capture.prepare(path, self.root / "out")
        self.assertFalse((self.root / "out").exists())

    def test_rejects_size_mismatch(self):
        path, _ = self.fixture(size=1)
        with self.assertRaisesRegex(ValueError, "size"):
            capture.prepare(path, self.root / "out")

    def test_nonfinite_control_timestamps_match_production_protocol(self):
        data = struct.pack(">IBBBBIIId", 24, 2, 5, 1, 0, 48000, 7, 3, float('nan'))
        header = capture.audio_header(data)
        self.assertIsNone(header['presentationMs'])
        self.assertFalse(header['presentationFinite'])
        self.assertEqual(header['type'], 5)

    def test_rejects_unsafe_paths(self):
        path, _ = self.fixture(bad_path=True)
        with self.assertRaisesRegex(ValueError, "path"):
            capture.prepare(path, self.root / "out")

    def test_partial_capture_remains_explicit(self):
        path, _ = self.fixture(partial=True)
        result = capture.prepare(path, self.root / "out")
        self.assertTrue(any("partial coverage" in w for w in result["warnings"]))

    def test_unknown_session_does_not_silently_mix_sessions(self):
        path, _ = self.fixture()
        with self.assertRaisesRegex(ValueError, "session"):
            capture.prepare(path, self.root / "out", "missing")

    def test_later_audio_epoch_retains_shared_capture_origin(self):
        path, data = self.fixture()
        with zipfile.ZipFile(path) as archive:
            entries = {name: archive.read(name) for name in archive.namelist()}
        name = "streams/session-a/2-audio.bin"
        channel = base64.b64encode(b"browser/audio/rtc/4/records").decode()
        entries["streams.tsv"] += f"{name}\t{channel}\t32\n".encode()
        entries["events.tsv"] += f"1040\t3\t{name}\t0\t32\n".encode()
        entries[name] = data
        with zipfile.ZipFile(path, "w") as archive:
            for key, value in entries.items():
                archive.writestr(key, value)
        result = capture.prepare(path, self.root / "out")
        self.assertEqual([s["originEpochMillis"] for s in result["audio"]], [1000, 1000])
        self.assertEqual(result["audio"][1]["events"][0]["atMs"], 40)

    def test_corrupt_audio_cannot_leave_a_partial_fixture(self):
        path, _ = self.fixture()
        with zipfile.ZipFile(path) as archive:
            entries = {name: archive.read(name) for name in archive.namelist()}
        entries["streams/session-a/1-audio.bin"] = bytes(64)
        with zipfile.ZipFile(path, "w") as archive:
            for name, data in entries.items():
                archive.writestr(name, data)
        with self.assertRaisesRegex(ValueError, "audio length"):
            capture.prepare(path, self.root / "out")
        self.assertFalse((self.root / "out").exists())
        self.assertEqual(list(self.root.glob(".capture-*")), [])


if __name__ == "__main__":
    unittest.main()
