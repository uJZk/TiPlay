package com.shilapi.xcertplay

import com.shilapi.xcertplay.receiver.ReceiverMirrorExperiment

/** Serial ordinary-receiver replacement with a barrier for asynchronous main-thread media cleanup. */
internal class AirPlayMirrorReceiverLifecycle(
    private val loadMode: () -> ReceiverMirrorExperiment,
    private val post: (() -> Unit) -> Unit,
    private val stop: (Long, () -> Unit) -> Unit,
    private val start: (ReceiverMirrorExperiment, Long) -> Unit,
) {
    @Volatile var generation = 0L
        private set
    @Volatile private var accepting = false
    private var mode: ReceiverMirrorExperiment? = null
    private var replacing = false
    private var closed = false

    /** Called on the service worker. Repeated changes during cleanup use only the latest stored mode. */
    fun reconcile() {
        val action: () -> Unit = synchronized(this) {
            if (closed || replacing) return
            val next = loadMode()
            if (accepting && mode == next) return
            val token = ++generation
            accepting = false
            if (mode == null) {
                mode = next
                accepting = true
                return@synchronized { start(next, token) }
            }
            replacing = true
            return@synchronized { stop(token) { stopped(token) } }
        }
        // Network cleanup must never hold the monitor needed by main-thread destruction.
        action()
    }

    private fun stopped(token: Long) = post {
        val action: () -> Unit = synchronized(this) {
            if (closed || generation != token || !replacing) return@post
            replacing = false
            val latest = loadMode()
            mode = latest
            accepting = true
            return@synchronized { start(latest, token) }
        }
        action()
    }

    fun isCurrent(token: Long): Boolean = accepting && generation == token

    /** May run on main while a stopped player's callback is still queued. */
    @Synchronized fun close() {
        closed = true
        accepting = false
        generation++
    }
}
