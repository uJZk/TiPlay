#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Extract validated browser audio flight records; never infer CPU or acoustic causes from counters."""
import argparse
import base64
import io
import json
from pathlib import Path
import struct
import zipfile


def capture_events(source):
    with zipfile.ZipFile(source) as archive:
        for name in archive.namelist():
            if not name.endswith(('.tsv', '.tsv.zst')):
                continue
            with archive.open(name) as raw:
                if name.endswith('.zst'):
                    try:
                        import zstandard
                    except ImportError as error:
                        raise RuntimeError('Install the Python zstandard package to read this capture.') from error
                    stream = zstandard.ZstdDecompressor().stream_reader(raw)
                else:
                    stream = raw
                session = 0
                for line in io.TextIOWrapper(stream, encoding='utf-8'):
                    if not line.strip():
                        continue
                    fields = line.rstrip('\n').split('\t', 4)
                    if len(fields) != 5:
                        raise ValueError('Incomplete capture row')
                    at, sequence, channel, size, payload = fields
                    if channel == 'capture/start':
                        session += 1
                    if channel != 'browser/audio-evidence':
                        continue
                    data = base64.b64decode(payload, validate=True)
                    if len(data) != int(size) or len(data) > 12 * 1024:
                        raise ValueError('Invalid evidence size')
                    yield name, session, int(at), int(sequence), json.loads(data)


def analyze(source, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    records, identities = [], set()
    for name, session, at, sequence, event in capture_events(source):
        if event.get('schema') != 1 or event.get('pcmFormat') != 'f32le':
            raise ValueError('Unsupported evidence schema')
        main = event.get('main', {})
        identity = (name, session, main.get('receivedAtMs'), main.get('processorInstance'), main.get('diagnosticRevision'), event['id'])
        if identity in identities:
            continue
        identities.add(identity)
        number = len(records)
        # Retain exact floats and row positions; never join blocks across a frame discontinuity as continuous sound.
        for index, block in enumerate(event['blocks']):
            data = base64.b64decode(block['pcm'], validate=True)
            if not data:
                continue
            expected = block['waveFrames'] * block['waveChannels'] * 4
            if len(data) != expected:
                raise ValueError('Waveform length mismatch')
            struct.unpack('<' + 'f' * (len(data) // 4), data)
            (output / f'event-{number:04d}-block-{index}.f32le').write_bytes(data)
        (output / f'event-{number:04d}.json').write_text(json.dumps(event, indent=2, allow_nan=False) + '\n')
        records.append({'captureEpochMillis': at, 'captureSequence': sequence, 'id': event['id'],
                        'processorInstance': main.get('processorInstance'), 'clock': event['clock'],
                        'causes': event['causes'], 'incomplete': event['incomplete'],
                        'waveformOmittedBlocks': event['waveformOmittedBlocks'],
                        'partialWaveformBlocks': sum(b['waveFrames'] < b['blockFrames'] or b['waveChannels'] < b['channels'] for b in event['blocks']),
                        'maxRecordedCallbackMs': max((b['durationMs'] for b in event['blocks'] if b.get('durationMs') is not None), default=None),
                        'cpuLimited': None, 'acousticCause': None})
    report = {'events': records, 'count': len(records), 'limitations': [
        'No recorded event does not prove clean audio: inspect suppressed/dropped/truncated counters and capture integrity.',
        'Callback wall duration includes preemption; wall-clock timers have limited precision and may jump.',
        'Browser output PCM precedes the audio backend and speakers. A large sample step is a candidate, not a proven click.',
        'Confirm CPU saturation, throttling or scheduling with a target-device system trace and aligned audio evidence.',
    ]}
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = analyze(args.capture, args.output)
    print(json.dumps({'events': result['count'], 'output': str(args.output)}))
