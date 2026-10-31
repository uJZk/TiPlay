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
                catch (_: Throwable) { entry.finish(false) }
            }
        }, "tiplay-raw-metadata").apply { isDaemon = true; start() }
    }
    fun offer(entry: MetadataCaptureSession.Entry): Boolean = queue.offer(entry)
    internal val queuedCount: Int get() = queue.size
}

internal class MetadataCaptureSession(val id: String) {
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
        fun finish(recorded: Boolean) {
            if (!resolved.compareAndSet(false, true)) return
            if (!recorded) reject()
            pending.remove(this)
            synchronized(completion) { completion.notifyAll() }
        }
    }

    private fun reject() { failures.incrementAndGet(); referenceIntegrity.set(false) }

    fun enqueue(channel: String, bytes: ByteArray, observedAtMillis: Long): Boolean {
        if (retired.get()) return false
        if (channel.length > 256 || bytes.size > RawMetadataCapture.MAX_BYTES) { reject(); return false }
        val entry = Entry(channel, bytes.copyOf(), observedAtMillis)
        pending.add(entry)
        if (retired.get()) { entry.finish(false); return false }
        accepted.incrementAndGet()
        if (!RawMetadataCapture.offer(entry)) { accepted.decrementAndGet(); entry.finish(false); return false }
        return true
    }

    /** Called under the journal lock; queued work cannot enter a stopped/replaced capture. */
    fun retire() {
        retired.set(true)
        pending.forEach { it.finish(false) }
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
}
