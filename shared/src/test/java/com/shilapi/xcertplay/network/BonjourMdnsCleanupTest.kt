package com.shilapi.xcertplay.network

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test

class BonjourMdnsCleanupTest {
    @Test fun completionCallbacksDoNotConsumeReservedCleanupCapacity() {
        BonjourCleanupPool().use { pool ->
            val callbacksEntered = CountDownLatch(2)
            val releaseCallbacks = CountDownLatch(1)
            val completed = (0 until 2).map { requireNotNull(pool.reserve()) }
            completed.forEach { owner ->
                owner.attach(AutoCloseable {})
                owner.whenComplete { callbacksEntered.countDown(); releaseCallbacks.await() }
                owner.requestClose()
            }
            val replacements = mutableListOf<BonjourCleanupPool.Reservation>()
            try {
                assertTrue(callbacksEntered.await(2, TimeUnit.SECONDS))
                repeat(6) {
                    requireNotNull(pool.reserve()).also { owner ->
                        replacements += owner
                        owner.attach(AutoCloseable {})
                        owner.requestClose()
                    }
                }
            } finally { releaseCallbacks.countDown() }
            replacements.forEach { assertTrue(it.await(2_000)) }
        }
    }

    @Test fun addressOwnershipSurvivesATimedOutCloseAndIsReleasedOnlyAfterCompletion() {
        BonjourCleanupPool().use { pool ->
            val entered = CountDownLatch(1)
            val release = CountDownLatch(1)
            val old = requireNotNull(pool.reserve("receiver:192.0.2.41"))
            old.attach(AutoCloseable { entered.countDown(); release.await() })
            old.requestClose()
            try {
                assertTrue(entered.await(2, TimeUnit.SECONDS))
                assertFalse(old.await(20))
                assertNull(pool.reserve("receiver:192.0.2.41"))
                requireNotNull(pool.reserve("receiver:192.0.2.42")).abandon()
            } finally { release.countDown(); assertTrue(old.await(2_000)) }
            requireNotNull(pool.reserve("receiver:192.0.2.41")).abandon()
        }
    }

    @Test fun aFailedCloseIsNotReportedAsReleasedCapacity() {
        BonjourCleanupPool().use { pool ->
            val failed = requireNotNull(pool.reserve("receiver:192.0.2.43"))
            failed.attach(AutoCloseable { throw java.io.IOException("close failed") })
            failed.requestClose()
            assertFalse(failed.await(2_000))
            assertTrue(failed.complete)
            assertEquals("IOException", failed.failureClass)
            assertNull(pool.reserve("receiver:192.0.2.43"))
            val remaining = (0 until 5).map { requireNotNull(pool.reserve()) }
            assertNull(pool.reserve())
            remaining.forEach { it.abandon() }
        }
    }
    @Test fun capacityIsReservedBeforeCreationAndLateResultsAreStillClosed() {
        val reservations = (0 until 6).map { requireNotNull(BonjourMdnsCleanup.reserve()) }
        assertNull(BonjourMdnsCleanup.reserve())
        val closed = AtomicInteger()
        try {
            reservations.forEach { it.requestClose() }
            reservations.forEach { it.attach(AutoCloseable { closed.incrementAndGet() }) }
            reservations.forEach { assertTrue(it.await(2_000)) }
            assertEquals(6, closed.get())
        } finally { reservations.forEach { it.requestClose() } }
        requireNotNull(BonjourMdnsCleanup.reserve()).abandon()
    }

    @Test fun aBlockedCloserHasABoundedWaitAndDoesNotHideOtherCleanup() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val first = requireNotNull(BonjourMdnsCleanup.reserve())
        val second = requireNotNull(BonjourMdnsCleanup.reserve())
        first.attach(AutoCloseable { entered.countDown(); release.await() })
        second.attach(AutoCloseable {})
        try {
            first.requestClose(); second.requestClose()
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            assertFalse(first.await(20))
            assertTrue(second.await(2_000))
            assertFalse(first.complete)
        } finally { release.countDown(); assertTrue(first.await(2_000)) }
    }

    @Test fun registryCloseCannotRaceAnInFlightRegistration() {
        val owner = requireNotNull(BonjourMdnsCleanup.reserve())
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val closed = CountDownLatch(1)
        owner.attach(AutoCloseable { closed.countDown() })
        val worker = Thread { owner.use { entered.countDown(); release.await() } }
        worker.start()
        try {
            assertTrue(entered.await(2, TimeUnit.SECONDS)); owner.requestClose()
            assertFalse(closed.await(20, TimeUnit.MILLISECONDS))
        } finally { release.countDown(); worker.join(2_000) }
        assertTrue(owner.await(2_000)); assertEquals(0L, closed.count)
    }
}
