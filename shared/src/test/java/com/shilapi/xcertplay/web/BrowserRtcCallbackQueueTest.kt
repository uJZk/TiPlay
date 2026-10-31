package com.shilapi.xcertplay.web

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test

class BrowserRtcCallbackQueueTest {
    @Test fun blockedDiagnosticsKeepCallbackAdmissionBoundedAndReserveOneTerminalFailure() {
        val worker = Executors.newSingleThreadExecutor()
        val entered = CountDownLatch(1); val release = CountDownLatch(1); val failed = CountDownLatch(1)
        val failures = AtomicInteger(); val actions = AtomicInteger()
        val queue = BrowserRtcCallbackQueue(worker, worker, { reason, _ ->
            assertEquals("native-callback-overload", reason); failures.incrementAndGet(); failed.countDown()
        }, capacity = 2)
        try {
            assertTrue(queue.offer { entered.countDown(); check(release.await(2, TimeUnit.SECONDS)) })
            assertTrue(entered.await(1, TimeUnit.SECONDS))
            assertTrue(queue.offer { actions.incrementAndGet() })
            assertTrue(queue.offer { actions.incrementAndGet() })
            assertFalse(queue.offer { actions.incrementAndGet() })
            repeat(1000) { assertFalse(queue.offer { actions.incrementAndGet() }) }
            release.countDown()
            assertTrue(failed.await(1, TimeUnit.SECONDS))
            worker.submit {}.get(1, TimeUnit.SECONDS)
            assertEquals(1, failures.get()); assertEquals(0, actions.get())
        } finally { release.countDown(); queue.close(); worker.shutdownNow() }
    }

    @Test fun closedOwnerDropsQueuedAndLateCallbacks() {
        val scheduled = mutableListOf<Runnable>()
        val called = AtomicInteger()
        val queue = BrowserRtcCallbackQueue(Executor { scheduled.add(it) }, Executor { it.run() }, { reason, _ -> error(reason) })
        queue.offer { called.incrementAndGet() }
        queue.close()
        scheduled.single().run()
        assertFalse(queue.offer { called.incrementAndGet() })
        assertEquals(0, called.get())
    }

    @Test fun rejectedOwnerSchedulesFailureOnFallbackInsteadOfTheNativeCaller() {
        val fallback = Executors.newSingleThreadExecutor()
        val done = CountDownLatch(1)
        val caller = Thread.currentThread()
        val queue = BrowserRtcCallbackQueue(Executor { throw RejectedExecutionException() }, fallback, { reason, _ ->
            assertEquals("native-callback-executor-rejected", reason)
            assertNotEquals(caller, Thread.currentThread()); done.countDown()
        })
        try {
            queue.offer { error("Rejected work must not execute") }
            assertTrue(done.await(1, TimeUnit.SECONDS))
            assertEquals("native-callback-executor-rejected", queue.failureReason)
        } finally { queue.close(); fallback.shutdownNow() }
    }

    @Test fun terminalAdmissionIsImmediateAndPreservesTheFirstObservationUntilOwnerDrain() {
        val scheduled = mutableListOf<Runnable>()
        val failures = mutableListOf<Pair<String, Long>>()
        var actions = 0
        val queue = BrowserRtcCallbackQueue(Executor { scheduled.add(it) }, Executor { error("unexpected fallback") },
            { reason, observedAt -> failures += reason to observedAt })
        assertTrue(queue.offer { actions++ })
        assertTrue(queue.terminate("ice-failed", 1234L))
        assertEquals("ice-failed", queue.failureReason)
        repeat(1000) {
            assertFalse(queue.offer { actions++ })
            assertFalse(queue.terminate("channel-closed", 9999L))
        }
        assertTrue(failures.isEmpty())
        assertEquals(1, scheduled.size)
        scheduled.single().run()
        assertEquals(0, actions)
        assertEquals(listOf("ice-failed" to 1234L), failures)
    }
}
