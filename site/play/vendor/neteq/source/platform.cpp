// SPDX-License-Identifier: GPL-3.0-only
// Single-owner WASM platform services. NetEq uses only the supplied clock/trials.
#include "api/environment/environment_factory.h"
#include "rtc_base/checks.h"
namespace webrtc {
namespace {
class NoTaskQueues final : public TaskQueueFactory {
 public:
  std::unique_ptr<TaskQueueBase, TaskQueueDeleter> CreateTaskQueue(
      absl::string_view, Priority) const override { RTC_CHECK_NOTREACHED(); }
};
class NoEventLog final : public RtcEventLog {
 public:
  bool StartLogging(std::unique_ptr<RtcEventLogOutput>, int64_t) override { return false; }
  void StopLogging() override {}
  void Log(std::unique_ptr<RtcEvent>) override {}
};
}
Environment EnvironmentFactory::Create() const {
  RTC_CHECK(field_trials_ && clock_);
  static NoTaskQueues queues;
  static NoEventLog events;
  return Environment(leaf_, field_trials_, clock_, &queues, &events);
}
}
