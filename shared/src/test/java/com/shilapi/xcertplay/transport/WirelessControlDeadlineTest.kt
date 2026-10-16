package com.shilapi.xcertplay.transport

import org.junit.Assert.*
import org.junit.Test

class WirelessControlDeadlineTest {
    @Test fun bringUpRemainsBoundedEvenIfTheCallerHasAValidSessionProof() {
        var now = 0L
        val deadline = WirelessControlDeadline(1_000) { now }
        assertEquals(1_000L, deadline.requireRemaining())
        now = 1_000_000_000L
        assertThrows(IphoneUsbException.TimedOut::class.java) { deadline.requireRemaining() }
        // Identification/MFi use the no-predicate form; only the subsequent loop can opt in.
        assertEquals(300_000L, deadline.requireRemaining { true })
    }

    @Test fun aLiveSessionKeepsControlUpdatesAfterTheOriginalDeadlineButEndsWhenProofIsWithdrawn() {
        var now = 0L
        var live = true
        val deadline = WirelessControlDeadline(300_000) { now }
        now = 300_000_000_000L
        assertEquals(300_000L, deadline.remainingMillis { live })
        now += 24 * 60 * 60 * 1_000_000_000L
        assertEquals(300_000L, deadline.requireRemaining { live })
        live = false
        assertEquals(0L, deadline.remainingMillis { live })
    }

    @Test fun anUnprovenSessionTimesOutWithoutExtendingTheDeadline() {
        var now = 0L
        var checks = 0
        val deadline = WirelessControlDeadline(1_000) { now }
        val absent = { checks++; false }
        assertEquals(1_000L, deadline.remainingMillis(absent))
        assertEquals(0, checks)
        now = 1_000_000_000L
        assertEquals(0L, deadline.remainingMillis(absent))
        assertEquals(1, checks)
    }

    @Test fun explicitTunnelNoTimeoutStillUsesBoundedReceivePolls() {
        val deadline = WirelessControlDeadline(Iap2WirelessControlClient.NO_TIMEOUT_MILLIS) { 0L }
        assertEquals(300_000L, deadline.requireRemaining())
        assertEquals(300_000L, deadline.remainingMillis { false })
    }

    @Test fun aDisplayLeaseExcludesOnlyItsOwnWaitFromTheAuthenticatedDeadline() {
        var now = 0L
        val deadline = WirelessControlDeadline(1_000) { now }
        now = 200_000_000L
        deadline.setSuspended(true)
        now += 8 * 60 * 60 * 1_000_000_000L
        assertEquals(800L, deadline.requireRemaining())
        deadline.setSuspended(true) // A poll must not restart the suspension interval.
        now += 8 * 60 * 60 * 1_000_000_000L
        deadline.setSuspended(false)
        assertEquals(800L, deadline.requireRemaining())
        now += 300_000_000L
        assertEquals(500L, deadline.requireRemaining())
        deadline.setSuspended(true)
        now += 60 * 1_000_000_000L
        deadline.setSuspended(false)
        now += 500_000_000L
        assertThrows(IphoneUsbException.TimedOut::class.java) { deadline.requireRemaining() }
    }

    @Test fun suspendingAfterADeadlineAlreadyExpiredDoesNotReviveIt() {
        var now = 0L
        val deadline = WirelessControlDeadline(1_000) { now }
        now = 1_000_000_000L
        deadline.setSuspended(true)
        now += 60 * 1_000_000_000L
        assertEquals(0L, deadline.remainingMillis())
        deadline.setSuspended(false)
        assertEquals(0L, deadline.remainingMillis())
    }
}
