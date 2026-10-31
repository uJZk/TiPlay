package com.shilapi.xcertplay.network

import java.io.IOException
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Semaphore
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Reserve cleanup capacity before creating an opaque JmDNS resource, including late results. */
internal object BonjourMdnsCleanup {
    private val pool = BonjourCleanupPool()
    fun reserve(ownerKey: String? = null): BonjourCleanupPool.Reservation? = pool.reserve(ownerKey)
}

internal class BonjourCleanupPool : AutoCloseable {
    private val permits = Semaphore(6)
    private val retained = mutableSetOf<Reservation>()
    // Completion callbacks can still occupy both workers after their reservations are released.
    // All six currently reserved closes must fit in the queue even in that interval.
    private val executor = ThreadPoolExecutor(2, 2, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(6),
        { task -> Thread(task, "carplay-mdns-close").apply { isDaemon = true } })

    fun reserve(ownerKey: String? = null): Reservation? = synchronized(retained) {
        // Retain an address owner until its goodbye/close has really finished. A replacement
        // ReceiverBonjour instance must not publish while an older instance can still withdraw it.
        if (ownerKey != null && retained.any { it.ownerKey == ownerKey }) return null
        if (!permits.tryAcquire()) return null
        Reservation(ownerKey).also { retained.add(it) }
    }

    override fun close() { executor.shutdownNow() }

    inner class Reservation internal constructor(internal val ownerKey: String?) {
        private var resource: AutoCloseable? = null
        private var closing = false
        private var submitted = false
        private var users = 0
        private val done = CountDownLatch(1)
        private val callbacks = mutableListOf<() -> Unit>()
        @Volatile var failureClass: String? = null
            private set
        val complete: Boolean get() = done.count == 0L
        @Synchronized fun attach(value: AutoCloseable) {
            check(resource == null && !complete)
            resource = value
            submitIfReady()
        }
        fun <T> use(action: () -> T): T {
            synchronized(this) {
                if (closing || complete || resource == null) throw IOException("Bonjour startup cancelled")
                users++
            }
            try { return action() }
            finally { synchronized(this) { users--; submitIfReady() } }
        }
        @Synchronized fun requestClose() { closing = true; submitIfReady() }
        fun abandon() {
            synchronized(this) { check(resource == null) }
            finish()
        }
        fun whenComplete(callback: () -> Unit) {
            val now = synchronized(this) { if (complete) true else { callbacks += callback; false } }
            if (now) callback()
        }
        fun await(timeoutMillis: Long): Boolean = try { done.await(timeoutMillis.coerceAtLeast(0), TimeUnit.MILLISECONDS) && failureClass == null }
            catch (_: InterruptedException) { Thread.currentThread().interrupt(); false }
        private fun submitIfReady() {
            val owner = resource ?: return
            if (!closing || submitted || users != 0) return
            submitted = true
            try {
                executor.execute {
                    try { owner.close() }
                    catch (error: Throwable) { failureClass = error.javaClass.simpleName.take(80) }
                    finally { finish() }
                }
            } catch (_: java.util.concurrent.RejectedExecutionException) {
                // Keep the reservation and resource owned; never fall back to an unbounded caller close.
                submitted = false
            }
        }
        private fun finish() {
            val notify = synchronized(this) {
                if (complete) return
                if (failureClass == null) {
                    resource = null
                    synchronized(retained) { retained.remove(this) }
                    permits.release()
                }
                // A failed close keeps its resource and reserved capacity strongly owned.

                done.countDown()
                callbacks.toList().also { callbacks.clear() }
            }
            notify.forEach { runCatching(it) }
        }
    }
}
