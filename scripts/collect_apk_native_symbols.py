#!/usr/bin/env python3
"""Collect this APK build's JNI symbols; describe unavailable prebuilt symbols honestly."""
import argparse
import json
from pathlib import Path
import re
import tempfile
import zipfile

import native_symbols as symbols

JNI_LIBRARIES = ('libxcertplay_i2c.so', 'libtiplay_soxr.so', 'libtiplay_airplay.so',
                 'liblocal_hotspot_radio.so', 'libspeex_echo.so', 'libtiplay_rtc_audio.so')
HISTORICAL = Path(__file__).with_name('native_symbols_historical.json')


def historical_exceptions(path=HISTORICAL):
    """Only explicitly reviewed, byte-identical migration artifacts may lack symbols."""
    index = json.loads(Path(path).read_text())
    if index.get('format') != 'tiplay-historical-native-symbol-exceptions-v1':
        raise ValueError('Invalid historical native symbols exceptions')
    allowed = {}
    for entry in index['entries']:
        if (set(entry) != {'abi', 'library', 'packaged_sha256', 'packaged_bytes'}
                or entry['abi'] not in symbols.ELF_ABIS
                or not re.fullmatch(r'lib[A-Za-z0-9_.+-]+\.so', entry['library'])
                or entry['library'] in JNI_LIBRARIES
                or not re.fullmatch(r'[0-9a-f]{64}', entry['packaged_sha256'])
                or type(entry['packaged_bytes']) is not int or entry['packaged_bytes'] < 1):
            raise ValueError('Invalid historical native symbols exception entry')
        identity = (entry['abi'], entry['library'])
        if identity in allowed:
            raise ValueError('Duplicate historical native symbols exception')
        allowed[identity] = (entry['packaged_sha256'], entry['packaged_bytes'])
    return allowed


def archive_reference(value, component):
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError('Invalid prebuilt symbols archive reference')
    digest = value.get('index_sha256', '')
    if (not re.fullmatch(r'[0-9a-f]{64}', digest)
            or value.get('archive_tag') != f'native-symbols-{component}-{digest}'
            or value.get('archive_visibility') != 'authenticated-draft-only'):
        raise ValueError('Invalid prebuilt symbols archive reference')
    return {key: value[key] for key in ('index_sha256', 'archive_tag', 'archive_visibility')}


def collect(apk, ndk_outputs, output, full_symbols=None, abis=tuple(symbols.ABIS), readelf='readelf',
            historical=None):
    apk, ndk_outputs, output = map(Path, (apk, ndk_outputs, output))
    producer = symbols.producer_context('android-jni', apk_sha256=symbols.sha(apk))
    historical = historical_exceptions() if historical is None else historical
    prebuilt = []
    with zipfile.ZipFile(apk) as package, tempfile.TemporaryDirectory(prefix='tiplay-apk-symbols-') as temporary:
        temporary = Path(temporary)
        metadata = zipfile.ZipFile(full_symbols) if full_symbols and Path(full_symbols).is_file() else None
        try:
            names = package.namelist()
            expected = {f'lib/{abi}/{library}' for abi in abis for library in JNI_LIBRARIES}
            if not expected.issubset(names) or any(names.count(name) != 1 for name in expected):
                raise ValueError('Final APK is missing or duplicating a compiled JNI library')
            for abi in abis:
                for library in JNI_LIBRARIES:
                    packaged = temporary / f'{abi}-{library}'
                    packaged.write_bytes(package.read(f'lib/{abi}/{library}'))
                    identity = symbols.inspect_elf(packaged, abi, readelf)
                    # This is AGP/ndk-build's object output, not its stripped libs output.
                    candidates = list(ndk_outputs.glob(f'Release/*/obj/local/{abi}/{library}'))
                    if metadata is not None:
                        name = f'{abi}/{library}.dbg'
                        if name in metadata.namelist():
                            target = temporary / f'{abi}-{library}.dbg'
                            target.write_bytes(metadata.read(name))
                            candidates.append(target)
                    matching = []
                    for candidate in candidates:
                        info = symbols.inspect_elf(candidate, abi, readelf)
                        if info['build_id'] == identity['build_id'] and info['debug_line'] and info['symtab']:
                            matching.append(candidate)
                    if not matching:
                        raise ValueError(f'This build has no matching JNI line symbols: {abi}/{library}')
                    # Prefer the actual ndk-build ELF; FULL metadata may be a smaller debug-only ELF.
                    symbols.record(output, abi, library, matching[0], packaged, producer, readelf)
            webrtc_name = 'assets/licenses/webrtc/BUILD-PROVENANCE.json'
            audio_name = 'assets/licenses/rtc-audio/artifacts.json'
            webrtc = json.loads(package.read(webrtc_name)) if webrtc_name in names else {}
            audio = json.loads(package.read(audio_name)) if audio_name in names else {}
            for name in sorted(n for n in names if n.startswith('lib/') and n.endswith('.so') and n not in expected):
                if names.count(name) != 1:
                    raise ValueError('Duplicate prebuilt native library in APK')
                _, abi, library = name.split('/')
                packaged = temporary / f'{abi}-{library}'
                packaged.write_bytes(package.read(name))
                info = symbols.inspect_elf(packaged, abi, readelf, require_build_id=False)
                reference = None
                if library == 'libjingle_peerconnection_so.so':
                    reference = archive_reference(webrtc.get('native_symbols'), 'webrtc')
                elif library == 'libdatachannel.so':
                    reference = archive_reference(audio.get(abi, {}).get('native_symbols'), 'rtc-audio')
                packaged_sha256, packaged_bytes = symbols.sha(packaged), packaged.stat().st_size
                if not reference and historical.get((abi, library)) != (packaged_sha256, packaged_bytes):
                    raise ValueError(f'New or changed prebuilt has no matching producer symbols: {abi}/{library}')
                prebuilt.append({'abi': abi, 'library': library, 'build_id': info['build_id'],
                    'packaged_sha256': packaged_sha256, 'packaged_bytes': packaged_bytes,
                    'status': 'producer-archive' if reference else 'historical-missing',
                    **({'producer_archive': reference} if reference else {})})
        finally:
            if metadata is not None:
                metadata.close()
    index = json.loads((output / 'index.json').read_text())
    index['prebuilt_libraries'] = prebuilt
    symbols.write_index(output, index)
    symbols.verify(output, readelf)
    return index


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=Path)
    parser.add_argument('--ndk-outputs', type=Path, required=True)
    parser.add_argument('--full-symbols', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--readelf', default='readelf')
    args = parser.parse_args()
    result = collect(args.apk, args.ndk_outputs, args.output, args.full_symbols, readelf=args.readelf)
    print(f'JNI symbols: {len(result["entries"])}; prebuilt coverage records: {len(result["prebuilt_libraries"])}')
