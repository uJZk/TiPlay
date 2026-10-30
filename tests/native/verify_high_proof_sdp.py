#!/usr/bin/env python3
"""Verify the actual probe SDP offers and answers contain the fixture's High SPS."""
import argparse
import json
from pathlib import Path
import re
import subprocess

EXPECTED_PROFILE = "64002a"
EXPECTED_FRAMES = 180
EXPECTED_IDRS = {0, 60, 120}


def verify_average_bitrate(data, maximum):
    if type(maximum) is not int or maximum <= 0:
        raise ValueError('Maximum average fixture bitrate must be positive')
    bitrate = len(data) * 8 * 60 / EXPECTED_FRAMES
    if not data or bitrate > maximum:
        raise ValueError('Fixture average bitrate exceeds the control limit or is empty')
    return bitrate


def verify_ffprobe(result):
    streams = result.get("streams") if isinstance(result, dict) else None
    if not isinstance(streams, list) or len(streams) != 1 or not isinstance(streams[0], dict):
        raise ValueError("ffprobe did not return exactly one video stream")
    stream = streams[0]
    if stream.get("profile") != "High" or stream.get("level") != 42:
        raise ValueError(f"Fixture ffprobe profile/level must be High/42: {stream}")
    if stream.get("width") != 1568 or stream.get("height") != 1080:
        raise ValueError("Fixture dimensions must match the probe's 1568x1080 source config")
    if str(stream.get("nb_read_frames")) != str(EXPECTED_FRAMES):
        raise ValueError("Fixture must decode to exactly 180 frames")
    frames = result.get("frames")
    if not isinstance(frames, list) or len(frames) != EXPECTED_FRAMES:
        raise ValueError("Fixture decoded frame observations are missing")
    for index, frame in enumerate(frames):
        if (not isinstance(frame, dict) or frame.get("key_frame") != int(index in EXPECTED_IDRS)
                or frame.get("pict_type") != ("I" if index in EXPECTED_IDRS else "P")):
            raise ValueError("Fixture must contain IDR/I frames at 0/60/120 and P frames otherwise")


def fixture_profile(data):
    units = re.split(b"\x00\x00\x00?\x01", data)
    aud_indexes = [i for i, unit in enumerate(units) if unit and unit[0] & 31 == 9]
    if len(aud_indexes) != EXPECTED_FRAMES:
        raise ValueError("Fixture must contain exactly 180 complete access units with AUD")
    profiles = {unit[1:4].hex() for unit in units if len(unit) >= 4 and unit[0] & 31 == 7}
    first_units = units[aud_indexes[0]:aud_indexes[1]]
    if profiles != {EXPECTED_PROFILE} or not any(len(unit) >= 4 and unit[0] & 31 == 7 for unit in first_units):
        raise ValueError(f"Fixture first access unit/all SPS do not match {EXPECTED_PROFILE}: {profiles}")
    for index, start in enumerate(aud_indexes):
        end = aud_indexes[index + 1] if index + 1 < len(aud_indexes) else len(units)
        types = {unit[0] & 31 for unit in units[start:end] if unit}
        expected_vcl = 5 if index in EXPECTED_IDRS else 1
        if types.intersection({1, 2, 3, 4, 5}) != {expected_vcl}:
            raise ValueError("Fixture access-unit IDR/P cadence does not match 0/60/120")
        if index in EXPECTED_IDRS and not {7, 8}.issubset(types):
            raise ValueError("Each fixture IDR must include original SPS and PPS")
    return EXPECTED_PROFILE


