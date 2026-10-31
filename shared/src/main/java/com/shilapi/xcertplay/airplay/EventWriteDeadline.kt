package com.shilapi.xcertplay.airplay

import java.io.Closeable
import java.io.IOException
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** One event writer owns one ticket. Expiry closes that exact socket without taking its write lock. */
internal class EventWriteDeadline(
    private val timeoutMillis: () -> Long = { 5_000L },
    private val schedule: (Long, () -> Unit) -> Closeable = { delay, action ->
        val task = scheduler.schedule(Runnable { action() }, delay, TimeUnit.MILLISECONDS)
        Closeable { task.cancel(false) }
    },
) : Closeable {
    private class Ticket(val socket: Socket) {
        var cancellation: Closeable? = null
        @Volatile var expired = false
        @Volatile var retired = false
    }
    private val lock = Any()
    private var active: Ticket? = null
    private var closed = false

    fun <T> write(socket: Socket, operation: () -> T): T {
        val ticket = synchronized(lock) {
            if (closed) throw IOException("event-writer-closed")
            check(active == null) { "concurrent-event-write" }
            Ticket(socket).also { next ->
                active = next
                try { next.cancellation = schedule(timeoutMillis().coerceAtLeast(1L)) { expire(next) } }
                catch (failure: Exception) { active = null; throw failure }
            }
        }
        try {
            val result = operation()
            if (ticket.expired) throw SocketTimeoutException("event-write-timeout")
            if (ticket.retired) throw IOException("event-writer-closed")
            return result
        } catch (failure: Exception) {
            if (ticket.expired && failure !is SocketTimeoutException)
                throw SocketTimeoutException("event-write-timeout").apply { initCause(failure) }
            throw failure
        } finally {
            synchronized(lock) { if (active === ticket) active = null }
            runCatching { ticket.cancellation?.close() }
        }
    }

    private fun expire(ticket: Ticket) {
        val cancel = synchronized(lock) {
            if (closed || active !== ticket) false else { ticket.expired = true; true }
        }
        // No session callback, logger, event lock or cipher operation runs on this shared timer.
        if (cancel) runCatching { ticket.socket.close() }
    }

    override fun close() {
        val retired = synchronized(lock) {
            if (closed) return
            closed = true
            active.also { it?.retired = true; active = null }
        }
        runCatching { retired?.cancellation?.close() }
        runCatching { retired?.socket?.close() }
    }

    private companion object {
        val scheduler = ScheduledThreadPoolExecutor(1) { action ->
            Thread(action, "airplay-event-write-deadline").apply { isDaemon = true }
        }.apply { removeOnCancelPolicy = true }
    }
}
