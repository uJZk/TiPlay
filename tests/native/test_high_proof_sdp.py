#!/usr/bin/env python3
"""Verify fixture/SPS and SDP matching logic without an Android runtime."""
import unittest

from verify_high_proof_sdp import EXPECTED_PROFILE, fixture_profile, verify_ffprobe, verify_sdp, verify_pair, verify_result, verify_average_bitrate


class HighProofSdpTest(unittest.TestCase):
    def test_control_average_bitrate_is_a_separate_strict_limit(self):
        self.assertEqual(verify_average_bitrate(b'x' * 75000, 300000), 200000)
        for data, limit in ((b'x' * 150000, 300000), (b'', 300000), (b'x', 0), (b'x', -1)):
            with self.assertRaises(ValueError):
                verify_average_bitrate(data, limit)
    def fixture(self):
        aud = b"\0\0\0\1\x09\xf0"
        key = aud + b"\0\0\0\1\x67\x64\0\x2a\0\0\0\1\x68\x01\0\0\0\1\x65\x01"
        predicted = aud + b"\0\0\0\1\x41\x01"
        return b"".join(key if i % 60 == 0 else predicted for i in range(180))

    def decoded(self):
        return {"streams": [{"profile": "High", "level": 42, "width": 1568,
                             "height": 1080, "nb_read_frames": "180"}],
                "frames": [{"key_frame": int(i % 60 == 0), "pict_type": "I" if i % 60 == 0 else "P"}
                           for i in range(180)]}

    def test_ffprobe_requires_exactly_one_high_level_42_video_stream(self):
        verify_ffprobe(self.decoded())
        for result in ({"streams": []}, {"streams": [{"profile": "Baseline", "level": 42}]},
                       {"streams": [{"profile": "High", "level": 41}]}, {},
                       {"streams": [{"profile": "High", "level": 42}] * 2}):
            with self.subTest(result=result), self.assertRaises(ValueError):
                verify_ffprobe(result)

    def test_decoded_dimensions_count_and_frame_cadence_are_required(self):
        for field, value in (("width", 1280), ("height", 720), ("nb_read_frames", "179")):
            result = self.decoded()
            result["streams"][0][field] = value
            with self.assertRaises(ValueError):
                verify_ffprobe(result)
        for change in ("missing", "b-frame", "extra-key"):
            result = self.decoded()
            if change == "missing": result.pop("frames")
            elif change == "b-frame": result["frames"][1]["pict_type"] = "B"
            else: result["frames"][1]["key_frame"] = 1
            with self.assertRaises(ValueError):
                verify_ffprobe(result)

    def test_fixture_requires_matching_sps_within_first_access_unit(self):
        frame = self.fixture()
        self.assertEqual(fixture_profile(frame), EXPECTED_PROFILE)
        with self.assertRaises(ValueError):
            fixture_profile(frame.replace(b"\x64\0\x2a", b"\x64\x10\x2a"))
        with self.assertRaises(ValueError):
            fixture_profile(b"\0\0\0\1\x09\xf0" + frame)

    def test_access_units_require_exact_idr_cadence_and_parameter_sets(self):
        for bad in (self.fixture().replace(b"\x65\x01", b"\x41\x01", 1),
                    self.fixture().replace(b"\x68\x01", b"\x06\x01", 1),
                    self.fixture().replace(b"\x41\x01", b"\x65\x01", 1)):
            with self.assertRaises(ValueError):
                fixture_profile(bad)

    def video(self, mid='v', role='offer', profile=EXPECTED_PROFILE, payload='97', port=9):
        direction = 'recvonly' if role == 'offer' else 'sendonly'
        return (f'm=video {port} UDP/TLS/RTP/SAVPF {payload}\r\na=mid:{mid}\r\na={direction}\r\n'
                f'a=rtpmap:{payload} H264/90000\r\na=fmtp:{payload} packetization-mode=1;profile-level-id={profile}\r\n')

    def test_pair_requires_actual_mid_with_matching_profile_mode_and_payload(self):
        offer, answer = self.video(), self.video(role='answer')
        verify_pair(offer, answer, EXPECTED_PROFILE, 'v')
        for bad in (self.video(role='answer', profile='64102a'),
                    self.video(role='answer', profile='42002a'), self.video(role='answer', payload='98'),
                    self.video(role='answer', mid='other'), answer.replace('mode=1', 'mode=0'),
                    answer.replace('a=sendonly', 'a=inactive'), answer.replace('a=sendonly', 'a=recvonly'),
                    answer.replace('SAVPF 97', 'SAVPF 98')):
            with self.subTest(answer=bad), self.assertRaises(ValueError):
                verify_pair(offer, bad, EXPECTED_PROFILE, 'v')

    def test_old_high_line_cannot_mask_rejected_or_baseline_target(self):
        old = self.video(mid='old', role='answer')
        for target in (self.video(role='answer', port=0), self.video(role='answer', profile='42002a'),
                       self.video(role='answer').replace('a=sendonly', 'a=inactive')):
            with self.assertRaises(ValueError):
                verify_pair(self.video(), old + target, EXPECTED_PROFILE, 'v')

    def test_bundle_only_requires_valid_group_and_accepted_tag(self):
        anchor = 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=mid:data\r\n'
        target = self.video(port=0) + 'a=bundle-only\r\n'
        valid = 'a=group:BUNDLE data v\r\n' + anchor + target
        answer = 'a=group:BUNDLE data v\r\n' + anchor + self.video(role='answer')
        verify_pair(valid, answer, EXPECTED_PROFILE, 'v', require_bundle=True)
        invalid = [anchor + target, 'a=group:BUNDLE data other\r\n' + anchor + target,
                   'a=group:BUNDLE missing v\r\n' + anchor + target,
                   valid.replace('m=application 9', 'm=application 0'),
                   valid.replace('BUNDLE data v', 'BUNDLE v data'),
                   valid.replace('BUNDLE data v', 'BUNDLE data v v')]
        for text in invalid:
            with self.subTest(offer=text), self.assertRaises(ValueError):
                verify_pair(text, self.video(role='answer'), EXPECTED_PROFILE, 'v')
        with self.assertRaises(ValueError):
            verify_pair(self.video(), valid.replace('recvonly', 'sendonly'), EXPECTED_PROFILE, 'v')

    def test_bundle_pair_retains_group_membership_tag_and_offered_mapping(self):
        anchor = 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=mid:data\r\n'
        offer = 'a=group:BUNDLE data v\r\n' + anchor + self.video()
        answer = 'a=group:BUNDLE data v\r\n' + anchor + self.video(role='answer')
        verify_pair(offer, answer, EXPECTED_PROFILE, 'v', require_bundle=True)
        for bad in (anchor + self.video(role='answer'),
                    answer.replace('BUNDLE data v', 'BUNDLE data'),
                    answer.replace('BUNDLE data v', 'BUNDLE v data'),
                    answer.replace('BUNDLE data v', 'BUNDLE data v other') + self.video(mid='other', role='answer'),
                    answer.replace('BUNDLE data v', 'BUNDLE v\r\na=group:BUNDLE data')):
            with self.subTest(answer=bad), self.assertRaises(ValueError):
                verify_pair(offer, bad, EXPECTED_PROFILE, 'v', require_bundle=True)
        with self.assertRaises(ValueError):
            verify_pair(self.video(), answer, EXPECTED_PROFILE, 'v')
        other = self.video(mid='other')
        two_groups = offer.replace('a=group:BUNDLE data v\r\n',
                                   'a=group:BUNDLE data v\r\na=group:BUNDLE other\r\n') + other
        moved = answer.replace('BUNDLE data v', 'BUNDLE data v other') + self.video(mid='other', role='answer')
        with self.assertRaises(ValueError):
            verify_pair(two_groups, moved, EXPECTED_PROFILE, 'v', require_bundle=True)
        with self.assertRaises(ValueError):
            verify_pair(self.video(), self.video(role='answer'), EXPECTED_PROFILE, 'v', require_bundle=True)

    def test_duplicate_mid_and_fmtp_are_rejected(self):
        for bad in (self.video() + self.video(),
                    self.video() + 'a=fmtp:97 packetization-mode=1;profile-level-id=64002a\r\n'):
            with self.assertRaises(ValueError):
                verify_pair(bad, self.video(role='answer'), EXPECTED_PROFILE, 'v')

    def test_recorded_generation_mids_are_mandatory_and_drive_each_pair(self):
        import json
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            result = root / 'probe.json'
            result.write_text(json.dumps({'mode': 'serial', 'videoNegotiations': [{'stage': 'initial', 'mid': 'v'}]}))
            (root / 'offer.sdp').write_text(self.video())
            (root / 'answer.sdp').write_text(self.video(role='answer'))
            verify_result(result, EXPECTED_PROFILE)
            result.write_text(json.dumps({'mode': 'bundle', 'videoNegotiations': [{'stage': 'initial', 'mid': 'v'}]}))
            with self.assertRaises(ValueError):
                verify_result(result, EXPECTED_PROFILE)

    def test_each_replacement_pair_uses_its_recorded_mid(self):
        import json
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stages = ['initial', 'replacement-0', 'replacement-1', 'replacement-2']
            records = [{'stage': stage, 'mid': str(i)} for i, stage in enumerate(stages)]
            result = root / 'probe.json'
            result.write_text(json.dumps({'mode': 'bundle', 'videoNegotiations': records}))
            for i in range(4):
                stem, suffix = ('', '') if i == 0 else ('bundle-', '-' + str(i - 1))
                for role in ('offer', 'answer'):
                    text = ('a=group:BUNDLE data ' + str(i) + '\r\n'
                            'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=mid:data\r\n'
                            + self.video(mid=str(i), role=role))
                    (root / (stem + role + suffix + '.sdp')).write_text(text)
            verify_result(result, EXPECTED_PROFILE)
            (root / 'bundle-answer-2.sdp').write_text(self.video(mid='0', role='answer') + self.video(mid='3', role='answer', port=0))
            with self.assertRaises(ValueError):
                verify_result(result, EXPECTED_PROFILE)


if __name__ == "__main__":
    unittest.main()
