package com.shilapi.xcertplay.airplay

import java.util.concurrent.atomic.AtomicLong
import org.junit.Assert.*
import org.junit.Test

class TcpReceiveProbeTest {
    private val now = AtomicLong(1_000_000_000L)
    private val probe = TcpReceiveProbe(now::get)
    private val connection = Any()

    @Test fun defaultDoesNotThrottleAndRequiresLiveVideo() {
        assertTrue(probe.beforeRead(connection))
        assertFalse(probe.start())
        probe.attach(connection)
        probe.message(connection, 1000, 100L, now.get(), null)
        assertFalse(probe.isRunning(connection))
        assertTrue(probe.snapshot().contains("completeWireBytes=0"))
    }

    @Test fun finitePhasesPreserveSourceAgeUncertaintyAndRestoreUnrestrictedReads() {
        probe.attach(connection)
        assertTrue(probe.start())
        probe.message(connection, 150_000, 10L, now.get(), now.get() - 120_000_000L)
        assertTrue(probe.snapshot().contains("lastReceivedSourceAgeMs=120.00"))
        now.addAndGet(15_000_000_000L)
        assertTrue(probe.snapshot().contains("budgetBytesPerSecond=7000"))
        probe.message(connection, 1000, 20L, now.get(), null)
        assertTrue(probe.snapshot().contains("lastReceivedSourceAgeMs=unavailable"))
        now.addAndGet(15_000_000_000L)
        assertTrue(probe.snapshot().contains("budgetBytesPerSecond=4000"))
        now.addAndGet(15_000_000_000L)
        assertTrue(probe.snapshot().contains("RECOVERY / 无限制恢复"))
        assertTrue(probe.snapshot().contains("budgetBytesPerSecond=unrestricted"))
        now.addAndGet(15_000_000_000L)
        assertTrue(probe.snapshot().contains("COMPLETE:"))
        assertFalse(probe.isRunning(connection))
        assertTrue(probe.beforeRead(connection))
    }

    @Test fun scheduledPresentationCanArriveEarlyAndMustNotBeClamped() {
        probe.attach(connection)
        assertTrue(probe.start())
        probe.message(connection, 1000, 10L, now.get(), now.get() + 80_000_000L)
        assertTrue(probe.snapshot().contains("lastReceivedSourceAgeMs=-80.00"))
        probe.stop()
    }

    private fun startWaitingReader(): Thread {
        probe.attach(connection)
        assertTrue(probe.start())
        probe.message(connection, 1_500_000, 10L, now.get(), null)
        now.addAndGet(15_000_000_000L)
        probe.snapshot()
        probe.message(connection, 1_000_000, 20L, now.get(), null)
        val thread = Thread { probe.beforeRead(connection) }.apply { start() }
        val deadline = System.nanoTime() + 2_000_000_000L
        while (thread.state != Thread.State.TIMED_WAITING && System.nanoTime() < deadline) Thread.yield()
        assertEquals(Thread.State.TIMED_WAITING, thread.state)
        return thread
    }

    @Test fun userStopWakesReaderImmediately() {
        val thread = startWaitingReader()
        probe.stop()
        thread.join(1000)
        assertFalse("stop must release a large-frame gate", thread.isAlive)
        assertFalse(probe.isRunning(connection))
    }

    @Test fun connectionRetirementWakesReaderAndStaleRetirementCannotStopSuccessor() {
        val thread = startWaitingReader()
        probe.detach(connection)
        thread.join(1000)
        assertFalse("close must release receive gate", thread.isAlive)
        val successor = Any()
        probe.attach(successor)
        assertTrue(probe.start())
        probe.detach(connection)
        assertTrue(probe.isRunning(successor))
        probe.stop()
    }

    @Test fun quietSourceDoesNotCreateAnInvalidBudgetAndDiagnosticsCannotBreakMedia() {
        probe.attach(connection) { throw IllegalStateException("diagnostic failure") }
        assertTrue(probe.start())
        now.addAndGet(15_000_000_000L)
        assertTrue(probe.snapshot().contains("baseline had no complete video data"))
        assertFalse(probe.isRunning(connection))
    }
}
