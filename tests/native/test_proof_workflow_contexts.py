#!/usr/bin/env python3
"""Check expression contexts where the native proof declares job-level env."""
from pathlib import Path
import re
import unittest

WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/native-emulator-proof.yml"
JOB_ENV_CONTEXTS = {"github", "needs", "strategy", "matrix", "vars", "secrets", "inputs"}


def validate_job_env_contexts(source):
    in_jobs = False
    in_job_env = False
    for number, line in enumerate(source.splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        if indent == 0:
            in_jobs = line == "jobs:"
            in_job_env = False
        elif in_jobs and indent <= 4:
            in_job_env = indent == 4 and line.strip() == "env:"
        elif in_jobs and in_job_env:
            for context in re.findall(r"\$\{\{\s*([A-Za-z_][A-Za-z_0-9]*)\s*\.", line):
                if context not in JOB_ENV_CONTEXTS:
                    raise ValueError(f"Invalid job env expression context {context} at line {number}")


class ProofWorkflowContextsTest(unittest.TestCase):
    def test_current_workflow_job_env(self):
        validate_job_env_contexts(WORKFLOW.read_text(encoding="utf-8"))

    def test_job_runner_context_is_rejected_but_step_runner_context_is_allowed(self):
        job = "jobs:\n  proof:\n    env:\n      AVD: ${{ runner.temp }}/avd\n"
        with self.assertRaises(ValueError):
            validate_job_env_contexts(job)
        step = "jobs:\n  proof:\n    steps:\n      - env:\n          AVD: ${{ runner.temp }}/avd\n"
        validate_job_env_contexts(step)


if __name__ == "__main__":
    unittest.main()
