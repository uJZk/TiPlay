#!/usr/bin/env python3
"""Keep the focused interop proof isolated from producer publication and full CI."""
from pathlib import Path
import importlib.util
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/native-rtc-audio.yml"
HARNESS = ROOT / "tests/web-e2e/rtc-audio-native.mjs"


class AudioInteropWorkflowTest(unittest.TestCase):
    def test_existing_dispatch_keeps_android_default_and_host_is_a_separate_choice(self):
        source = WORKFLOW.read_text()
        self.assertIn("default: android-binaries", source)
        self.assertIn("type: choice", source)
        self.assertIn("if: ${{ inputs.mode != 'host-interop' }}", source)
        self.assertIn("if: ${{ inputs.mode == 'host-interop' }}", source)
        jobs = re.split(r"^  ([\w-]+):\n", source.split("jobs:\n", 1)[1], flags=re.M)
        jobs = dict(zip(jobs[1::2], jobs[2::2]))
        self.assertEqual({"native", "host-interop", "symbols"}, set(jobs))
        self.assertIn("needs: native", jobs["symbols"])
        self.assertNotIn("contents: write", jobs["host-interop"])
        self.assertNotIn("archive_native_symbols", jobs["host-interop"])

    def test_positive_control_is_required_before_negative_controls(self):
        source = WORKFLOW.read_text().split("  host-interop:\n", 1)[1].split("  symbols:\n", 1)[0]
        positive = source.index("run: node tests/web-e2e/rtc-audio-native.mjs\n")
        blackhole = source.index("--fault=udp-blackhole")
        password = source.index("--fault=wrong-ice-password")
        self.assertLess(positive, blackhole)
        self.assertLess(blackhole, password)
        self.assertNotIn("continue-on-error", source)
        self.assertNotIn("assembleDebug", source)
        self.assertNotIn("testDebugUnitTest", source)
        self.assertIn(":shared:compileDebugKotlin", source)
        self.assertIn("build.py --host", source)
        self.assertIn("tiplay-audio-interop/*.json", source)

    def test_no_machine_policy_or_browser_ice_policy_override(self):
        source = WORKFLOW.read_text() + HARNESS.read_text()
        for override in ["WebRtcIPHandling", "force-webrtc-ip-handling-policy", "policies/managed",
                         "disable-features=WebRtcHideLocalIpsWithMdns"]:
            self.assertNotIn(override, source)
        self.assertIn("status: blocked ? 'blocked' : 'failed'", source)
        self.assertIn("process.exitCode = 1", source)
        self.assertIn("firstPeerPeak > .001", source)
        self.assertIn("result.peak > .001", source)

    def test_workflow_uses_only_valid_job_environment_contexts(self):
        path = ROOT / "tests/native/test_proof_workflow_contexts.py"
        spec = importlib.util.spec_from_file_location("proof_contexts", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.validate_job_env_contexts(WORKFLOW.read_text())


if __name__ == "__main__":
    unittest.main()
