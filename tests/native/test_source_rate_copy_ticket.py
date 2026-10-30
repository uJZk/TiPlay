"""Exercise the actual experimental RTP ticket's copy and move semantics."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class SourceRateTicketTest(unittest.TestCase):
    def test_sender_snapshot_keeps_epoch_and_failure_together(self):
        root = Path(__file__).resolve().parents[2]
        patch = (root / "scripts/webrtc/source-rate-queue-experiment.patch").read_text()
        start = patch.index("diff --git a/api/call/tiplay_source_rate_queue_budget.h ")
        end = patch.index("\ndiff --git ", start + 1)
        header = "\n".join(line[1:] for line in patch[start:end].splitlines()
                           if line.startswith("+") and not line.startswith("+++"))
        added = "\n".join(line[1:] for line in patch.splitlines()
                          if line.startswith("+") and not line.startswith("+++"))
        start = added.index("TiPlaySourceRateStatus VideoRtpSender::GetTiPlaySourceRateStatus() const {")
        end = added.index("\n}", start) + 2
        source = '''#include "budget.h"
#include <cassert>
#include <memory>
#define RTC_DCHECK_RUN_ON(x) ((void)0)
struct TiPlaySourceRateStatus { uint64_t epoch = 0; uint64_t failure_epoch = 0; };
struct VideoRtpSender {
  std::shared_ptr<tiplay::SourceRateEpoch> tiplay_epoch_;
  TiPlaySourceRateStatus GetTiPlaySourceRateStatus() const;
};
''' + added[start:end] + '''
int main() {
  auto transport = std::make_shared<tiplay::SourceRateTransport>(tiplay::QueueLimit{1, 16});
  VideoRtpSender sender;
  assert(sender.GetTiPlaySourceRateStatus().epoch == 0);
  sender.tiplay_epoch_ = std::make_shared<tiplay::SourceRateEpoch>(11, transport);
  auto initial = sender.GetTiPlaySourceRateStatus();
  assert(initial.epoch == 11 && initial.failure_epoch == 0);
  sender.tiplay_epoch_->network->Fail();
  auto failed = sender.GetTiPlaySourceRateStatus();
  assert(failed.epoch == 11 && failed.failure_epoch == 11);
  sender.tiplay_epoch_->Retire();
  sender.tiplay_epoch_ = std::make_shared<tiplay::SourceRateEpoch>(12, transport);
  auto replacement = sender.GetTiPlaySourceRateStatus();
  assert(replacement.epoch == 12 && replacement.failure_epoch == 0);
  sender.tiplay_epoch_->pacer->Fail();
  auto pacer_failed = sender.GetTiPlaySourceRateStatus();
  assert(pacer_failed.epoch == 12 && pacer_failed.failure_epoch == 12);
}
'''
        with tempfile.TemporaryDirectory(prefix="tiplay-sender-snapshot-test-") as directory:
            directory = Path(directory)
            (directory / "budget.h").write_text(header)
            (directory / "test.cc").write_text(source)
            binary = directory / "test"
            subprocess.run([os.environ.get("CXX", "g++"), "-std=c++17", "-Wall",
                            "-Wextra", "-Werror", "-pthread", str(directory / "test.cc"),
                            "-o", str(binary)], check=True)
            subprocess.run([str(binary)], check=True)

    def test_epoch_has_independent_pacer_and_network_reservations(self):
        root = Path(__file__).resolve().parents[2]
        patch = (root / "scripts/webrtc/source-rate-queue-experiment.patch").read_text()
        start = patch.index("diff --git a/api/call/tiplay_source_rate_queue_budget.h ")
        end = patch.index("\ndiff --git ", start + 1)
        header = "\n".join(line[1:] for line in patch[start:end].splitlines()
                           if line.startswith("+") and not line.startswith("+++"))
        source = """#include \"budget.h\"
#include <cassert>
#include <memory>
int main() {
  auto total = std::make_shared<tiplay::SourceRateTransport>(tiplay::QueueLimit{1, 16});
  tiplay::SourceRateEpoch epoch(11, total);
  auto pacer = epoch.pacer->TryAcquire(1, 12);
  auto network = epoch.network->TryAcquire(1, 12);
  assert(pacer && network);
  assert(!epoch.network->TryAcquire(1, 1));
  assert(epoch.network->GetStatus().overloaded);
  assert(!epoch.pacer->GetStatus().overloaded);
  epoch.Retire();
  tiplay::SourceRateEpoch next(12, total);
  assert(!next.pacer->TryAcquire(1, 1));  // Retired work still uses capacity.
  pacer.reset();
  network.reset();
  assert(epoch.pacer->GetStatus().pending.bytes == 0);
  assert(epoch.network->GetStatus().pending.bytes == 0);
}
"""
        with tempfile.TemporaryDirectory(prefix="tiplay-epoch-test-") as directory:
            directory = Path(directory)
            (directory / "budget.h").write_text(header)
            (directory / "test.cc").write_text(source)
            binary = directory / "test"
            subprocess.run([os.environ.get("CXX", "g++"), "-std=c++17", "-Wall",
                            "-Wextra", "-Werror", "-pthread", str(directory / "test.cc"),
                            "-o", str(binary)], check=True)
            subprocess.run([str(binary)], check=True)

    def test_history_copy_does_not_keep_a_reservation(self):
        root = Path(__file__).resolve().parents[2]
        patch = (root / "scripts/webrtc/source-rate-queue-experiment.patch").read_text()
        added = "\n".join(line[1:] for line in patch.splitlines()
                          if line.startswith("+") and not line.startswith("+++"))
        start = added.index("class TiPlayNonCopyingTicket {")
        end = added.index("\n};", start) + len("\n};")
        source = """#include <cassert>
#include <memory>
#include <utility>
""" + added[start:end] + """
int main() {
  auto reservation = std::make_shared<int>(42);
  std::weak_ptr<int> weak = reservation;
  TiPlayNonCopyingTicket original;
  original.set(reservation);
  reservation.reset();
  TiPlayNonCopyingTicket history(original);
  original = original;
  assert(!weak.expired());
  TiPlayNonCopyingTicket moved(std::move(original));
  assert(!weak.expired());
  moved = history;
  assert(weak.expired());

  auto old = std::make_shared<int>(1);
  auto current = std::make_shared<int>(2);
  std::weak_ptr<int> old_weak = old;
  std::weak_ptr<int> current_weak = current;
  TiPlayNonCopyingTicket a, b;
  a.set(old);
  b.set(current);
  old.reset();
  current.reset();
  a = std::move(b);
  assert(old_weak.expired());
  assert(!current_weak.expired());
  a = history;
  assert(current_weak.expired());
}
"""
        with tempfile.TemporaryDirectory(prefix="tiplay-ticket-test-") as directory:
            source_path = Path(directory) / "test.cc"
            binary_path = Path(directory) / "test"
            source_path.write_text(source)
            subprocess.run([os.environ.get("CXX", "g++"), "-std=c++17", "-Wall",
                            "-Wextra", "-Werror", str(source_path), "-o", str(binary_path)],
                           check=True)
            subprocess.run([str(binary_path)], check=True)


if __name__ == "__main__":
    unittest.main()
