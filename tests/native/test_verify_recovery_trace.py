import copy
import unittest

from verify_recovery_trace import verify


def valid_trace():
    return {
        "androidPeer": "BrowserRtcPeer", "browser": "Chromium",
        "sameControlChannel": True, "controlEchoBefore": True,
        "controlEchoAfter": True, "audioContinuityVerified": True,
        "events": [
            {"kind": "native-failure", "generation": 1, "epoch": 8, "sequence": 1},
            {"kind": "renegotiation-required", "generation": 1, "sequence": 2},
            {"kind": "video-offer", "generation": 2, "transaction": 3, "sequence": 3},
            {"kind": "video-answer", "generation": 2, "transaction": 3, "sequence": 4},
            {"kind": "video-ready", "generation": 2, "sequence": 5},
            {"kind": "keyframe-presented", "generation": 2, "epoch": 9, "sequence": 6},
        ],
    }


class RecoveryTraceTest(unittest.TestCase):
    def test_matching_recovery(self):
        self.assertTrue(verify(valid_trace()))

    def test_rejects_missing_or_out_of_order_events(self):
        for mode in ("missing", "reorder", "same_sequence"):
            trace = valid_trace()
            if mode == "missing":
                trace["events"].pop()
            elif mode == "reorder":
                trace["events"][3], trace["events"][4] = trace["events"][4], trace["events"][3]
            else:
                trace["events"][4]["sequence"] = 4
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                verify(trace)

    def test_rejects_stale_generation_or_transaction(self):
        for key, value in (("generation", 1), ("transaction", 4)):
            trace = valid_trace()
            trace["events"][3][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                verify(trace)

    def test_rejects_reused_epoch_or_unverified_continuity(self):
        for mode in ("epoch", "control", "audio", "peer"):
            trace = copy.deepcopy(valid_trace())
            if mode == "epoch":
                trace["events"][-1]["epoch"] = 8
            elif mode == "control":
                trace["controlEchoAfter"] = False
            elif mode == "audio":
                trace["audioContinuityVerified"] = False
            else:
                trace["androidPeer"] = "mock"
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                verify(trace)


if __name__ == "__main__":
    unittest.main()
