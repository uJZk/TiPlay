package com.shilapi.xcertplay.web

import java.io.Closeable
import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException

/** One bounded mailbox on the peer's existing owner executor, with a reserved terminal-failure slot. */
internal class BrowserRtcCallbackQueue(
    private val executor: Executor,
    private val fallback: Executor,
    private val failure: (String, Long) -> Unit,
    private val capacity: Int = 32,
) : Closeable {
    private val lock = Any()
    private val actions = ArrayDeque<() -> Unit>()
    private var closed = false
    private var draining = false
    private data class Terminal(val reason: String, val observedAtMillis: Long)
    @Volatile private var terminal: Terminal? = null
    val failureReason: String? get() = terminal?.reason

    fun offer(action: () -> Unit): Boolean {
        var start = false
        val accepted = synchronized(lock) {
            if (closed || failureReason != null) return false
            val accepted = if (actions.size >= capacity) {
                terminal = Terminal("native-callback-overload", System.currentTimeMillis())
                actions.clear()
                false
            } else { actions.addLast(action); true }
            if (!draining) { draining = true; start = true }
            accepted
        }
        return (!start || scheduleDrain()) && accepted
    }

    /** Close admission immediately; only the owner may perform the terminal I/O and cleanup. */
    fun terminate(reason: String, observedAtMillis: Long = System.currentTimeMillis()): Boolean {
        var start = false
        synchronized(lock) {
            if (closed || terminal != null) return false
            terminal = Terminal(reason, observedAtMillis)
            actions.clear()
            if (!draining) { draining = true; start = true }
        }
        return !start || scheduleDrain()
    }

    private fun scheduleDrain(): Boolean {
        try { executor.execute(::drain) }
        catch (_: RejectedExecutionException) {
            synchronized(lock) {
                if (closed) return false
                if (terminal == null) terminal = Terminal("native-callback-executor-rejected", System.currentTimeMillis())
                actions.clear()
            }
            // Never run terminal cleanup on the native callback, even when its owner is retiring.
            try { fallback.execute(::drain) }
            catch (_: RejectedExecutionException) { close() }
            return false
        }
        return true
    }

    private fun drain() {
        while (true) {
            val action = synchronized(lock) {
                if (closed) { draining = false; return }
                val failureEvent = terminal
                if (failureEvent != null) {
                    closed = true; draining = false; actions.clear()
                    return@synchronized { failure(failureEvent.reason, failureEvent.observedAtMillis) }
                }
                actions.removeFirstOrNull() ?: run { draining = false; return }
            }
            try { action() }
            catch (_: Exception) {
                synchronized(lock) {
                    if (!closed && terminal == null) {
                        terminal = Terminal("native-callback-failed", System.currentTimeMillis()); actions.clear()
                    }
                }
            }
        }
    }

    override fun close() = synchronized(lock) {
        closed = true
        actions.clear()
    }
}
