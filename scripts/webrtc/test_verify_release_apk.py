import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest
import warnings
import zipfile

from verify_release_apk import ABIS, JNI, PROVENANCE, verify


def elf(bits):
    data = bytearray(256)
    data[:6] = b"\x7fELF" + bytes((bits, 1))
    if bits == 2:
        struct.pack_into("<Q", data, 32, 64)
        struct.pack_into("<HH", data, 54, 56, 1)
        struct.pack_into("<I", data, 64, 1)
        struct.pack_into("<Q", data, 64 + 48, 16384)
    else:
        struct.pack_into("<I", data, 28, 52)
        struct.pack_into("<HH", data, 42, 32, 1)
        struct.pack_into("<I", data, 52, 1)
        struct.pack_into("<I", data, 52 + 28, 4096)
    return bytes(data)


def write_zip(path, entries, aligned=True, unaligned_name=None):
    with warnings.catch_warnings(), zipfile.ZipFile(path, "w") as z:
        warnings.simplefilter("ignore", UserWarning)
        for name, data in entries:
            info = zipfile.ZipInfo(name)
            if aligned and name != unaligned_name and name.startswith("lib/") and name.endswith(".so"):
                padding = (-(z.fp.tell() + 30 + len(name.encode()) + 4)) % 16384
                info.extra = struct.pack("<HH", 0xCAFE, padding) + bytes(padding)
            z.writestr(info, data)


class VerifyReleaseApkTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.folder = self.root / "shared/libs/webrtc-source-rate"
        self.asset = self.root / "shared/src/main/assets/licenses/webrtc/BUILD-PROVENANCE.json"
        self.patches = self.root / "scripts/webrtc"
        for path in (self.folder, self.asset.parent, self.patches):
            path.mkdir(parents=True)
        self.source_patch = b"source patch"
        self.compat_patch = b"compat patch"
        (self.patches / "source-rate-video.patch").write_bytes(self.source_patch)
        (self.patches / "publisher-compat.patch").write_bytes(self.compat_patch)
        self.aar = self.folder / "webrtc-source-rate.aar"
        self.libraries = {abi: elf(2 if abi in ("arm64-v8a", "x86_64") else 1) for abi in ABIS}
        write_zip(self.aar, [(f"jni/{abi}/{JNI}", data) for abi, data in self.libraries.items()])
        sha = lambda data: hashlib.sha256(data).hexdigest()
        aar_hash, patch_hash = sha(self.aar.read_bytes()), sha(self.source_patch)
        (self.folder / "SHA256SUMS").write_text(f"{aar_hash}  {self.aar.name}\n")
        self.provenance = json.dumps({"aar_sha256": aar_hash, "architectures": sorted(ABIS),
                                      "patch_sha256": patch_hash, "publisher_compat_sha256": sha(self.compat_patch),
                                      "focused_tests": {"passed": True, "patch_sha256": patch_hash}}).encode()
        (self.folder / "tiplay-source-rate.provenance.json").write_bytes(self.provenance)
        self.asset.write_bytes(self.provenance)
        self.apk = self.root / "release.apk"
        self.entries = [(f"lib/{abi}/{JNI}", data) for abi, data in self.libraries.items()] + [(PROVENANCE, self.provenance)]

    def check(self, entries=None, aligned=True):
        write_zip(self.apk, self.entries if entries is None else entries, aligned)
        verify(self.apk, self.root)

    def test_accepts_matching_aligned_apk(self):
        self.check()

    def test_rejects_missing_and_duplicate_jni(self):
        for entries in (self.entries[1:], self.entries + [self.entries[0]]):
            with self.subTest(count=len(entries)), self.assertRaisesRegex(ValueError, "one WebRTC"):
                self.check(entries)

    def test_rejects_wrong_jni_content(self):
        entries = list(self.entries)
        entries[0] = (entries[0][0], entries[0][1] + b"changed")
        with self.assertRaisesRegex(ValueError, "differs from AAR"):
            self.check(entries)

    def test_rejects_unaligned_any_native_library(self):
        with self.assertRaisesRegex(ValueError, "not 16 KiB aligned"):
            self.check(aligned=False)
        extra = "lib/arm64-v8a/libother.so"
        write_zip(self.apk, self.entries + [(extra, b"other")], unaligned_name=extra)
        with self.assertRaisesRegex(ValueError, "libother.so"):
            verify(self.apk, self.root)

    def test_rejects_weak_elf_alignment(self):
        bad = bytearray(self.libraries["arm64-v8a"])
        struct.pack_into("<Q", bad, 64 + 48, 4096)
        self.libraries["arm64-v8a"] = bytes(bad)
        # Verify ELF validation separately; matching-content validation runs first.
        from verify_release_aar import verify_elf
        with self.assertRaisesRegex(ValueError, "alignment"):
            verify_elf(bytes(bad), "arm64")

    def test_rejects_old_source_patch_and_compat_patch(self):
        for name in ("source-rate-video.patch", "publisher-compat.patch"):
            path = self.patches / name
            old = path.read_bytes()
            path.write_bytes(b"updated")
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "Provenance does not match"):
                self.check()
            path.write_bytes(old)

    def test_rejects_apk_provenance_mismatch(self):
        entries = self.entries[:-1] + [(PROVENANCE, b"{}")]
        with self.assertRaisesRegex(ValueError, "APK build provenance"):
            self.check(entries)

    def test_rejects_aar_provenance_mismatch(self):
        self.asset.write_text("{}")
        with self.assertRaisesRegex(ValueError, "AAR and asset provenance"):
            self.check()


if __name__ == "__main__":
    unittest.main()
