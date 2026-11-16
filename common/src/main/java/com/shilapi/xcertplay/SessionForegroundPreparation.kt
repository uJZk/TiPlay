package com.shilapi.xcertplay

import android.content.Context
import androidx.lifecycle.ViewModel

/** Pending foreground access belongs to a receiving screen, never to a saved preference alone. */
internal object SessionForegroundPreparation {
    data class Lease(val token: Long, val owner: Any, val cancel: (Long) -> Unit)
    private var sequence = 0L
    private var current: Lease? = null

    fun claim(owner: Any, cancel: (Long) -> Unit, renew: Boolean = false): Lease {
        val replaced: Lease?
        val next = synchronized(this) {
            replaced = current?.takeIf { it.owner !== owner }
            val token = current?.takeIf { !renew && it.owner === owner }?.token ?: ++sequence
            Lease(token, owner, cancel).also { current = it }
        }
        replaced?.let { it.cancel(it.token) }
        return next
    }

    @Synchronized fun snapshot(): Lease? = current
    @Synchronized fun hasPreparation(): Boolean = current != null

    @Synchronized fun release(owner: Any): Lease? =
        current?.takeIf { it.owner === owner }?.also { current = null }

    @Synchronized fun releaseToken(token: Long): Lease? =
        current?.takeIf { it.token == token }?.also { current = null }

    /** A real stored session replaces the pending purpose without changing the foreground owner. */
    @Synchronized fun consume(): Lease? = current.also { current = null }

    /** Call the screen only after releasing this monitor; it may finish or start another owner. */
    fun cancel(token: Long? = null): Boolean {
        val removed = synchronized(this) {
            current?.takeIf { token == null || it.token == token }?.also { current = null }
        } ?: return false
        removed.cancel(removed.token)
        return true
    }
}

/** Rotation keeps the token; finishing the receiving screen releases an unadopted preparation. */
internal class SessionForegroundPreparationOwner : ViewModel() {
    private var application: Context? = null
    private var cancellation: ((Long) -> Unit)? = null
    private var cancelledToken = 0L
    var cancelled = false
        private set

    // The callback holds only a weak Activity reference; the cancellation fence survives rotation.
    fun attach(context: Context, cancellation: (Long) -> Unit) {
        application = context.applicationContext
        this.cancellation = cancellation
        if (cancelled) cancellation(cancelledToken)
    }

    fun cancel(token: Long) {
        cancelled = true
        cancelledToken = token
        cancellation?.invoke(token)
    }

    override fun onCleared() {
        application?.let { DiPlaySessionService.releasePreparation(it, this) }
        application = null
        cancellation = null
    }
}
