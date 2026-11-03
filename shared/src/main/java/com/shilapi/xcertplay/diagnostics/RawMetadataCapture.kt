package com.shilapi.xcertplay.diagnostics

import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** A small asynchronous lane for diagnostic metadata, never for media payloads. */
internal object RawMetadataCapture {
    const val CAPACITY = 64
    const val MAX_BYTES = 32 * 1024
    private val queue = ArrayBlockingQueue<MetadataCaptureSession.Entry>(CAPACITY)
    init {
        Thread({
            while (true) {
                val entry = queue.take()
                try { RawTraffic.writeMetadata(entry) }
                catch (_: Throwable) { entry.finish(MetadataCaptureSession.Failure.WORKER_EXCEPTION) }
            }
        }, "tiplay-raw-metadata").apply { isDaemon = true; start() }
    }
    fun offer(entry: MetadataCaptureSession.Entry): Boolean = queue.offer(entry)
    internal val queuedCount: Int get() = queue.size
}

internal class MetadataCaptureSession(val id: String) {
    enum class Failure { CHANNEL_TOO_LONG, PAYLOAD_TOO_LARGE, QUEUE_FULL, SESSION_RETIRED, SESSION_CHANGED, WRITE_FAILED, WORKER_EXCEPTION }
    private data class FailureEvent(val reason: Failure, val atMillis: Long, val observedAtMillis: Long,
                                    val source: String, val bytes: Int)
    private val failureLock = Any()
    private val recentFailures = ArrayDeque<FailureEvent>()
    private val failureCounts = LongArray(Failure.entries.size)
    private var firstFailureMillis = 0L
    private var lastFailureMillis = 0L
    private val retired = AtomicBoolean()
    private val pending = ConcurrentHashMap.newKeySet<Entry>()
    private val failures = AtomicLong()
    private val accepted = AtomicLong()
    private val completion = Object()
    val referenceIntegrity = AtomicBoolean(true)

    inner class Entry(val channel: String, val bytes: ByteArray, val observedAtMillis: Long) {
        val session: MetadataCaptureSession get() = this@MetadataCaptureSession
        private val resolved = AtomicBoolean()
        val isPending: Boolean get() = !resolved.get()
        fun finish(failure: Failure? = null) {
            if (!resolved.compareAndSet(false, true)) return
            if (failure != null) reject(failure, channel, bytes.size, observedAtMillis)
            pending.remove(this)
            synchronized(completion) { completion.notifyAll() }
        }
    }

    private fun reject(reason: Failure, channel: String, bytes: Int, observedAtMillis: Long) {
        val at = System.currentTimeMillis()
        synchronized(failureLock) {
            if (firstFailureMillis == 0L) firstFailureMillis = at
            lastFailureMillis = at
            failureCounts[reason.ordinal]++
            if (recentFailures.size == 32) recentFailures.removeFirst()
            recentFailures.addLast(FailureEvent(reason, at, observedAtMillis, RawCaptureTiming.sourceCategory(channel), bytes))
            failures.incrementAndGet()
            referenceIntegrity.set(false)
        }
    }

    fun enqueue(channel: String, bytes: ByteArray, observedAtMillis: Long): Boolean {
        if (retired.get()) return false
        if (channel.length > 256) { reject(Failure.CHANNEL_TOO_LONG, channel, bytes.size, observedAtMillis); return false }
        if (bytes.size > RawMetadataCapture.MAX_BYTES) { reject(Failure.PAYLOAD_TOO_LARGE, channel, bytes.size, observedAtMillis); return false }
        val entry = Entry(channel, bytes.copyOf(), observedAtMillis)
        pending.add(entry)
        if (retired.get()) { entry.finish(Failure.SESSION_RETIRED); return false }
        accepted.incrementAndGet()
        if (!RawMetadataCapture.offer(entry)) { accepted.decrementAndGet(); entry.finish(Failure.QUEUE_FULL); return false }
        return true
    }

    /** Called under the journal lock; queued work cannot enter a stopped/replaced capture. */
    fun retire() {
        retired.set(true)
        pending.forEach { it.finish(Failure.SESSION_RETIRED) }
    }

    fun failureCount(): Long = failures.get()
    fun awaitIdle(timeoutMillis: Long): Boolean = synchronized(completion) {
        val deadline = System.nanoTime() + timeoutMillis.coerceAtLeast(0) * 1_000_000L
        while (pending.isNotEmpty()) {
            val remaining = deadline - System.nanoTime()
            if (remaining <= 0) return@synchronized false
            try { completion.wait(remaining / 1_000_000L, (remaining % 1_000_000L).toInt()) }
            catch (_: InterruptedException) { Thread.currentThread().interrupt(); return@synchronized false }
        }
        true
    }
    fun snapshot(): Map<String, Any> = mapOf("accepted" to accepted.get(), "failures" to failures.get(),
        "pending" to pending.size, "capacity" to RawMetadataCapture.CAPACITY, "maxBytes" to RawMetadataCapture.MAX_BYTES)
    fun summary(): String = "metadataAccepted=${accepted.get()} metadataFailures=${failures.get()} metadataPending=${pending.size}"

    /** Bounded, sanitized evidence; timestamps refer to failure and original observation. */
    fun failureReport(): String = synchronized(failureLock) {
        val counts = Failure.entries.joinToString(" ") { "${it.name.lowercase()}=${failureCounts[it.ordinal]}" }
        val omitted = (failures.get() - recentFailures.size).coerceAtLeast(0)
        buildString {
            append("RAW_ASYNC_FAILURE_SUMMARY firstEpochMillis=$firstFailureMillis lastEpochMillis=$lastFailureMillis omitted=$omitted $counts\n")
            recentFailures.forEach { event ->
                append("RAW_ASYNC_FAILURE reason=${event.reason.name.lowercase()} atEpochMillis=${event.atMillis} ")
                append("observedEpochMillis=${event.observedAtMillis} source=${event.source} bytes=${event.bytes}\n")
            }
        }
    }
}
