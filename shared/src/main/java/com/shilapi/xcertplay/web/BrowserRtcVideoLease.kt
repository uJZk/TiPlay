package com.shilapi.xcertplay.web

/** Video-only replacement barrier. Audio and DataChannel ownership never change with this lease. */
internal class BrowserRtcVideoLease(private val nowNanos: () -> Long = System::nanoTime) {
    @Volatile var generation = 1; private set
    @Volatile var ready = true; private set
    @Volatile var awaitingOffer = false; private set
    private var awaitingReadySince: Long? = null
    private var negotiating = false

    @Synchronized fun pause() { ready = false; if (!negotiating && awaitingReadySince == null) awaitingOffer = true }

    @Synchronized fun offer(next: Int) {
        check(awaitingOffer && !negotiating && awaitingReadySince == null && generation < Int.MAX_VALUE && next == generation + 1) { "video-generation" }
        generation = next; ready = false; awaitingOffer = false; negotiating = true
    }

    @Synchronized fun answered() { check(negotiating); negotiating = false; awaitingReadySince = nowNanos() }

    @Synchronized fun ready(next: Int): Boolean {
        if (next != generation || awaitingReadySince == null) return false
        awaitingReadySince = null; awaitingOffer = false; ready = true
        return true
    }

    @Synchronized fun readyTimedOut(): Boolean = awaitingReadySince?.let { nowNanos() - it >= 6_000_000_000L } == true
}
