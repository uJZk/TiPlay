package com.shilapi.xcertplay.transport

import org.junit.Assert.*
import org.junit.Test

class WirelessStartSessionRequestTest {
    @Test fun availabilityWaitsThroughAirPlayAndResumesOnceWithoutAnotherPhoneNotification() {
        var now = 0L
        var held = false
        var validations = 0
        var writes = 0
        val deadline = WirelessControlDeadline(1_000) { now }
        val start = WirelessStartSessionRequest({ !held }, { validations++ }, {
            deadline.requireRemaining()
            writes++
        })
        // Bluetooth identification/authentication has completed, then AirPlay starts before
        // the availability reply is admitted. Repeated notifications remain one pending reply.
        now = 400_000_000L
        held = true
        deadline.setSuspended(true)
        start.request()
        repeat(3) {
            start.request()
            now += 60 * 60 * 1_000_000_000L
            deadline.setSuspended(true)
            assertFalse(start.dispatch())
            assertEquals(600L, deadline.requireRemaining())
        }
        assertEquals(0, validations)
        assertEquals(0, writes)

        held = false
        deadline.setSuspended(false)
        assertTrue(start.dispatch())
        assertEquals(600L, deadline.requireRemaining())
        repeat(3) { assertFalse(start.dispatch()) }
        assertEquals(1, validations)
        assertEquals(1, writes)
    }

    @Test fun aLeaseBeginningAfterAvailabilityAndDuringHotspotValidationStillBlocksTheWrite() {
        var held = false
        var firstValidation = true
        var writes = 0
        val start = WirelessStartSessionRequest({ !held }, {
            if (firstValidation) { firstValidation = false; held = true }
        }, { writes++ })
        start.request()
        assertFalse(start.dispatch())
        assertEquals(0, writes)
        held = false
        assertTrue(start.dispatch())
        assertFalse(start.dispatch())
        assertEquals(1, writes)
    }

    @Test fun failedAdmissionAndWritesNeverReportASuccessfulStart() {
        var failAdmission = true
        var failWrite = true
        var successfulWrites = 0
        val start = WirelessStartSessionRequest({
            if (failAdmission) throw IllegalStateException("lease unavailable")
            true
        }, {}, {
            if (failWrite) throw java.io.IOException("channel ended")
            successfulWrites++
        })
        start.request()
        assertThrows(IllegalStateException::class.java) { start.dispatch() }
        assertEquals(0, successfulWrites)
        failAdmission = false
        assertThrows(java.io.IOException::class.java) { start.dispatch() }
        assertEquals(0, successfulWrites)
        failWrite = false
        assertTrue(start.dispatch())
        assertFalse(start.dispatch())
        assertEquals(1, successfulWrites)
    }

    @Test fun aRetiredTransportCannotSendItsPendingReplyWhenTheLeaseEnds() {
        var held = true
        var closed = false
        var writes = 0
        val start = WirelessStartSessionRequest({ !closed && !held }, {}, { writes++ })
        start.request()
        assertFalse(start.dispatch())
        closed = true
        held = false
        assertFalse(start.dispatch())
        assertEquals(0, writes)
    }
}
