package com.shilapi.xcertplay.receiver

import java.net.InetAddress
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** Shares bounded FCUP exchanges and sends one at a time without extending original deadlines. */
internal class ReceiverResourceRequests(
    private val timeoutNanos: Long = TimeUnit.SECONDS.toNanos(30),
    private val maximumPending: Int = 16,
    private val exchangeTimeoutNanos: Long = TimeUnit.SECONDS.toNanos(10),
    private val nowNanos: () -> Long = System::nanoTime,
    private val onDeadline: ((DeadlineEvidence) -> Unit)? = null,
) {
    class Pending(val id: Long, val session: String, val peer: InetAddress, val url: String, val range: String?,
                  val startedNanos: Long, val ownerGeneration: Long? = null) {
        val future = CompletableFuture<ReceiverResource?>()
    }
    data class Acquisition(val pending: Pending, val created: Boolean)
    enum class Phase { QUEUED, EXCHANGE }
    enum class Deadline { OVERALL, EXCHANGE }
    data class DeadlineEvidence(val request: Long, val ownerGeneration: Long?, val phase: Phase,
                                val limitingDeadline: Deadline, val due: Boolean,
                                val queueMillis: Long, val exchangeMillis: Long?, val overallMillis: Long,
                                val overallLimitMillis: Long, val exchangeLimitMillis: Long) {
        fun line(): String = "resource stage=FCUP_DEADLINE request=$request owner=${ownerGeneration ?: "UNKNOWN"} " +
            "phase=$phase limitingDeadline=$limitingDeadline due=$due queueMs=$queueMillis " +
            "exchangeMs=${exchangeMillis ?: "NONE"} overallMs=$overallMillis " +
            "overallLimitMs=$overallLimitMillis exchangeLimitMs=$exchangeLimitMillis"
    }

    private val requests = linkedMapOf<Long, Pending>()
    private val dispatched = hashMapOf<Long, Long>()
    private var nextId = 0L

    init { require(timeoutNanos > 0 && maximumPending > 0 && exchangeTimeoutNanos > 0) }

    @Synchronized fun acquire(session: String, peer: InetAddress, url: String, range: String? = null,
                              ownerGeneration: Long? = null): Acquisition? {
        require(range == null || ReceiverResource.byteRange.matches(range))
        // Sharing applies only to concurrent in-flight loads. A completed live playlist is never a cache.
        requests.values.filter { it.future.isDone || remainingNanos(it) == 0L }.forEach {
            if (it.future.isDone) remove(it) else expire(it)
        }
        requests.values.firstOrNull { it.session == session && it.peer == peer && it.url == url && it.range == range }?.let {
            return Acquisition(it, false)
        }
        if (requests.size >= maximumPending) return null
        val pending = Pending(++nextId, session, peer, url, range, nowNanos(), ownerGeneration)
        requests[pending.id] = pending
        return Acquisition(pending, true)
    }

    @Synchronized operator fun get(id: Long): Pending? {
        val pending = requests[id] ?: return null
        if (remainingNanos(pending) == 0L) { expire(pending); return null }
        return pending
    }

    /** A reverse HTTP acknowledgement does not complete the exchange; wait for its /action resource. */
    @Synchronized fun nextToDispatch(session: String, peer: InetAddress): Pending? {
        requests.values.filter { remainingNanos(it) == 0L }.forEach(::expire)
        if (requests.values.any { it.id in dispatched && !it.future.isDone }) return null
        val pending = requests.values.filter {
            it.session == session && it.peer == peer && it.id !in dispatched && !it.future.isDone
        }.minByOrNull { request ->
            val path = request.url.substringBefore('?').lowercase()
            when {
                path.endsWith(".m3u8") || path.endsWith(".m3u") -> 0
                path.endsWith(".key") || path.endsWith(".vtt") -> 1
                else -> 2
            }
        } ?: return null
        dispatched[pending.id] = nowNanos()
        return pending
    }

    @Synchronized fun remainingNanos(pending: Pending): Long {
        val overall = timeoutNanos - (nowNanos() - pending.startedNanos)
        val exchange = dispatched[pending.id]?.let { exchangeTimeoutNanos - (nowNanos() - it) } ?: Long.MAX_VALUE
        return minOf(overall, exchange).coerceAtLeast(0)
    }

    /** A queued loader also wakes when an abandoned in-flight exchange reaches its deadline. */
    @Synchronized fun waitNanos(pending: Pending): Long =
        requests.values.filter { it.id in dispatched && !it.future.isDone }
            .fold(remainingNanos(pending)) { wait, active -> minOf(wait, remainingNanos(active)) }

    @Synchronized fun remove(pending: Pending) {
        if (requests.remove(pending.id, pending)) dispatched.remove(pending.id)
    }

    @Synchronized fun expire(pending: Pending) {
        if (requests.remove(pending.id, pending)) {
            val sent = dispatched.remove(pending.id)
            val evidence = if (onDeadline == null) null else {
                val now = nowNanos()
                val overall = (now - pending.startedNanos).coerceAtLeast(0)
                val exchange = sent?.let { (now - it).coerceAtLeast(0) }
                val limiting = if (exchange != null && exchangeTimeoutNanos - exchange < timeoutNanos - overall)
                    Deadline.EXCHANGE else Deadline.OVERALL
                DeadlineEvidence(pending.id, pending.ownerGeneration,
                    if (sent == null) Phase.QUEUED else Phase.EXCHANGE, limiting,
                    overall >= timeoutNanos || exchange?.let { it >= exchangeTimeoutNanos } == true,
                    ((sent ?: now) - pending.startedNanos).coerceAtLeast(0) / 1_000_000,
                    exchange?.div(1_000_000), overall / 1_000_000,
                    timeoutNanos / 1_000_000, exchangeTimeoutNanos / 1_000_000)
            }
            pending.future.completeExceptionally(TimeoutException())
            // State is already retired; a failing or reentrant logger cannot strand the queue.
            if (evidence != null) runCatching { onDeadline?.invoke(evidence) }
        }
    }

    @Synchronized fun clear() {
        requests.values.forEach { it.future.complete(null) }
        requests.clear()
        dispatched.clear()
    }
}
