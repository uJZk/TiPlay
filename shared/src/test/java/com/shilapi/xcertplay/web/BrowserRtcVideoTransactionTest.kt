package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test

class BrowserRtcVideoTransactionTest {
    @Test fun exactRetryReplaysOnlyTheLastAnswerAndRejectsChangedTransactionContents() {
        val transaction = BrowserRtcVideoTransaction()
        assertNull(transaction.replay(1, 2, "offer"))
        transaction.save(1, 2, "offer", "answer")
        assertEquals("answer", transaction.replay(1, 2, "offer"))
        assertThrows(IllegalStateException::class.java) { transaction.replay(1, 2, "changed") }
        assertThrows(IllegalStateException::class.java) { transaction.replay(1, 3, "offer") }
        transaction.save(2, 3, "new offer", "new answer")
        assertNull(transaction.replay(1, 2, "offer"))
        assertEquals("new answer", transaction.replay(2, 3, "new offer"))
    }

    @Test fun readyTimeoutDoesNotAbandonTheCommittedSdpOrAcceptAnOlderGeneration() {
        var now = 0L
        val lease = BrowserRtcVideoLease { now }
        lease.pause(); lease.offer(2); lease.answered()
        now = 6_000_000_000L
        assertTrue(lease.readyTimedOut())
        assertFalse(lease.readyTimedOut())
        assertTrue(lease.ready(2)) // Answer/ready was delayed beyond the deadline.
        lease.pause(); lease.offer(3); lease.answered()
        assertFalse(lease.replayAnswered(2))
        assertFalse(lease.ready(2))
        now += 6_000_000_000L
        assertTrue(lease.readyTimedOut())
        assertTrue(lease.replayAnswered(3))
        assertFalse(lease.readyTimedOut())
        assertTrue(lease.ready(3))
    }

    @Test fun sourceReplacementDuringAnOfferDoesNotClaimThatTheNewEpochWasNegotiated() {
        val lease = BrowserRtcVideoLease()
        lease.pause(); lease.offer(2, 10)
        lease.pause() // The producer changed before the old answer/ready completed.
        lease.answered(); assertTrue(lease.ready(2))
        assertFalse(lease.sourceChangedSinceOffer(10))
        assertTrue(lease.sourceChangedSinceOffer(11))
        // A different codec/profile in epoch 11 must use a fresh generation.
        lease.pause(); assertTrue(lease.awaitingOffer)
        lease.offer(3, 11); lease.answered()
        assertFalse(lease.replayAnswered(2)); assertFalse(lease.ready(2))
        assertTrue(lease.ready(3)); assertFalse(lease.sourceChangedSinceOffer(11))
    }
}
