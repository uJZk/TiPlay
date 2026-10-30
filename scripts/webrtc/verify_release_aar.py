#!/usr/bin/env python3
"""Verify the pinned source-rate WebRTC AAR and Android page alignment."""
import hashlib
import json
import struct
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AAR = ROOT / "shared/libs/webrtc-source-rate/webrtc-source-rate.aar"
ABIS = {"armeabi-v7a", "arm64-v8a", "x86", "x86_64"}


def verify_elf(data, name):
    if data[:4] != b"\x7fELF" or data[5] != 1 or data[4] not in (1, 2):
        raise ValueError(f"Unsupported ELF for {name}")
    if data[4] == 2:
        phoff = struct.unpack_from("<Q", data, 32)[0]
        phentsize, phnum = struct.unpack_from("<HH", data, 54)
        minimum, off, addr, align = 56, 8, 16, 48
        fmt = "<Q"
    else:
        phoff = struct.unpack_from("<I", data, 28)[0]
        phentsize, phnum = struct.unpack_from("<HH", data, 42)
        minimum, off, addr, align = 32, 4, 8, 28
        fmt = "<I"
    if phentsize < minimum or phnum == 0 or phoff + phentsize * phnum > len(data):
        raise ValueError(f"Invalid program headers for {name}")
    loads = 0
    for i in range(phnum):
        base = phoff + i * phentsize
        if struct.unpack_from("<I", data, base)[0] != 1:
            continue
        loads += 1
        offset = struct.unpack_from(fmt, data, base + off)[0]
        address = struct.unpack_from(fmt, data, base + addr)[0]
        alignment = struct.unpack_from(fmt, data, base + align)[0]
        required = 16384 if data[4] == 2 else 4096
        if alignment < required or alignment & (alignment - 1) or offset % alignment != address % alignment:
            raise ValueError(f"LOAD segment alignment is invalid for {name}")
    if not loads:
        raise ValueError(f"No LOAD segments for {name}")


def main():
    checksum = (AAR.parent / "SHA256SUMS").read_text().strip().split("  ")
    if len(checksum) != 2 or checksum[1] != AAR.name or len(checksum[0]) != 64 or any(c not in "0123456789abcdef" for c in checksum[0]):
        raise ValueError("Invalid AAR checksum manifest")
    digest = hashlib.sha256(AAR.read_bytes()).hexdigest()
    if digest != checksum[0]:
        raise ValueError("Unexpected AAR SHA-256")
    with zipfile.ZipFile(AAR) as archive:
        names = archive.namelist()
        if names.count("classes.jar") != 1:
            raise ValueError("Expected exactly one classes.jar")
        paths = [p for p in names if p.endswith("/libjingle_peerconnection_so.so")]
        expected = {f"jni/{abi}/libjingle_peerconnection_so.so" for abi in ABIS}
        if set(paths) != expected or len(paths) != len(expected):
            raise ValueError("Expected exactly one native library for each supported ABI")
        for path in sorted(paths):
            verify_elf(archive.read(path), path)
    provenance = json.loads((AAR.parent / "tiplay-source-rate.provenance.json").read_text())
    if provenance.get("aar_sha256") != digest or set(provenance.get("architectures", [])) != ABIS:
        raise ValueError("Provenance does not match AAR hash and ABIs")
    print("Source-rate AAR SHA, four ABIs, classes.jar and 64-bit 16 KiB ELF alignment verified")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, struct.error, zipfile.BadZipFile) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
