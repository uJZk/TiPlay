package com.shilapi.xcertplay.orchestration

import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** A timed-out old controller must keep its radio lease until both startup and cleanup finish. */
internal object WirelessRadioOwnership {
    private var current: Lease? = null
    private val cleanup = ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(1),
        { task -> Thread(task, "carplay-wireless-cleanup").apply { isDaemon = true } })

    @Synchronized fun acquire(): Lease? {
        if (current != null) return null
        return Lease().also { current = it }
    }
    @Synchronized private fun release(lease: Lease) { if (current === lease) current = null }

    class Lease internal constructor() {
        @Volatile var failed = false
            private set
        private var runDone = false
        private var cleanupDone = false
        private var submitted = false
        private var work: (() -> Unit)? = null
        private val done = CountDownLatch(1)
        private val callbacks = mutableListOf<() -> Unit>()
        fun startCleanup(action: () -> Unit) {
            synchronized(this) { if (work == null && !cleanupDone) work = action }
            retryCleanup()
        }
        @Synchronized fun retryCleanup() {
            val action = work ?: return
            if (submitted || cleanupDone) return
            submitted = true
            try { cleanup.execute { action() } }
            catch (_: java.util.concurrent.RejectedExecutionException) { submitted = false }
        }
        @Synchronized fun cleanupFailed() { failed = true } // Keep the old owner and work/resource references.
        fun runFinished() { synchronized(this) { runDone = true }; finishIfReady() }
        fun cleanupFinished() { synchronized(this) { if (failed) return; cleanupDone = true; work = null }; finishIfReady() }
        fun await(timeoutMillis: Long): Boolean = try { !failed && done.await(timeoutMillis.coerceAtLeast(0), TimeUnit.MILLISECONDS) }
            catch (_: InterruptedException) { Thread.currentThread().interrupt(); false }
        fun whenReleased(callback: () -> Unit) {
            val now = synchronized(this) { if (done.count == 0L) true else { callbacks += callback; false } }
            if (now) callback()
        }
        private fun finishIfReady() {
            val notify = synchronized(this) {
                if (failed || !runDone || !cleanupDone || done.count == 0L) return
                release(this)
                done.countDown()
                callbacks.toList().also { callbacks.clear() }
            }
            notify.forEach { runCatching(it) }
        }
    }
}
