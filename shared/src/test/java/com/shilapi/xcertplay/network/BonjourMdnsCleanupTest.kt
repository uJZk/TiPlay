package com.shilapi.xcertplay.network

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BonjourMdnsCleanupTest {
    @Test fun independentClosersStartTogetherAndAllFinishBeforeReturnEvenWhenInterrupted() {
        val entered = CountDownLatch(2)
        val releaseFirst = CountDownLatch(1)
        val releaseSecond = CountDownLatch(1)
        val firstFinished = CountDownLatch(1)
        val returned = CountDownLatch(1)
        val interruptRestored = AtomicBoolean()
        val caller = Thread {
            try {
                BonjourMdnsCleanup.closeAll(listOf(
                    AutoCloseable { entered.countDown(); releaseFirst.await(); firstFinished.countDown() },
                    AutoCloseable { entered.countDown(); releaseSecond.await() },
                ))
                interruptRestored.set(Thread.currentThread().isInterrupted)
            } finally {
                returned.countDown()
            }
        }
        caller.start()
        try {
            assertTrue("Both independent goodbye timers must start", entered.await(2, TimeUnit.SECONDS))
            caller.interrupt()
            releaseFirst.countDown()
            assertTrue(firstFinished.await(2, TimeUnit.SECONDS))
            assertFalse("The second instance is still closing", returned.await(100, TimeUnit.MILLISECONDS))
            releaseSecond.countDown()
            assertTrue(returned.await(2, TimeUnit.SECONDS))
            assertTrue("Caller interruption must survive cleanup", interruptRestored.get())
        } finally {
            releaseFirst.countDown()
            releaseSecond.countDown()
            caller.join(2_000)
        }
    }

    @Test fun failedCloserDoesNotSkipOtherResources() {
        val closed = CountDownLatch(1)
        BonjourMdnsCleanup.closeAll(listOf(
            AutoCloseable { throw IllegalStateException("close failed") },
            AutoCloseable { closed.countDown() },
        ))
        assertEquals(0L, closed.count)
    }

    @Test fun emptyAndSingleResourceNeedNoWorker() {
        BonjourMdnsCleanup.closeAll(emptyList())
        val caller = Thread.currentThread()
        var closedOn: Thread? = null
        BonjourMdnsCleanup.closeAll(listOf(AutoCloseable { closedOn = Thread.currentThread() }))
        assertEquals(caller, closedOn)
    }
}
