// Copyright (c) TiPlay contributors. Licensed under BSD-3-Clause.
// Per-task admission accounting for source-rate video. No rate pacing is done.
#ifndef TIPLAY_SOURCE_RATE_QUEUE_BUDGET_H_
#define TIPLAY_SOURCE_RATE_QUEUE_BUDGET_H_

#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <utility>

namespace tiplay {

struct QueueLimit {
  size_t packets;
  size_t bytes;
};

struct QueueCounts {
  size_t packets = 0;
  size_t bytes = 0;
};

// One transport budget may be shared by all live and retired sender epochs.
struct TransportBudget {
  explicit TransportBudget(QueueLimit value) : limit(value) {}
  const QueueLimit limit;
  std::mutex mutex;
  QueueCounts pending;
};

// One independent instance must be created for each sender epoch and stage.
// Never attach a ticket to an RTP packet that is copied into retransmit history.
class QueueBudget : public std::enable_shared_from_this<QueueBudget> {
 public:
  struct Status {
    uint64_t epoch;
    QueueCounts pending;
    bool overloaded;
    bool retired;
  };

  class Ticket {
   public:
    Ticket(const Ticket&) = delete;
    Ticket& operator=(const Ticket&) = delete;
    ~Ticket() {
      if (armed_) owner_->Release(counts_);
    }

   private:
    friend class QueueBudget;
    Ticket(std::shared_ptr<QueueBudget> owner, QueueCounts counts)
        : owner_(std::move(owner)), counts_(counts) {}
    std::shared_ptr<QueueBudget> owner_;
    QueueCounts counts_;
    bool armed_ = false;
  };

  QueueBudget(uint64_t epoch, QueueLimit limit,
              std::shared_ptr<TransportBudget> transport)
      : epoch_(epoch), limit_(limit), transport_(std::move(transport)) {}

  // A null result is a permanent video failure for this epoch unless retired.
  // Caller must not post a task or allocate a payload copy before admission.
  std::shared_ptr<Ticket> TryAcquire(size_t packets, size_t bytes) {
    std::scoped_lock lock(mutex_, transport_->mutex);
    if (retired_ || overloaded_) return nullptr;
    if (!Fits(pending_, limit_, packets, bytes) ||
        !Fits(transport_->pending, transport_->limit, packets, bytes)) {
      overloaded_ = true;
      return nullptr;
    }
    // Allocate before charging, so allocation failure cannot leak a reservation.
    auto ticket = std::shared_ptr<Ticket>(
        new Ticket(shared_from_this(), QueueCounts{packets, bytes}));
    pending_.packets += packets;
    pending_.bytes += bytes;
    transport_->pending.packets += packets;
    transport_->pending.bytes += bytes;
    ticket->armed_ = true;
    return ticket;
  }

  void Retire() {
    std::lock_guard lock(mutex_);
    retired_ = true;
  }

  Status GetStatus() const {
    std::lock_guard lock(mutex_);
    return {epoch_, pending_, overloaded_, retired_};
  }

 private:
  static bool Fits(QueueCounts value, QueueLimit limit,
                   size_t packets, size_t bytes) {
    return value.packets <= limit.packets && value.bytes <= limit.bytes &&
           packets <= limit.packets - value.packets &&
           bytes <= limit.bytes - value.bytes;
  }

  void Release(QueueCounts counts) {
    std::scoped_lock lock(mutex_, transport_->mutex);
    pending_.packets -= counts.packets;
    pending_.bytes -= counts.bytes;
    transport_->pending.packets -= counts.packets;
    transport_->pending.bytes -= counts.bytes;
  }

  const uint64_t epoch_;
  const QueueLimit limit_;
  const std::shared_ptr<TransportBudget> transport_;
  mutable std::mutex mutex_;
  QueueCounts pending_;
  bool overloaded_ = false;
  bool retired_ = false;
};

}  // namespace tiplay
#endif  // TIPLAY_SOURCE_RATE_QUEUE_BUDGET_H_
