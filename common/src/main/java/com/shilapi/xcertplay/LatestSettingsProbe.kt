package com.shilapi.xcertplay

import android.os.Handler
import android.os.Looper
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * One running probe, one replacement request and one pending UI result per settings card type, even across renders.
 * Request/cancel and delivery belong to the main thread. Work must capture only application data, never a view or
 * activity: cancellation releases its delivery callback immediately but cannot interrupt platform interface reads.
 */
internal class LatestSettingsProbe<T>(
    private val threadName: String,
    private val post: (Runnable) -> Unit = { main().post(it) },
    private val remove: (Runnable) -> Unit = { main().removeCallbacks(it) },
) {
    class Token

    private class Request<T>(val token: Token, var work: (() -> T)?, var deliver: ((T) -> Unit)?)
    private class Ready<T>(val request: Request<T>, val value: T)

    private val lock = Any()
    private var current: Request<T>? = null
    private var pending: Request<T>? = null
    private var ready: Ready<T>? = null
    private var running = false
    private var deliveryPosted = false
    private val delivery = Runnable(::deliver)
    private var idle = CountDownLatch(0)

    fun request(work: () -> T, deliver: (T) -> Unit): Token {
        val request = Request(Token(), work, deliver)
        val start = synchronized(lock) {
            current?.deliver = null
            pending?.work = null
            ready = null
            current = request
            pending = request
            if (running) false else { running = true; idle = CountDownLatch(1); true }
        }
        if (start) Thread(::drain, threadName).start()
        return request.token
    }

    fun cancel(token: Token?) {
        synchronized(lock) {
            if (current?.token !== token) return
            current?.deliver = null
            current = null
            pending?.work = null
            pending = null
            ready = null
            if (deliveryPosted) remove(delivery)
            deliveryPosted = false
        }
    }

    /** Tests wait for this helper's work, never unrelated sandbox threads with the same name. */
    internal fun awaitIdle(timeoutMillis: Long = 5_000): Boolean =
        synchronized(lock) { idle }.await(timeoutMillis, TimeUnit.MILLISECONDS)

    private fun drain() {
        while (true) {
            val (request, work) = synchronized(lock) {
                val request = pending ?: run { running = false; idle.countDown(); return }
                pending = null
                val work = checkNotNull(request.work)
                request.work = null
                request to work
            }
            val value = try {
                work()
            } catch (_: Exception) {
                synchronized(lock) {
                    request.deliver = null
                    if (current === request) current = null
                }
                continue
            }
            synchronized(lock) {
                if (current === request) {
                    ready = Ready(request, value)
                    if (!deliveryPosted) {
                        deliveryPosted = true
                        // Scheduling and cancellation share the lock; neither runs the callback inline.
                        post(delivery)
                    }
                }
            }
        }
    }

    private fun deliver() {
        val result = synchronized(lock) {
            deliveryPosted = false
            val result = ready
            ready = null
            if (result == null || current !== result.request) return
            val callback = result.request.deliver ?: return
            result.request.deliver = null
            current = null
            callback to result.value
        }
        result.first(result.second)
    }

    private companion object {
        private var handler: Handler? = null

        @Synchronized fun main(): Handler {
            val looper = Looper.getMainLooper()
            return handler?.takeIf { it.looper === looper } ?: Handler(looper).also { handler = it }
        }
    }
}
