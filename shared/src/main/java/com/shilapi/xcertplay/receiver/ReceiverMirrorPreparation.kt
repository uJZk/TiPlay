package com.shilapi.xcertplay.receiver

import java.io.Closeable
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/** Observes an explicit mirror intent that has not acquired a screen/media lease. */
internal class ReceiverMirrorPreparation(
    private val scheduler: ScheduledExecutorService,
    private val observationMillis: Long,
    private val log: (String) -> Unit,
) : Closeable {
    enum class End(val wire: String) {
        STREAM("stream-setup"), AUDIO("audio-setup"), OTHER_MEDIA("other-media"),
        MEDIA_RESET("media-reset"), TEARDOWN("teardown"), CONTROL_CLOSED("control-closed"),
    }

    private class Observation(val generation: Long, val startedNanos: Long, val combinedInfo: Boolean) {
        var task: ScheduledFuture<*>? = null
        var elapsed = false
    }

    private val lock = Any()
    private var observation: Observation? = null
    private var generation = 0L
    private var closed = false

    init { require(observationMillis > 0) }

    fun begin(combinedInfo: Boolean) {
        val messages = synchronized(lock) {
            if (closed) return
            val previous = observation
            previous?.task?.cancel(false)
            val next = Observation(++generation, System.nanoTime(), combinedInfo)
            observation = next
            try {
                next.task = scheduler.schedule({ observe(next) }, observationMillis, TimeUnit.MILLISECONDS)
                listOfNotNull(previous?.let { line(it, "ended reason=replaced") },
                    line(next, "awaiting-stream-observation observationMs=$observationMillis"))
            } catch (_: RejectedExecutionException) {
                observation = null
                listOf(line(next, "ended reason=server-stopped"))
            }
        }
        messages.forEach(::report)
    }

    /** Expiry records absence of an accepted stream; it does not fail or close any transport. */
    private fun observe(expected: Observation) {
        val message = synchronized(lock) {
            if (closed || observation !== expected) return
            expected.task = null
            expected.elapsed = true
            line(expected, "observation-elapsed streamStarted=false observationMs=$observationMillis")
        }
        report(message)
    }

    fun end(reason: End) {
        val message = synchronized(lock) {
            val previous = observation ?: return
            observation = null
            previous.task?.cancel(false)
            line(previous, "ended reason=${reason.wire}")
        }
        report(message)
    }

    override fun close() {
        val message = synchronized(lock) {
            if (closed) return
            closed = true
            val previous = observation
            observation = null
            previous?.task?.cancel(false)
            previous?.let { line(it, "ended reason=${End.CONTROL_CLOSED.wire}") }
        }
        message?.let(::report)
    }

    private fun line(value: Observation, state: String): String =
        "stage=MIRROR_PREPARATION state=$state observation=${value.generation} " +
            "elapsedMs=${((System.nanoTime() - value.startedNanos) / 1_000_000).coerceAtLeast(0)} " +
            "afterObservation=${value.elapsed} combinedInfo=${value.combinedInfo}"

    private fun report(message: String) { runCatching { log(message) } }
}
