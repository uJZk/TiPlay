package com.shilapi.xcertplay.web

import java.io.Closeable
import java.util.Locale
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** One peer's canonical FIFO ingress; only credit processing bypasses the ordered application RPC lane. */
internal class BrowserRtcControlQueue(
    private val authenticated: () -> Boolean,
    private val capture: (ByteArray) -> Unit,
    private val acknowledge: (Map<*, *>) -> Unit,
    private val application: (Map<*, *>) -> String?,
    private val respond: (Map<*, *>, String) -> Unit,
    private val failure: (String, Exception?) -> Unit,
    private val nowNanos: () -> Long = System::nanoTime,
    // One ingress body remains <=64 KiB. The 256 KiB byte budget matches the native media
    // buffered-amount cap; 2048 small ACKs additionally bound object overhead (~128 KiB).
    // This is a finite burst mailbox, not another copy of the 18 MiB media credit window.
    private val maxInboxBytes: Int = 256 * 1024,
    private val maxInboxMessages: Int = 2048,
    private val rpcCapacity: Int = 64,
) : Closeable {
    private data class Pending(val bytes: ByteArray, val since: Long)
    private enum class Kind { ACK, AUTH, LEASE, RPC, INVALID }
    private class Cost {
        var count = 0L
        val total = LongArray(5)
        val maximum = LongArray(5)
        fun add(phase: Int, nanos: Long) {
            val elapsed = nanos.coerceAtLeast(0)
            total[phase] += elapsed
            maximum[phase] = maxOf(maximum[phase], elapsed)
        }
    }
    private val closed = AtomicBoolean()
    private val failed = AtomicBoolean()
    private val inboxLock = Any()
    private val inbox = ArrayDeque<Pending>()
    private var inboxBytes = 0
    private var draining = false
    private var inboxHighMessages = 0
    private var inboxHighBytes = 0
    private var received = 0L
    private var rejected = 0L
    private var abandonedMessages = 0L
    private var abandonedBytes = 0L
    private var drainTasks = 0L
    private var terminalMessages = 0
    private var terminalBytes = 0
    private var abandonedRpcMessages = 0
    private var rpcRejectedMessages = 0L
    private val ingress = Executors.newSingleThreadExecutor { Thread(it, "browser-rtc-ingress").apply { isDaemon = true } }
    private val rpc = ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue(rpcCapacity),
        { Thread(it, "browser-rtc-control").apply { isDaemon = true } })
    private val metricLock = Any()
    private val costs = Kind.entries.associateWith { Cost() }
    private var rpcHighMessages = 0
    private var lastKind = "none"
    private var ingressPhase = "idle"
    private var ingressSince = 0L
    private var rpcKind = "none"
    private var rpcSince = 0L

    /** Native callbacks only copy and enqueue. One drain task represents the entire bounded mailbox. */
    fun offer(bytes: ByteArray) {
        var start = false
        val overload = synchronized(inboxLock) {
            if (closed.get()) return
            val reason = if (bytes.isEmpty() || bytes.size > MAX_MESSAGE_BYTES) "invalid-control" else if
                (inbox.size >= maxInboxMessages || bytes.size > maxInboxBytes - inboxBytes) "control-ingress-overload" else {
                inbox.addLast(Pending(bytes, nowNanos()))
                inboxBytes += bytes.size; received++
                inboxHighMessages = maxOf(inboxHighMessages, inbox.size)
                inboxHighBytes = maxOf(inboxHighBytes, inboxBytes)
                if (!draining) { draining = true; start = true; drainTasks++ }
                null
            }
            if (reason != null) rejected++
            reason
        }
        if (overload != null) { fail(overload, null); return }
        if (start) try { ingress.execute(::drain) }
        catch (error: RejectedExecutionException) { if (!closed.get()) fail("control-ingress-rejected", error) }
    }

    private fun drain() {
        while (!closed.get()) {
            val pending = synchronized(inboxLock) {
                val next = inbox.removeFirstOrNull()
                if (next == null) draining = false else inboxBytes -= next.bytes.size
                next
            } ?: return
            var kind = Kind.INVALID
            var captureNanos = 0L
            var parseNanos = 0L
            val started = nowNanos()
            try {
                phase("capture", started)
                val captureStarted = nowNanos()
                try { capture(pending.bytes) } finally { captureNanos = nowNanos() - captureStarted }
                if (closed.get()) return
                phase("parse", nowNanos())
                val parseStarted = nowNanos()
                val fields = try { WebJson.parse(String(pending.bytes, Charsets.UTF_8)) as? Map<*, *> ?: error("control-object") }
                    finally { parseNanos = nowNanos() - parseStarted }
                kind = when (fields["k"]) { "ack" -> Kind.ACK; "auth" -> Kind.AUTH; "audio-ready" -> Kind.LEASE; else -> Kind.RPC }
                check(authenticated() || kind == Kind.AUTH) { "authentication-required" }
                if (kind == Kind.ACK) {
                    phase("ack", nowNanos())
                    val work = nowNanos()
                    try { if (!closed.get()) acknowledge(fields) } finally { cost(kind, 4, nowNanos() - work) }
                } else {
                    val completion = if (kind == Kind.AUTH) CountDownLatch(1) else null
                    dispatch(fields, kind, completion)
                    // Authentication is a real protocol barrier, not an ordinary slow status RPC.
                    if (completion != null) { phase("authentication", nowNanos()); completion.await() }
                }
            } catch (error: Exception) { if (!closed.get()) fail("control-protocol", error) }
            finally {
                synchronized(metricLock) {
                    costs.getValue(kind).apply {
                        count++; add(0, started - pending.since); add(1, captureNanos); add(2, parseNanos)
                    }
                    lastKind = kind.name.lowercase(Locale.ROOT)
                    ingressPhase = "idle"; ingressSince = 0
                }
            }
        }
    }

    private fun dispatch(fields: Map<*, *>, kind: Kind, completion: CountDownLatch?) {
        val queued = nowNanos()
        try {
            rpc.execute {
                try {
                    if (closed.get()) return@execute
                    val started = nowNanos()
                    synchronized(metricLock) { rpcKind = kind.name.lowercase(Locale.ROOT); rpcSince = started }
                    cost(kind, 3, started - queued)
                    try {
                        check(authenticated() || kind == Kind.AUTH) { "authentication-required" }
                        val response = application(fields)
                        if (!closed.get() && response != null) respond(fields, response)
                    } finally { cost(kind, 4, nowNanos() - started) }
                } catch (error: Exception) { if (!closed.get()) fail("control-protocol", error) }
                finally {
                    synchronized(metricLock) { rpcKind = "none"; rpcSince = 0 }
                    completion?.countDown()
                }
            }
            synchronized(metricLock) { rpcHighMessages = maxOf(rpcHighMessages, rpc.queue.size) }
        } catch (error: RejectedExecutionException) {
            completion?.countDown()
            if (!closed.get()) {
                synchronized(metricLock) { rpcRejectedMessages++ }
                fail("control-overload", error)
            }
        }
    }

    private fun phase(value: String, since: Long) = synchronized(metricLock) { ingressPhase = value; ingressSince = since }
    private fun cost(kind: Kind, phase: Int, elapsed: Long) = synchronized(metricLock) { costs.getValue(kind).add(phase, elapsed) }
    private fun fail(reason: String, error: Exception?) {
        if (!failed.compareAndSet(false, true)) return
        close()
        failure(reason, error)
    }

    /** Small status payload: detailed phase costs stay in native periodic/terminal logs. */
    fun summary(): Map<String, Any?> {
        val queue = synchronized(inboxLock) { mapOf("queuedMessages" to inbox.size, "queuedBytes" to inboxBytes,
            "highWaterMessages" to inboxHighMessages) }
        return synchronized(metricLock) {
            queue + mapOf("pendingReceiveTasks" to ((queue["queuedMessages"] as Int) + rpc.queue.size +
                (if (ingressPhase == "idle") 0 else 1) + (if (rpcKind == "none") 0 else 1)),
                "rpcQueuedMessages" to rpc.queue.size, "rpcHighWaterMessages" to rpcHighMessages,
                "queueClosed" to closed.get(), "failed" to failed.get())
        }
    }

    /** No callback, executor join or application lock is acquired while collecting diagnostics. */
    fun snapshot(): Map<String, Any?> {
        val queue = synchronized(inboxLock) { linkedMapOf<String, Any?>(
            "receivedMessages" to received, "rejectedMessages" to rejected, "drainTasks" to drainTasks,
            "queuedMessages" to inbox.size, "terminalMessages" to terminalMessages, "terminalBytes" to terminalBytes,
            "abandonedMessages" to abandonedMessages, "abandonedBytes" to abandonedBytes,
            "queuedBytes" to inboxBytes, "highWaterMessages" to inboxHighMessages, "highWaterBytes" to inboxHighBytes,
            "limitMessages" to maxInboxMessages, "limitBytes" to maxInboxBytes, "messageLimitBytes" to MAX_MESSAGE_BYTES,
            "queueClosed" to closed.get(), "failed" to failed.get()) }
        return synchronized(metricLock) {
            val now = nowNanos()
            queue + mapOf("rpcQueuedMessages" to rpc.queue.size, "rpcHighWaterMessages" to rpcHighMessages,
                "rpcLimitMessages" to rpcCapacity, "abandonedRpcMessages" to abandonedRpcMessages, "rpcRejectedMessages" to rpcRejectedMessages, "lastKind" to lastKind,
                "ingressPhase" to ingressPhase, "ingressActiveMs" to if (ingressSince == 0L) 0 else millis(now - ingressSince),
                "rpcActiveKind" to rpcKind, "rpcActiveMs" to if (rpcSince == 0L) 0 else millis(now - rpcSince),
                "kinds" to costs.mapKeys { it.key.name.lowercase(Locale.ROOT) }.mapValues { (_, value) ->
                    linkedMapOf<String, Any?>("messages" to value.count).apply {
                        PHASES.forEachIndexed { index, name -> put(name + "TotalMs", millis(value.total[index])); put(name + "MaxMs", millis(value.maximum[index])) }
                    }
                })
        }
    }

    fun diagnosticLines(epoch: Int, reason: String): List<String> {
        val snapshot = snapshot()
        val groups = linkedMapOf("queue" to snapshot.filterKeys { it != "kinds" })
        @Suppress("UNCHECKED_CAST") val kinds = snapshot["kinds"] as Map<String, Map<String, Any?>>
        kinds.forEach { (kind, values) -> groups[kind] = values }
        return buildList {
            for ((kind, values) in groups) {
                val prefix = "Browser RTC: stage=control-work epoch=$epoch reason=$reason kind=$kind"
                var line = StringBuilder(prefix)
                for ((key, value) in values) {
                    val entry = "$key=$value"
                    if (line.length > prefix.length && line.length + entry.length + 1 > 600) { add(line.toString()); line = StringBuilder(prefix) }
                    line.append(' ').append(entry)
                }
                add(line.toString())
            }
        }
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        synchronized(inboxLock) {
            terminalMessages = inbox.size; terminalBytes = inboxBytes
            abandonedMessages += inbox.size; abandonedBytes += inboxBytes
            inbox.clear(); inboxBytes = 0
        }
        ingress.shutdownNow()
        val abandoned = rpc.shutdownNow().size
        synchronized(metricLock) { abandonedRpcMessages += abandoned }
    }

    companion object {
        const val MAX_MESSAGE_BYTES = 64 * 1024
        private val PHASES = listOf("ingressWait", "capture", "parse", "rpcWait", "work")
        private fun millis(nanos: Long) = String.format(Locale.ROOT, "%.3f", nanos.coerceAtLeast(0) / 1_000_000.0)
    }
}
