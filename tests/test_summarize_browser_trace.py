import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("trace_summary", Path(__file__).resolve().parents[1] / "scripts/summarize_browser_trace.py")
trace_summary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trace_summary)


class TraceSummaryTest(unittest.TestCase):
    def fixture(self, include_cpu=True):
        events = [{"name": "capture-window-start", "ts": 100}, {"name": "capture-window-end", "ts": 1100},
                  {"name": "thread_name", "ph": "M", "pid": 1, "tid": 2, "args": {"name": "test"}}]
        for start, duration, cpu in [(200, 100, 50), (210, 20, 15), (400, 100, 40), (50, 80, 50)]:
            event = {"name": "task", "cat": "toplevel", "ph": "X", "pid": 1, "tid": 2,
                     "ts": start, "dur": duration}
            if include_cpu:
                event["tdur"] = cpu
            events.append(event)
        return events

    def test_nested_events_and_outside_tasks_do_not_inflate_cpu(self):
        result = trace_summary.summarize(self.fixture())
        self.assertEqual(result["windowMs"], 1)
        self.assertEqual(result["threads"][0]["events"], 2)
        self.assertEqual(result["threads"][0]["threadCpuMs"], .09)
        self.assertEqual(result["threads"][0]["oneCoreCpuPercent"], 9)

    def test_missing_thread_cpu_is_unknown_instead_of_zero(self):
        result = trace_summary.summarize(self.fixture(False))
        self.assertIsNone(result["threads"][0]["threadCpuMs"])
        self.assertIsNone(result["threads"][0]["oneCoreCpuPercentBounds"])

    def test_partial_thread_time_has_a_bound_without_inventing_missing_cpu(self):
        events = self.fixture()
        del events[5]["tdur"]
        result = trace_summary.summarize(events)["threads"][0]
        self.assertIsNone(result["threadCpuMs"])
        self.assertEqual(result["oneCoreCpuPercentBounds"], [5, 15])

    def test_unmarked_trace_cannot_claim_a_measurement_interval(self):
        with self.assertRaisesRegex(ValueError, "window"):
            trace_summary.summarize([])


if __name__ == "__main__":
    unittest.main()
