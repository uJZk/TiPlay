package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test

class BrowserRtcAudioLeaseTest {
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
