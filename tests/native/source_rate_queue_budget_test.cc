#include "../../scripts/webrtc/source_rate_queue_budget.h"

#include <atomic>
#include <cassert>
#include <cstddef>
#include <limits>
#include <memory>
#include <thread>
#include <vector>

using tiplay::QueueBudget;
using tiplay::QueueLimit;
using tiplay::TransportBudget;

int main() {
  auto total = std::make_shared<TransportBudget>(QueueLimit{4, 100});
  auto first = std::make_shared<QueueBudget>(1, QueueLimit{3, 80}, total);
  auto ticket = first->TryAcquire(2, 60);
  assert(ticket && first->GetStatus().pending.bytes == 60);
  auto copy = ticket;
  ticket.reset();
  assert(first->GetStatus().pending.packets == 2);
  first->Retire();
  auto second = std::make_shared<QueueBudget>(2, QueueLimit{4, 100}, total);
  assert(!second->TryAcquire(3, 50));  // Old epoch still consumes transport.
  assert(second->GetStatus().overloaded);
  copy.reset();
  assert(first->GetStatus().pending.packets == 0);
  assert(first->GetStatus().retired && !first->TryAcquire(1, 1));

  auto third = std::make_shared<QueueBudget>(3, QueueLimit{4, 100}, total);
  assert(!third->TryAcquire(1, std::numeric_limits<size_t>::max()));
  assert(third->GetStatus().overloaded);
  assert(!third->TryAcquire(1, 1));  // Failure is latched per epoch.

  auto fourth = std::make_shared<QueueBudget>(4, QueueLimit{4, 100}, total);
  constexpr int kThreads = 12;
  std::vector<std::thread> threads;
  for (int i = 0; i < kThreads; ++i) {
    threads.emplace_back([fourth] {
      for (int j = 0; j < 10000; ++j) {
        auto token = fourth->TryAcquire(1, 1);
        if (!token) break;
      }
    });
  }
  for (auto& thread : threads) thread.join();
  assert(fourth->GetStatus().pending.packets == 0);
  assert(fourth->GetStatus().pending.bytes == 0);
  assert(total->pending.packets == 0 && total->pending.bytes == 0);

  // Hold successful reservations until every contender has tried admission.
  auto fifth = std::make_shared<QueueBudget>(5, QueueLimit{4, 100}, total);
  std::atomic<int> ready{0};
  std::atomic<int> attempted{0};
  std::atomic<int> admitted{0};
  threads.clear();
  for (int i = 0; i < kThreads; ++i) {
    threads.emplace_back([&] {
      ++ready;
      while (ready.load() != kThreads) std::this_thread::yield();
      auto token = fifth->TryAcquire(1, 1);
      if (token) ++admitted;
      ++attempted;
      while (attempted.load() != kThreads) std::this_thread::yield();
    });
  }
  for (auto& thread : threads) thread.join();
  assert(admitted == 4 && fifth->GetStatus().overloaded);
  assert(fifth->GetStatus().pending.packets == 0);
}
