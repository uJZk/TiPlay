package com.shilapi.xcertplay.receiver

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.Delayed
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

class ReceiverMirrorPreparationTest {
    @Test fun observationRecordsOneMilestoneAndStillAcceptsALateStream() {
        val scheduler = ManualScheduler()
        val logs = mutableListOf<String>()
        try {
            ReceiverMirrorPreparation(scheduler, 15_000, logs::add).use { preparation ->
                preparation.begin(combinedInfo = true)
                assertEquals(1, scheduler.tasks.size)
                assertTrue(logs.single().contains("state=awaiting-stream-observation"))
                scheduler.tasks.single().runEvenIfCancelled()
                assertTrue(logs.last().contains("state=observation-elapsed streamStarted=false"))
                assertTrue(logs.last().contains("afterObservation=true combinedInfo=true"))
                preparation.end(ReceiverMirrorPreparation.End.STREAM)
                assertTrue(logs.last().contains("state=ended reason=stream-setup"))
                assertTrue(logs.last().contains("afterObservation=true"))
                assertEquals(1, scheduler.tasks.size)
            }
        } finally { scheduler.shutdownNow() }
    }

    @Test fun aDequeuedOldTimerCannotObserveAReplacementOrACancelledPreparation() {
        val scheduler = ManualScheduler()
        val logs = mutableListOf<String>()
        try {
            ReceiverMirrorPreparation(scheduler, 15_000, logs::add).use { preparation ->
                preparation.begin(combinedInfo = false)
                val previous = scheduler.tasks.single()
                preparation.begin(combinedInfo = true)
                assertTrue(previous.isCancelled)
                val count = logs.size
                previous.runEvenIfCancelled()
                assertEquals(count, logs.size)
                assertTrue(logs.last().contains("observation=2"))
                val current = scheduler.tasks.last()
                preparation.end(ReceiverMirrorPreparation.End.AUDIO)
                assertTrue(current.isCancelled)
                val endedCount = logs.size
                current.runEvenIfCancelled()
                assertEquals(endedCount, logs.size)
                assertTrue(logs.last().contains("reason=audio-setup"))
            }
        } finally { scheduler.shutdownNow() }
    }

    @Test fun closeCancelsItsTimerAndNeverSchedulesAnotherObservation() {
        val scheduler = ManualScheduler()
        val logs = mutableListOf<String>()
        try {
            val preparation = ReceiverMirrorPreparation(scheduler, 15_000, logs::add)
            preparation.begin(combinedInfo = true)
            preparation.close()
            assertTrue(scheduler.tasks.single().isCancelled)
            val count = logs.size
            scheduler.tasks.single().runEvenIfCancelled()
            preparation.begin(combinedInfo = true)
            assertEquals(count, logs.size)
            assertEquals(1, scheduler.tasks.size)
            assertTrue(logs.last().contains("reason=control-closed"))
        } finally { scheduler.shutdownNow() }
    }

    /** Models a cancelled task that the executor had already dequeued before cancellation. */
    private class ManualScheduler : ScheduledThreadPoolExecutor(1) {
        val tasks = mutableListOf<Task>()
        override fun schedule(command: Runnable, delay: Long, unit: TimeUnit): ScheduledFuture<*> =
            Task(command).also(tasks::add)
    }

    private class Task(private val command: Runnable) : ScheduledFuture<Unit> {
        private var cancelled = false
        fun runEvenIfCancelled() = command.run()
        override fun cancel(mayInterruptIfRunning: Boolean): Boolean { cancelled = true; return true }
        override fun isCancelled() = cancelled
        override fun isDone() = cancelled
        override fun get() = Unit
        override fun get(timeout: Long, unit: TimeUnit) = Unit
        override fun getDelay(unit: TimeUnit) = 0L
        override fun compareTo(other: Delayed) = 0
    }
}
