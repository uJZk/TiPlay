#!/usr/bin/env python3
"""Check the final APK against its source-rate WebRTC inputs.

This checks artifact identity and alignment, not signing or runtime behavior.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import zipfile

from verify_release_aar import ABIS, verify_elf

ROOT = Path(__file__).resolve().parents[2]
JNI = "libjingle_peerconnection_so.so"
PROVENANCE = "assets/licenses/webrtc/BUILD-PROVENANCE.json"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def data_offset(file, info):
    file.seek(info.header_offset)
    header = file.read(30)
    if len(header) != 30 or header[:4] != b"PK\x03\x04":
        raise ValueError(f"Invalid local ZIP header: {info.filename}")
    name_len, extra_len = struct.unpack_from("<HH", header, 26)
    name = file.read(name_len)
    encoding = "utf-8" if info.flag_bits & 0x800 else "cp437"
    if name.decode(encoding) != info.filename:
        raise ValueError(f"ZIP local name differs from central directory: {info.filename}")
    return info.header_offset + 30 + name_len + extra_len


def verify(apk, root=ROOT):
    aar_path = root / "shared/libs/webrtc-source-rate/webrtc-source-rate.aar"
    manifest = root / "shared/libs/webrtc-source-rate/tiplay-source-rate.provenance.json"
    asset = root / "shared/src/main/assets/licenses/webrtc/BUILD-PROVENANCE.json"
    provenance = json.loads(manifest.read_bytes())
    if json.loads(asset.read_bytes()) != provenance:
        raise ValueError("AAR and asset provenance differ")
    aar_bytes = aar_path.read_bytes()
    checksum = (aar_path.parent / "SHA256SUMS").read_text().strip()
    if checksum != f"{digest(aar_bytes)}  {aar_path.name}" or provenance.get("aar_sha256") != digest(aar_bytes):
        raise ValueError("AAR hash differs from manifest or provenance")
    if set(provenance.get("architectures", [])) != ABIS:
        raise ValueError("Provenance ABI inventory differs")
    for field, name in (("patch_sha256", "source-rate-video.patch"),
                        ("publisher_compat_sha256", "publisher-compat.patch")):
        if provenance.get(field) != digest((root / "scripts/webrtc" / name).read_bytes()):
            raise ValueError(f"Provenance does not match {name}")
    focused = provenance.get("focused_tests", {})
    if focused.get("passed") is not True or focused.get("patch_sha256") != provenance["patch_sha256"]:
        raise ValueError("Focused test provenance does not match patch")

    with zipfile.ZipFile(aar_path) as aar, zipfile.ZipFile(apk) as archive, open(apk, "rb") as raw:
        aar_names = aar.namelist()
        apk_names = archive.namelist()
        expected_aar = {f"jni/{abi}/{JNI}" for abi in ABIS}
        expected_apk = {f"lib/{abi}/{JNI}" for abi in ABIS}
        aar_jni = [name for name in aar_names if name.endswith("/" + JNI)]
        apk_jni = [name for name in apk_names if name.endswith("/" + JNI)]
        if set(aar_jni) != expected_aar or len(aar_jni) != len(expected_aar):
            raise ValueError("AAR must contain one WebRTC JNI library per ABI")
        if set(apk_jni) != expected_apk or len(apk_jni) != len(expected_apk):
            raise ValueError("APK must contain one WebRTC JNI library per ABI")
        if apk_names.count(PROVENANCE) != 1 or archive.read(PROVENANCE) != asset.read_bytes():
            raise ValueError("APK build provenance differs from source asset")
        for abi in ABIS:
            name = f"lib/{abi}/{JNI}"
            data = archive.read(name)
            if data != aar.read(f"jni/{abi}/{JNI}"):
                raise ValueError(f"APK WebRTC library differs from AAR: {abi}")
            verify_elf(data, name)
        for info in archive.infolist():
            if info.filename.startswith("lib/") and info.filename.endswith(".so") and info.compress_type == zipfile.ZIP_STORED:
                if data_offset(raw, info) % 16384:
                    raise ValueError(f"Uncompressed native library is not 16 KiB aligned: {info.filename}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    args = parser.parse_args()
    try:
        verify(args.apk)
    except (OSError, ValueError, KeyError, UnicodeError, struct.error, zipfile.BadZipFile) as exc:
        parser.exit(1, f"APK verification failed: {exc}\n")
    print("APK WebRTC identity, provenance, four ABIs, ELF and ZIP alignment verified")


if __name__ == "__main__":
    main()
