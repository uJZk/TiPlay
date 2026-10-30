package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test

/** Exercises the real candidate state objects together, not the browser or Android peer. */
class BrowserRtcRecoverySequenceTest {
    private data class Config(val epoch: Int)

    private fun runSequence(endBeforeOffer: Boolean) {
        var now = 0L
        val lease = BrowserRtcVideoLease { now }
        val source = BrowserRtcPendingVideoSource<Config>()
        val old = Config(10)
        val next = Config(11)
        source.update(old)

        // The native failure pauses the current sender and announces its config.
        assertTrue(source.pause(old) {
            lease.pause()
            lease.awaitingOffer
        })
        if (endBeforeOffer) assertFalse(source.pause(null) { lease.pause(); false })

        // The browser's next offer claims the announced snapshot, even if END
        // has already made the source idle.
        assertTrue(source.claim { snapshot -> lease.offer(2, snapshot.epoch) })
        if (!endBeforeOffer) assertFalse(source.pause(null) { lease.pause(); false })
        assertNull(source.current())
        lease.answered()
        assertTrue(lease.ready(2))
        assertTrue(lease.sourceChangedSinceOffer(next.epoch))

        // A delayed new CONFIG must remain available for the active generation.
        source.update(next)
        assertEquals(next, source.current())
        assertFalse(lease.ready(1))
        assertTrue(lease.ready)
        now += 7_000_000_000L
        assertNull(lease.readyTimeoutGeneration())
    }

    @Test fun endBeforeOfferAndLateNextConfig() = runSequence(true)
    @Test fun endAfterOfferAndLateNextConfig() = runSequence(false)
}
