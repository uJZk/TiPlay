package com.shilapi.xcertplay.media

import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

/** Ownership protocol only: the payload labels do not assert Bluetooth identity or platform admission. */
class MicrophoneCaptureLeaseTest {
    @Test fun revokingAnUnclaimedOfferDoesNotLeaveACaptureRetiring() {
        val lease = MicrophoneCaptureLease<String>()
        val offered = lease.offer("input-A")
        assertFalse(lease.current(offered))
        assertFalse(lease.retiring())

        lease.revoke()

        assertNull(lease.claim())
        assertFalse(lease.current(offered))
        assertFalse(lease.retiring())
    }

    @Test fun onlyTheClaimedGrantCanAcknowledgeItsCapture() {
        val lease = MicrophoneCaptureLease<String>()
        val offered = lease.offer("input-A")
        val samePayloadButDifferentGrant = MicrophoneCaptureLease.Grant("input-A")
        assertSame(offered, lease.claim())
        assertTrue(lease.current(offered))
        assertTrue(lease.retiring())
        assertNull(lease.claim())

        lease.finish(samePayloadButDifferentGrant)

        assertTrue(lease.current(offered))
        assertTrue(lease.retiring())
        assertNull(lease.claim())
        lease.finish(offered)
        assertFalse(lease.current(offered))
        assertFalse(lease.retiring())
    }

    @Test fun aReplacementWaitsForTheRevokedCaptureToAcknowledge() {
        val lease = MicrophoneCaptureLease<String>()
        val old = lease.offer("input-A")
        assertSame(old, lease.claim())

        lease.revoke()
        val replacement = lease.offer("input-B")

        assertFalse(lease.current(old))
        assertFalse(lease.current(replacement))
        assertTrue(lease.retiring())
        assertNull(lease.claim())
        lease.finish(old)
        assertFalse(lease.retiring())
        assertSame(replacement, lease.claim())
        assertTrue(lease.current(replacement))
        lease.revoke()
        lease.finish(replacement)
    }

    @Test fun aLateOldAcknowledgementCannotReleaseTheReplacementClaim() {
        val lease = MicrophoneCaptureLease<String>()
        val old = lease.offer("input-A")
        assertSame(old, lease.claim())
        lease.revoke()
        val replacement = lease.offer("input-B")
        lease.finish(old)
        assertSame(replacement, lease.claim())

        lease.finish(old)

        assertTrue(lease.current(replacement))
        assertTrue(lease.retiring())
        assertNull(lease.claim())
        lease.revoke()
        assertFalse(lease.current(replacement))
        assertTrue(lease.retiring())
        lease.finish(replacement)
        assertFalse(lease.retiring())
    }

    @Test fun anEarlyReturnAfterRevocationStillAcknowledgesTheClaim() {
        val lease = MicrophoneCaptureLease<String>()
        lease.offer("input-A")
        val claimed = CountDownLatch(1)
        val continueCapture = CountDownLatch(1)
        fun captureOnce(): Boolean {
            val grant = checkNotNull(lease.claim())
            try {
                claimed.countDown()
                assertTrue(continueCapture.await(3, TimeUnit.SECONDS))
                if (!lease.current(grant)) return false
                return true
            } finally {
                lease.finish(grant)
            }
        }
        val result = FutureTask<Boolean> { captureOnce() }
        val worker = Thread(result, "capture-lease-early-return").apply { isDaemon = true; start() }
        try {
            assertTrue(claimed.await(3, TimeUnit.SECONDS))
            lease.revoke()
            assertTrue(lease.retiring())
            continueCapture.countDown()

            assertFalse(result.get(3, TimeUnit.SECONDS))
            assertFalse(lease.retiring())
            assertNull(lease.claim())
        } finally {
            continueCapture.countDown()
            worker.join(1000)
        }
    }

    @Test fun aConcurrentOldWorkerCannotAcknowledgeTheNewWorkersClaim() {
        val lease = MicrophoneCaptureLease<String>()
        lease.offer("input-A")
        val claimed = CountDownLatch(1)
        val finishOld = CountDownLatch(1)
        val oldAcknowledged = CountDownLatch(1)
        val deliverLateAcknowledgement = CountDownLatch(1)
        val result = FutureTask<Unit> {
            val grant = checkNotNull(lease.claim())
            try {
                claimed.countDown()
                assertTrue(finishOld.await(3, TimeUnit.SECONDS))
            } finally {
                lease.finish(grant)
                oldAcknowledged.countDown()
            }
            assertTrue(deliverLateAcknowledgement.await(3, TimeUnit.SECONDS))
            lease.finish(grant)
        }
        val worker = Thread(result, "capture-lease-old-ack").apply { isDaemon = true; start() }
        var replacement: MicrophoneCaptureLease.Grant<String>? = null
        try {
            assertTrue(claimed.await(3, TimeUnit.SECONDS))
            lease.revoke()
            val next = lease.offer("input-B").also { replacement = it }
            assertNull(lease.claim())
            assertTrue(lease.retiring())
            finishOld.countDown()
            assertTrue(oldAcknowledged.await(3, TimeUnit.SECONDS))
            assertSame(next, lease.claim())

            deliverLateAcknowledgement.countDown()
            result.get(3, TimeUnit.SECONDS)

            assertTrue(lease.current(next))
            assertTrue(lease.retiring())
            assertNull(lease.claim())
        } finally {
            finishOld.countDown()
            deliverLateAcknowledgement.countDown()
            worker.join(1000)
            lease.revoke()
            replacement?.let(lease::finish)
        }
    }
}
