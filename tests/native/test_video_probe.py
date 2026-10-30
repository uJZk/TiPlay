#!/usr/bin/env python3
"""Offline probe-driver checks; no Android device or native AAR execution."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest import mock

DRIVER = Path(__file__).with_name("rtc-video-probe.py")
SPEC = importlib.util.spec_from_file_location("rtc_video_probe", DRIVER)
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


class VideoProbeDriverTest(unittest.TestCase):
    def test_queue_epoch_evidence_rejects_missing_reused_and_unretired_senders(self):
        evidence = [{"stage": "initial-before-first-frame", "epoch": 7, "failureEpoch": 0}]
        for i in range(3):
            evidence.extend([{"stage": f"retired-{i}", "retiredEpoch": 7 + i, "epoch": 0, "failureEpoch": 0},
                             {"stage": f"replacement-{i}", "epoch": 8 + i, "failureEpoch": 0}])
        probe.verify_queue_epoch_proof(evidence)
        for broken in (evidence[:-1],
                       [{**entry, **({"epoch": 7} if n == 2 else {})} for n, entry in enumerate(evidence)],
                       [{**entry, **({"epoch": 1} if n == 1 else {})} for n, entry in enumerate(evidence)],
                       [{**entry, **({"failureEpoch": 7} if n == 0 else {})} for n, entry in enumerate(evidence)]):
            with self.assertRaises(ValueError):
                probe.verify_queue_epoch_proof(broken)

    def native_result(self):
        return {"requestedRateControlMode": "source-rate", "nativeRateControlVerified": False,
                "mode": "serial", "senderStats": {"ssrc": 123},
                "build": {"webrtcAarSha256": "custom-aar",
                          "webrtcAarProvenance": {"aar_sha256": "custom-aar", "patch_sha256": "patch",
                                                  "revision": probe.NATIVE_SOURCE_REVISION}}}

    def native_events(self):
        return [{"v": 1, "event": "controller_skipped", "transport": 7},
                {"v": 1, "event": "stream_attached", "transport": 7, "ssrc": 123, "rtx_limiter": False},
                {"v": 1, "event": "pacer_dispatch", "transport": 7, "ssrc": 123},
                {"v": 1, "event": "encoder_gate", "transport": 7, "ssrc": 123, "network": 1, "stream": 1, "allow": 1}]

    def test_matching_native_branches_verify_structure_but_not_all_rate_control(self):
        events = probe.parse_native_rate_events("\n".join("NativeTag " + probe.NATIVE_EVENT_PREFIX + json.dumps(e) for e in self.native_events()))
        result = self.native_result()
        evidence = probe.native_structural_activation(result, events, "patch")
        self.assertIs(evidence["verified"], True)
        self.assertIs(evidence["peerBindingVerified"], False)
        self.assertIs(evidence["identifiersLinkableWithinRun"], True)
        self.assertIs(evidence["allRateControlPathsVerified"], False)
        self.assertIs(result["nativeRateControlVerified"], False)
        self.assertIs(evidence["streams"][0]["networkResumeCycleVerified"], False)

    def test_trial_strings_or_missing_events_cannot_verify_native_structure(self):
        for events in ([], self.native_events()[:-1]):
            evidence = probe.native_structural_activation(self.native_result(), events, "patch")
            self.assertIs(evidence["verified"], False)

    def test_recreated_stream_identical_attachment_observations_keep_raw_count(self):
        events = self.native_events()
        events.insert(2, dict(events[1]))
        raw = "\n".join("rtp_transport_controller_send.cc: " + probe.NATIVE_EVENT_PREFIX + json.dumps(e) for e in events)
        parsed = probe.parse_native_rate_events(raw)
        evidence = probe.native_structural_activation(self.native_result(), parsed, "patch")
        self.assertIs(evidence["verified"], True)
        self.assertEqual(len(parsed), 5)
        self.assertEqual(evidence["streams"][0]["attachmentEventCount"], 2)
        self.assertEqual(evidence["streams"][0]["repeatedIdenticalAttachmentObservations"], 1)
        self.assertIs(evidence["streams"][0]["attachmentInstanceIdentityVerified"], False)
        self.assertIs(evidence["peerBindingVerified"], False)

    def test_repeated_attachment_with_conflicting_transport_or_limiter_is_rejected(self):
        for mutation in ({"transport": 8}, {"rtx_limiter": True}):
            events = self.native_events()
            conflicting = dict(events[1])
            conflicting.update(mutation)
            events.insert(2, conflicting)
            evidence = probe.native_structural_activation(self.native_result(), events, "patch")
            self.assertIs(evidence["verified"], False)
            self.assertIn("stream-attachment-missing-or-ambiguous:123", evidence["reasons"])

    def test_repeated_wrong_ssrc_attachment_cannot_supply_measured_stream(self):
        events = self.native_events()
        events[1]["ssrc"] = 456
        events.insert(2, dict(events[1]))
        evidence = probe.native_structural_activation(self.native_result(), events, "patch")
        self.assertIs(evidence["verified"], False)
        self.assertIn("stream-attachment-missing-or-ambiguous:123", evidence["reasons"])

    def test_native_events_with_mismatched_transport_or_stream_cannot_be_combined(self):
        for field, value in (("transport", 8), ("ssrc", 456)):
            events = self.native_events()
            events[-1][field] = value
            self.assertIs(probe.native_structural_activation(self.native_result(), events, "patch")["verified"], False)

    def test_matching_ssrc_does_not_establish_peer_transport_binding(self):
        # No observed PeerConnection-to-transport mapping exists: another complete
        # event chain with the same SSRC cannot be distinguished by this schema.
        events = self.native_events()
        for event in events:
            event["transport"] = 8
        evidence = probe.native_structural_activation(self.native_result(), events, "patch")
        self.assertIs(evidence["verified"], True)
        self.assertIs(evidence["peerBindingVerified"], False)
        self.assertEqual(evidence["associationLimit"], "ssrc-and-process-local-transport-only")

    def test_native_branch_events_still_require_matching_binary_provenance(self):
        result = self.native_result()
        result["build"]["webrtcAarProvenance"]["aar_sha256"] = "other-aar"
        self.assertIs(probe.native_structural_activation(result, self.native_events(), "patch")["verified"], False)
        self.assertIs(probe.native_structural_activation(self.native_result(), self.native_events(), "different-patch")["verified"], False)

    def test_zero_ids_malformed_events_and_contradictory_gates_are_rejected(self):
        for mutation in ({"transport": 0}, {"ssrc": 0}, {"allow": 0}):
            event = self.native_events()[-1]
            event.update(mutation)
            with self.assertRaises(ValueError):
                probe.parse_native_rate_events(probe.NATIVE_EVENT_PREFIX + json.dumps(event))
        with self.assertRaises(ValueError):
            probe.parse_native_rate_events(probe.NATIVE_EVENT_PREFIX + "not-json")

    def test_adaptive_negative_control_cannot_be_marked_source_active(self):
        result = self.native_result()
        result["requestedRateControlMode"] = "adaptive"
        evidence = probe.native_structural_activation(result, self.native_events(), "patch")
        self.assertIs(evidence["verified"], False)
        self.assertIn("unexpected-source-events-in-adaptive-mode", evidence["reasons"])

    def test_recreated_encoder_identical_gate_state_preserves_raw_count(self):
        events = self.native_events()
        events.append(dict(events[-1]))
        evidence = probe.native_structural_activation(self.native_result(), events, "patch")
        self.assertIs(evidence["verified"], True)
        self.assertEqual(len(events), 5)
        self.assertEqual(evidence["streams"][0]["gateEventCount"], 2)
        self.assertEqual(evidence["streams"][0]["uniqueGateObservationCount"], 1)
        self.assertEqual(evidence["streams"][0]["repeatedIdenticalGateObservations"], 1)
        self.assertIs(evidence["streams"][0]["gateInstanceIdentityVerified"], False)
        self.assertIs(evidence["peerBindingVerified"], False)
        self.assertIs(evidence["allRateControlPathsVerified"], False)

    def test_conflicting_gate_transport_or_allow_is_not_hidden_by_valid_gate(self):
        for mutation in ({"transport": 8}, {"allow": 0}, {"network": 0, "allow": 1}):
            events = self.native_events()
            other = dict(events[-1])
            other.update(mutation)
            events.append(other)
            self.assertIs(probe.native_structural_activation(self.native_result(), events, "patch")["verified"], False)

    def test_distinct_consistent_gate_states_remain_separate_observations(self):
        events = self.native_events()
        events.append(dict(events[-1], network=0, allow=0))
        evidence = probe.native_structural_activation(self.native_result(), events, "patch")
        self.assertIs(evidence["verified"], True)
        self.assertEqual(evidence["streams"][0]["uniqueGateObservationCount"], 2)
        self.assertEqual(evidence["streams"][0]["repeatedIdenticalGateObservations"], 0)
        self.assertIs(evidence["streams"][0]["networkResumeCycleVerified"], False)

    def test_repeated_pacer_events_still_fail(self):
        events = self.native_events()
        events.append(dict(events[-2]))
        self.assertIs(probe.native_structural_activation(self.native_result(), events, "patch")["verified"], False)

    def sample(self, *, phase="measured", sender="sender", stats="rtp", ssrc=1,
               time=1, sent=100, source=100, retransmitted=10):
        return {"phase": phase, "senderId": sender, "statsId": stats, "ssrc": ssrc,
                "statsTimestampUs": time * 1_000_000,
                "sampleMonotonicNanos": time * 1_000_000_000,
                "bytesSent": sent, "headerBytesSent": 20, "packetsSent": 1,
                "retransmittedBytesSent": retransmitted,
                "sourceBytes": source, "sourceFrames": 1}

    def test_rates_use_active_stream_deltas_and_separate_retransmissions(self):
        windows = probe.rate_windows([self.sample(), self.sample(time=3, sent=500, source=700, retransmitted=110)])
        self.assertEqual(len(windows), 1)
        self.assertEqual(windows[0]["rtpPayloadBitsPerSecond"], 1600)
        self.assertEqual(windows[0]["rtpPayloadExcludingRetransmissionBitsPerSecond"], 1200)
        self.assertEqual(windows[0]["sourceInputBitsPerSecond"], 2400)

    def test_retired_stream_and_generation_are_not_used_as_rate_baselines(self):
        samples = [self.sample(), self.sample(phase="replacement", time=2, sent=2),
                   self.sample(sender="new", time=3, sent=3),
                   self.sample(phase="next", stats="new-rtp", time=4, sent=4),
                   self.sample(phase="last", ssrc=2, time=5, sent=5)]
        self.assertEqual(probe.rate_windows(samples), [])

    def test_timestamp_or_counter_reset_fails_instead_of_reporting_false_rate(self):
        with self.assertRaisesRegex(ValueError, "timestamps"):
            probe.rate_windows([self.sample(), self.sample()])
        with self.assertRaisesRegex(ValueError, "counter reset"):
            probe.rate_windows([self.sample(), self.sample(time=2, sent=1)])

    def test_missing_rtp_fields_or_changed_active_identity_cannot_be_zero_baselines(self):
        missing = self.sample()
        del missing["ssrc"]
        with self.assertRaisesRegex(ValueError, "fields are missing"):
            probe.rate_windows([missing])
        with self.assertRaisesRegex(ValueError, "identity changed"):
            probe.rate_windows([self.sample(), self.sample(time=2, stats="retired")])

    def test_stock_unknown_trial_is_only_a_request_and_never_native_verification(self):
        result = {"requestedRateControlMode": "source-rate", "build": {"webrtcAarSha256": "stock"}}
        probe.describe_rate_control_evidence(result, argparse.Namespace(source_rate=True), "")
        self.assertIs(result["nativeRateControlVerified"], False)
        self.assertIs(result["rateControlEvidence"]["customAarProvenancePresent"], False)
        self.assertIs(result["rateControlEvidence"]["nativeActivationEvidence"], False)

    def test_provenance_alone_or_a_false_verified_claim_cannot_verify_native_activation(self):
        result = {"requestedRateControlMode": "source-rate", "build": {"webrtcAarProvenance": {"aar_sha256": "custom"}}}
        probe.describe_rate_control_evidence(result, argparse.Namespace(source_rate=True), "")
        self.assertIs(result["nativeRateControlVerified"], False)
        result["nativeRateControlVerified"] = True
        with self.assertRaisesRegex(ValueError, "observation-only"):
            probe.describe_rate_control_evidence(result, argparse.Namespace(source_rate=True), "")
        result["nativeRateControlVerified"] = False
        with self.assertRaisesRegex(ValueError, "explicit bitrate"):
            probe.describe_rate_control_evidence(result, argparse.Namespace(source_rate=True), "START_BITRATE true")

    def test_receiver_phase_missing_or_retired_statistics_are_rejected(self):
        before = {"statsId": "receiver", "ssrc": 1, "statsTimestampUs": 1,
                  "framesReceived": 1, "bytesReceived": 100, "packetsReceived": 1}
        after = dict(before, statsTimestampUs=2, framesReceived=61, bytesReceived=1000, packetsReceived=100)
        probe.validate_rtp_phase(before, after, "receiver", 60)
        for invalid in (dict(after, ssrc=2), {k: v for k, v in after.items() if k != "framesReceived"}):
            with self.assertRaises(ValueError):
                probe.validate_rtp_phase(before, invalid, "receiver", 60)

    def test_previous_generation_rate_windows_cannot_cover_the_final_phase(self):
        result = {"sourceBytes": 1000, "rateWindows": [
            {"phase": "generation-0", "sourceFramesDelta": 180, "sourceBytesDelta": 1000, "bytesSentDelta": 900}]}
        with self.assertRaisesRegex(ValueError, "Final-phase"):
            probe.validate_final_rate_observations(result, argparse.Namespace(mode="bundle", frames=180))

    def test_control_observations_keep_phase_coverage_without_low_latency_claim(self):
        observations = probe.control_phase_observations([
            {"phase": "generation-0", "stage": "heartbeat", "rttNanos": 5_000_000_000},
            {"phase": "replacement-0", "stage": "after", "rttNanos": 20_000_000}])
        self.assertEqual(observations["generation-0"]["heartbeats"], 1)
        self.assertEqual(observations["replacement-0"]["heartbeats"], 0)
        self.assertNotIn("lowLatencyVerified", observations["generation-0"])

    def test_source_rate_logs_do_not_overwrite_adaptive_comparison(self):
        fields = dict(mode="bundle", start_bitrate=0, encoder_delay=0)
        self.assertNotEqual(probe.scenario_label(argparse.Namespace(**fields, source_rate=True)),
                            probe.scenario_label(argparse.Namespace(**fields, source_rate=False)))

    def test_source_rate_rejects_a_positive_startup_before_device_access(self):
        result = subprocess.run([sys.executable, str(DRIVER), "run", "--work-dir", "/not-used",
                                 "--source-rate", "--start-bitrate", "32000000"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("--source-rate requires", result.stderr)

    def test_source_rate_default_is_zero_and_adaptive_default_is_retained(self):
        for flags, expected in ((["--source-rate"], 0), ([], 32000000)):
            with mock.patch.object(sys, "argv", [str(DRIVER), "run", "--work-dir", "/not-used", *flags]), \
                    mock.patch.object(probe, "execute") as execute:
                probe.main()
            self.assertEqual(execute.call_args.args[0].start_bitrate, expected)


if __name__ == "__main__":
    unittest.main()
