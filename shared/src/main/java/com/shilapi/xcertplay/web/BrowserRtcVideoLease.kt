package com.shilapi.xcertplay.web

/** Video-only replacement barrier. Audio and DataChannel ownership never change with this lease. */
internal class BrowserRtcVideoLease(private val nowNanos: () -> Long = System::nanoTime) {
    @Volatile var generation = 1; private set
    @Volatile var ready = true; private set
    @Volatile var awaitingOffer = false; private set
    private var awaitingReadySince: Long? = null
    private var negotiating = false
    private var timeoutReported = false
    private var offeredSourceEpoch: Int? = null

    @Synchronized fun pause() { ready = false; if (!negotiating && awaitingReadySince == null) awaitingOffer = true }

    @Synchronized fun offer(next: Int, sourceEpoch: Int? = null) {
        check(awaitingOffer && !negotiating && awaitingReadySince == null && generation < Int.MAX_VALUE && next == generation + 1) { "video-generation" }
        generation = next; ready = false; awaitingOffer = false; negotiating = true
        offeredSourceEpoch = sourceEpoch
    }

    @Synchronized fun sourceChangedSinceOffer(epoch: Int): Boolean = offeredSourceEpoch?.let { it != epoch } == true

    @Synchronized fun answered() { check(negotiating); negotiating = false; awaitingReadySince = nowNanos(); timeoutReported = false }

    /** Replaying an answer may resume this barrier, never a newer generation or a ready stream. */
    @Synchronized fun replayAnswered(next: Int): Boolean {
        if (next != generation || negotiating) return false
        if (awaitingReadySince != null) { awaitingReadySince = nowNanos(); timeoutReported = false }
        return true
    }

    @Synchronized fun ready(next: Int): Boolean {
        if (next != generation || awaitingReadySince == null) return false
        awaitingReadySince = null; awaitingOffer = false; ready = true
        return true
    }

    @Synchronized fun readyTimedOut(): Boolean {
        if (timeoutReported || awaitingReadySince?.let { nowNanos() - it >= 6_000_000_000L } != true) return false
        timeoutReported = true
        // Keep accepting this exact generation's late ready. The SDP has already
        // committed, and a signaling delay must not permanently retire the writer.
        return true
    }

    @Synchronized fun readyTimeoutGeneration(): Int? = if (readyTimedOut()) generation else null
}
