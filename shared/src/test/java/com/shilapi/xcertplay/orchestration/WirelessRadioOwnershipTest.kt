package com.shilapi.xcertplay.orchestration

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class WirelessRadioOwnershipTest {
    @Test fun failedCleanupCannotBecomeSuccessfulJustBecauseItsWorkerReturned() {
        val lease = WirelessRadioOwnership.Lease()
        lease.runFinished(); lease.cleanupFailed(); lease.cleanupFinished()
        assertTrue(lease.failed)
        assertFalse(lease.await(20))
    }
    @Test fun timeoutDoesNotPermitAnotherControllerToReclaimARadioWithLateStartup() {
        val first = requireNotNull(WirelessRadioOwnership.acquire())
        val cleanup = CountDownLatch(1)
        try {
            first.startCleanup { first.cleanupFinished(); cleanup.countDown() }
            assertTrue(cleanup.await(2, TimeUnit.SECONDS))
            assertFalse(first.await(20))
            assertNull(WirelessRadioOwnership.acquire())
            first.runFinished()
            assertTrue(first.await(2_000))
            val replacement = requireNotNull(WirelessRadioOwnership.acquire())
            replacement.runFinished(); replacement.cleanupFinished()
        } finally { first.runFinished(); first.cleanupFinished() }
    }
    @Test fun cleanupStillOwnsTheRadioAfterTheOldRunHasExited() {
        val first = requireNotNull(WirelessRadioOwnership.acquire())
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        first.runFinished()
        first.startCleanup { entered.countDown(); release.await(); first.cleanupFinished() }
        try {
            assertTrue(entered.await(2, TimeUnit.SECONDS)); assertFalse(first.await(20))
            assertNull(WirelessRadioOwnership.acquire())
        } finally { release.countDown(); assertTrue(first.await(2_000)) }
        val replacement = requireNotNull(WirelessRadioOwnership.acquire())
        replacement.runFinished(); replacement.cleanupFinished()
    }
}
