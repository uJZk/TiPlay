package com.shilapi.xcertplay.web

/** Binds native queue status to the sender and bridge for one application generation. */
internal class BrowserRtcSourceRateGuard {
    private var generation = 0
    private var sender: Any? = null
    private var bridge: Any? = null
    private var epoch = 0L
    private var pendingSinceNanos = 0L

    fun inspect(generation: Int, sender: Any, bridge: Any, nativeEpoch: Long,
                failedEpoch: Long, nowNanos: Long = System.nanoTime()): String? {
        if (this.generation != generation || this.sender !== sender || this.bridge !== bridge) {
            this.generation = generation
            this.sender = sender
            this.bridge = bridge
            epoch = 0L
            pendingSinceNanos = nowNanos
        }
        if (nativeEpoch <= 0L) {
            if (failedEpoch != 0L) return "video-source-rate-status-mismatch"
            return if (nowNanos - pendingSinceNanos >= 6_000_000_000L)
                "video-source-rate-epoch-unavailable" else "video-source-rate-epoch-pending"
        }
        if (epoch != 0L && epoch != nativeEpoch) return "video-source-rate-epoch-changed"
        epoch = nativeEpoch
        if (failedEpoch != 0L && failedEpoch != epoch) return "video-source-rate-status-mismatch"
        if (failedEpoch == epoch) return "video-source-rate-send-failed"
        return null
    }
}

/** A single replacement attempt per peer; a persistent overload terminates video. */
/** The announced configuration survives source END until its offer is claimed. */
internal class BrowserRtcPendingVideoSource<T : Any> {
    private var current: T? = null
    private var announced: T? = null
    @Synchronized fun current(): T? = current
    @Synchronized fun update(next: T?) { current = next }
    @Synchronized fun pause(next: T?, shouldAnnounce: () -> Boolean): Boolean {
        current = next
        val announce = shouldAnnounce()
        if (announce) announced = requireNotNull(next)
        return announce
    }
    @Synchronized fun claim(accept: (T) -> Unit): Boolean {
        val snapshot = current ?: announced ?: return false
        accept(snapshot)
        announced = null
        return true
    }
}

internal class BrowserRtcSourceRateRecovery {
    private var attempted = false
    companion object {
        fun sourceTransition(config: Boolean, idle: Boolean, end: Boolean,
                             currentEpoch: Int?, nextEpoch: Int, reason: String?): Boolean =
            idle || config && currentEpoch != null && currentEpoch != nextEpoch ||
                end && (reason == "source-ended" || reason == "source-changed")
    }
    fun shouldRetry(reason: String, hasCurrentConfig: Boolean): Boolean {
        if (attempted || reason != "video-source-rate-send-failed" || !hasCurrentConfig) return false
        attempted = true
        return true
    }
}