def verify_sdp(text, profile, mid, role):
    sections, groups = {}, []
    section = None
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith('a=group:BUNDLE '):
            if section is not None:
                raise ValueError('BUNDLE group must be session-level')
            groups.append(line.split()[1:])
        if line.startswith('m='):
            fields = line.split()
            if len(fields) < 4 or not fields[1].split('/')[0].isdigit():
                raise ValueError('Invalid media line')
            section = {'type': fields[0][2:], 'port': int(fields[1].split('/')[0]),
                       'mid': None, 'bundle_only': False, 'direction': 'sendrecv',
                       'listed_payloads': set(fields[3:]), 'payloads': set(), 'fmtps': {}}
        if section is None:
            continue
        if line.startswith('a=mid:'):
            value = line[6:]
            if not value or section['mid'] is not None or value in sections:
                raise ValueError('Missing or duplicate MID')
            section['mid'] = value
            sections[value] = section
        if line in ('a=inactive', 'a=sendonly', 'a=recvonly', 'a=sendrecv'):
            section['direction'] = line[2:]
        if line == 'a=bundle-only':
            section['bundle_only'] = True
        media = re.fullmatch(r'a=rtpmap:(\d+)\s+H264/90000', line, re.IGNORECASE)
        if media:
            section['payloads'].add(media.group(1))
        fmtp = re.fullmatch(r'a=fmtp:(\d+)\s+(.+)', line, re.IGNORECASE)
        if fmtp:
            payload = fmtp.group(1)
            if payload in section['fmtps']:
                raise ValueError('Duplicate SDP fmtp line')
            values = {}
            for param in fmtp.group(2).split(';'):
                if '=' in param:
                    name, value = param.split('=', 1)
                    name = name.strip().lower()
                    if name in values:
                        raise ValueError('Duplicate SDP fmtp parameter')
                    values[name] = value.strip().lower()
            section['fmtps'][payload] = values
    target = sections.get(mid)
    if target is None or target['type'] != 'video':
        raise ValueError('Recorded video MID is missing or belongs to another media type')
    if role not in ('offer', 'answer') or target['direction'] != ('recvonly' if role == 'offer' else 'sendonly'):
        raise ValueError('Recorded video MID has the wrong negotiated direction')
    memberships = [group for group in groups if mid in group]
    if len(memberships) > 1:
        raise ValueError('Video MID occurs in multiple BUNDLE groups')
    if memberships:
        group = memberships[0]
        if len(set(group)) != len(group) or any(value not in sections for value in group):
            raise ValueError('BUNDLE contains duplicate or unknown MIDs')
        anchor = sections[group[0]]
        if anchor['port'] == 0 or anchor['bundle_only']:
            raise ValueError('BUNDLE tag has no accepted transport')
    if target['port'] == 0:
        if role != 'offer' or not target['bundle_only'] or not memberships:
            raise ValueError('Recorded video MID was rejected or lacks valid BUNDLE transport')
    elif target['bundle_only']:
        raise ValueError('bundle-only requires zero offer port')
    payloads = {payload for payload, values in target['fmtps'].items()
                if payload in target['payloads'] and payload in target['listed_payloads']
                and values.get('profile-level-id') == profile and values.get('packetization-mode') == '1'}
    if not payloads:
        raise ValueError('Recorded video MID has no exact High profile/mode payload')
    return {'payloads': payloads, 'bundle': memberships[0] if memberships else None}


def verify_pair(offer, answer, profile, mid, require_bundle=False):
    offered = verify_sdp(offer, profile, mid, 'offer')
    answered = verify_sdp(answer, profile, mid, 'answer')
    if not answered['payloads'].issubset(offered['payloads']):
        raise ValueError('Answer High payload does not match the same MID in the offer')
    offer_group, answer_group = offered['bundle'], answered['bundle']
    if require_bundle and offer_group is None:
        raise ValueError('Bundle scenario target MID has no offered BUNDLE group')
    if (offer_group is None) != (answer_group is None):
        raise ValueError('Answer changed target MID BUNDLE membership')
    if offer_group is not None:
        if answer_group[0] != offer_group[0]:
            raise ValueError('Answer changed target MID BUNDLE tag')
        if not set(answer_group).issubset(offer_group):
            raise ValueError('Answer moved MIDs into another offered BUNDLE group')


def verify_result(path, profile):
    result = json.loads(path.read_text())
    stages = ['initial']
    if result.get('mode') in ('bundle', 'bundle-video-anchor'):
        stages += ['replacement-0', 'replacement-1', 'replacement-2']
    observations = result.get('videoNegotiations')
    if not isinstance(observations, list) or len(observations) != len(stages):
        raise ValueError('Actual transceiver MID observations are missing')
    mids = set()
    for stage, observation in zip(stages, observations):
        mid = observation.get('mid') if isinstance(observation, dict) else None
        if (not isinstance(mid, str) or not mid or observation.get('stage') != stage or mid in mids):
            raise ValueError('Negotiation MID/stage is invalid, duplicated or out of order')
        mids.add(mid)
        stem = '' if stage == 'initial' else 'bundle-'
        suffix = '' if stage == 'initial' else '-' + stage.rsplit('-', 1)[1]
        offer = path.parent / (stem + 'offer' + suffix + '.sdp')
        answer = path.parent / (stem + 'answer' + suffix + '.sdp')
        verify_pair(offer.read_text(), answer.read_text(), profile, mid,
                    require_bundle=result.get('mode') in ('bundle', 'bundle-video-anchor'))
        print(f'{stage}: actual transceiver MID {mid} has matching High offer/answer')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--result", nargs="*", type=Path, default=[])
    parser.add_argument("--max-average-bitrate", type=int)
    args = parser.parse_args()
    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
        "stream=profile,level,width,height,nb_read_frames:frame=key_frame,pict_type",
        "-count_frames", "-of", "json", str(args.fixture),
    ], text=True))
    verify_ffprobe(probe)
    print("Fixture ffprobe stream: " + json.dumps(probe["streams"][0], sort_keys=True), flush=True)
    profile = fixture_profile(args.fixture.read_bytes())
    if args.max_average_bitrate is not None:
        bitrate = verify_average_bitrate(args.fixture.read_bytes(), args.max_average_bitrate)
        print(f"Fixture average bitrate at 60 fps: {bitrate:.0f} bps")
    print(f"Fixture SPS profile-level-id: {profile}", flush=True)
    for path in args.result:
        verify_result(path, profile)


if __name__ == "__main__":
    main()
