#!/usr/bin/env python3
"""Regression checks for bounded emulator-only failure diagnostics."""
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest

from summarize_synthetic_probe_log import MAX_LINE_LENGTH, MAX_LINES, summarize


class SyntheticProbeTailTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "proof"
        self.root.mkdir()
        self.log = self.root / "custom" / "serial-0-0-source-rate.log"
        self.log.parent.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def test_tail_is_bounded_and_redacts_network_and_authentication(self):
        lines = [f"line {i}" for i in range(MAX_LINES + 5)]
        lines[-3:] = ["candidate 192.0.2.42 2001:db8::12 https://example.test/private",
                      "ice-pwd=private-value", "x" * (MAX_LINE_LENGTH + 300)]
        self.log.write_text("\n".join(lines), encoding="utf-8")
        output = summarize(self.root, self.log)
        self.assertEqual(len(output.splitlines()), MAX_LINES)
        self.assertNotIn("line 0\n", output)
        for private in ("192.0.2.42", "2001:db8::12", "example.test", "private-value"):
            self.assertNotIn(private, output)
        self.assertIn("[line containing authentication material omitted]", output)
        self.assertLessEqual(max(map(len, output.splitlines())), MAX_LINE_LENGTH + 1)

    def test_rejects_outside_root_or_unexpected_filename_and_reports_missing(self):
        outside = self.root.parent / "serial-0-0-source-rate.log"
        with self.assertRaises(ValueError):
            summarize(self.root, outside)
        with self.assertRaises(ValueError):
            summarize(self.root, self.log.parent / "other.log")
        self.assertEqual(summarize(self.root, self.log), "No synthetic scenario console log was created.")

    def test_workflow_prints_failure_tail_and_keeps_nonzero_exit(self):
        self.log.write_text("Native failure at 192.0.2.42\n", encoding="utf-8")
        stub = self.root / "driver.py"
        stub.write_text("import sys\nsys.exit(7)\n", encoding="utf-8")
        repo = Path(__file__).resolve().parents[2]
        workflow = (repo / ".github/workflows/native-emulator-proof.yml").read_text(encoding="utf-8")
        begin = workflow.index("          run_probe() {\n")
        end = workflow.index("          python3 \"$driver\" build", begin)
        function = textwrap.dedent(workflow[begin:end])
        script = 'root="$PROOF_ROOT"\ndriver="$STUB_DRIVER"\n' + function + \
            '\nrun_probe "$root/custom/serial-0-0-source-rate.log" --source-rate\n'
        result = subprocess.run(["bash", "-c", script], cwd=repo, text=True, capture_output=True,
                                env=os.environ | {"PROOF_ROOT": str(self.root), "STUB_DRIVER": str(stub)})
        self.assertEqual(result.returncode, 7)
        self.assertIn("Native failure at [address]", result.stderr)
        self.assertNotIn("192.0.2.42", result.stderr)


if __name__ == "__main__":
    unittest.main()
