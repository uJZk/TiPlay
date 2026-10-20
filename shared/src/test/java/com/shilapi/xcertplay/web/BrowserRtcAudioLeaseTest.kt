package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test

class BrowserRtcAudioLeaseTest {
    @Test fun reliableAudioOverflowIsTerminalForTheCurrentConsumerInsteadOfResubscribing() {
        val state = BrowserRtcAudioLease()
        state.request(true, 1)
        val lease = state.current()!!
        val hub = WebAudioHub { 0L }; val owner = Any(); hub.begin(owner)
        val subscription = hub.subscribe(reliable = true)
        assertNull(state.terminalReason(lease, subscription))
        repeat(WebAudioHub.MAX_RELIABLE_PACKETS + 1) {
            hub.publish(owner, 0, 48000, 1, byteArrayOf(it.toByte(), 0), buffered = true)
        }
        assertTrue(subscription.closed)
        assertNull(subscription.take(0))
        assertEquals("reliable-overload", state.terminalReason(lease, subscription))
        // The peer uses this terminal decision before its outer loop can subscribe again.
        assertTrue(state.owns(lease))
    }

    @Test fun retiringAnAudioConsumerDoesNotFailItsReplacementWhenTheOldJournalCloses() {
        val state = BrowserRtcAudioLease()
        state.request(true, 1)
        val old = state.current()!!
        val hub = WebAudioHub(); val subscription = hub.subscribe(reliable = true)
        assertTrue(state.request(false, 1))
        assertTrue(state.request(true, 2))
        val fresh = state.current()!!
        subscription.close()
        assertNull(state.terminalReason(old, subscription))
        assertTrue(state.owns(fresh))
        val replacement = hub.subscribe(reliable = true)
        assertNull(state.terminalReason(fresh, replacement))
        replacement.close()
    }

    @Test fun replacementRetiresOldConsumerAndDelayedCancelCannotRetireNewConsumer() {
        val state = BrowserRtcAudioLease()
        assertTrue(state.request(true, 1))
        val old = state.current()!!
        assertTrue(state.request(true, 2))
        val fresh = state.current()!!
        assertFalse(state.owns(old))
        assertTrue(state.owns(fresh))
        assertFalse(state.request(false, 1))
        assertFalse(state.request(true, 1))
        assertTrue(state.owns(fresh))
        assertTrue(state.request(false, 2))
        assertNull(state.current())
        assertFalse(state.owns(fresh))
        // Reusing a generation cannot replay an old barrier into a new reader.
        assertFalse(state.request(true, 2))
        assertNull(state.current())
        assertTrue(state.request(true, 3))
        assertFalse(state.owns(fresh))
    }

    @Test fun unsignedGenerationWrapDoesNotAllowStaleRequestsToReviveAnOldConsumer() {
        val state = BrowserRtcAudioLease()
        assertTrue(state.request(true, -1))
        val old = state.current()!!
        assertTrue(state.request(true, 1))
        val fresh = state.current()!!
        assertFalse(state.request(true, -1))
        assertFalse(state.request(false, -1))
        assertFalse(state.owns(old))
        assertTrue(state.owns(fresh))
    }
}
