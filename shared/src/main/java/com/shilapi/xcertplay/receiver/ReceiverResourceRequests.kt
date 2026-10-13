package com.shilapi.xcertplay.receiver

import java.net.InetAddress
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** A seek cancels the Media3 waiter, but cannot cancel the iPhone's in-flight FCUP exchange. */
internal class ReceiverResourceRequests(
    private val timeoutNanos: Long = TimeUnit.SECONDS.toNanos(30),
    private val maximumPending: Int = 16,
    private val nowNanos: () -> Long = System::nanoTime,
) {
    class Pending(val id: Long, val session: String, val peer: InetAddress, val url: String,
                  val startedNanos: Long) {
        val future = CompletableFuture<ReceiverResource?>()
    }
    data class Acquisition(val pending: Pending, val created: Boolean)

    private val requests = linkedMapOf<Long, Pending>()
    private var nextId = 0L

    init { require(timeoutNanos > 0 && maximumPending > 0) }

    @Synchronized fun acquire(session: String, peer: InetAddress, url: String): Acquisition? {
        requests.values.filter { remainingNanos(it) == 0L }.forEach(::expire)
        requests.values.firstOrNull { it.session == session && it.peer == peer && it.url == url }?.let {
            return Acquisition(it, false)
        }
        if (requests.size >= maximumPending) return null
        val pending = Pending(++nextId, session, peer, url, nowNanos())
        requests[pending.id] = pending
        return Acquisition(pending, true)
    }

    @Synchronized operator fun get(id: Long): Pending? {
        val pending = requests[id] ?: return null
        if (remainingNanos(pending) == 0L) { expire(pending); return null }
        return pending
    }

    fun remainingNanos(pending: Pending): Long =
        (timeoutNanos - (nowNanos() - pending.startedNanos)).coerceAtLeast(0)

    @Synchronized fun remove(pending: Pending) { requests.remove(pending.id, pending) }

    @Synchronized fun expire(pending: Pending) {
        if (requests.remove(pending.id, pending)) pending.future.completeExceptionally(TimeoutException())
    }

    @Synchronized fun clear() {
        requests.values.forEach { it.future.complete(null) }
        requests.clear()
    }
}
