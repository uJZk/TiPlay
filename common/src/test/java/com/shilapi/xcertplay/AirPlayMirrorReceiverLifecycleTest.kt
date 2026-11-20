package com.shilapi.xcertplay

import com.shilapi.xcertplay.receiver.ReceiverMirrorExperiment
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class AirPlayMirrorReceiverLifecycleTest {
    private class Fixture {
        var selected = ReceiverMirrorExperiment.BASELINE
        val posted = ArrayDeque<() -> Unit>()
        val stopped = mutableListOf<() -> Unit>()
        val started = mutableListOf<Pair<ReceiverMirrorExperiment, Long>>()
        val lifecycle = AirPlayMirrorReceiverLifecycle({ selected }, { posted += it },
            { _, done -> stopped += done }, { mode, generation -> started += mode to generation })
        fun apply(mode: ReceiverMirrorExperiment) { selected = mode; lifecycle.reconcile() }
        fun finishStop() { stopped.last()(); while (posted.isNotEmpty()) posted.removeFirst()() }
    }

    @Test fun aRapidSecondSelectionWaitsForOldMediaCleanupAndStartsOnlyTheLatestMode() {
        val f = Fixture()
        f.lifecycle.reconcile()
        val oldGeneration = f.started.single().second
        f.apply(ReceiverMirrorExperiment.H264_ONLY)
        assertFalse(f.lifecycle.isCurrent(oldGeneration))
        f.apply(ReceiverMirrorExperiment.NO_BLE)
        assertEquals(1, f.stopped.size)
        assertEquals(1, f.started.size)
        f.finishStop()
        assertEquals(listOf(ReceiverMirrorExperiment.BASELINE, ReceiverMirrorExperiment.NO_BLE), f.started.map { it.first })
        assertTrue(f.lifecycle.isCurrent(f.started.last().second))
        assertFalse(f.lifecycle.isCurrent(oldGeneration))
    }

    @Test fun everyModeIncludingReturnToBaselineUsesTheSameResetBarrier() {
        val f = Fixture()
        f.lifecycle.reconcile()
        for (mode in listOf(ReceiverMirrorExperiment.H264_ONLY, ReceiverMirrorExperiment.LEGACY_PAIRING,
                ReceiverMirrorExperiment.NO_BLE, ReceiverMirrorExperiment.BASELINE)) {
            val startsBefore = f.started.size
            f.apply(mode)
            assertEquals(startsBefore, f.started.size)
            f.finishStop()
            assertEquals(mode, f.started.last().first)
        }
        assertEquals(4, f.stopped.size)
        assertEquals(5, f.started.map { it.second }.distinct().size)
    }

    @Test fun unchangedModeDoesNotTearDownTheReceiverOrReplaceItsGeneration() {
        val f = Fixture()
        repeat(3) { f.lifecycle.reconcile() }
        assertEquals(1, f.started.size)
        assertTrue(f.stopped.isEmpty())
        assertTrue(f.lifecycle.isCurrent(f.started.single().second))
    }

    @Test fun destroyedServiceRejectsBothLateCleanupAndAlreadyQueuedReplacement() {
        for (queueBeforeClose in listOf(false, true)) {
            val f = Fixture()
            f.lifecycle.reconcile()
            f.apply(ReceiverMirrorExperiment.NO_BLE)
            if (queueBeforeClose) f.stopped.single()()
            f.lifecycle.close()
            if (!queueBeforeClose) f.stopped.single()()
            while (f.posted.isNotEmpty()) f.posted.removeFirst()()
            f.lifecycle.reconcile()
            assertEquals(1, f.started.size)
            assertFalse(f.lifecycle.isCurrent(f.started.single().second))
        }
    }

    @Test fun duplicateCleanupCallbackCannotStartAnotherReceiver() {
        val f = Fixture()
        f.lifecycle.reconcile()
        f.apply(ReceiverMirrorExperiment.NO_BLE)
        repeat(2) { f.stopped.single()() }
        while (f.posted.isNotEmpty()) f.posted.removeFirst()()
        assertEquals(2, f.started.size)
    }

    @Test fun mainThreadInvalidationNeverWaitsForBlockingWorkerNetworkCleanup() {
        var mode = ReceiverMirrorExperiment.BASELINE
        val enteredStop = CountDownLatch(1)
        val releaseStop = CountDownLatch(1)
        val closed = CountDownLatch(1)
        val lifecycle = AirPlayMirrorReceiverLifecycle({ mode }, {}, { _, _ ->
            enteredStop.countDown()
            releaseStop.await(3, TimeUnit.SECONDS)
        }, { _, _ -> })
        lifecycle.reconcile()
        mode = ReceiverMirrorExperiment.NO_BLE
        val worker = Thread { lifecycle.reconcile() }.apply { start() }
        try {
            assertTrue(enteredStop.await(1, TimeUnit.SECONDS))
            val main = Thread { lifecycle.close(); closed.countDown() }.apply { start() }
            assertTrue(closed.await(1, TimeUnit.SECONDS))
            main.join(1000)
        } finally {
            releaseStop.countDown()
            worker.join(3000)
        }
    }
}
