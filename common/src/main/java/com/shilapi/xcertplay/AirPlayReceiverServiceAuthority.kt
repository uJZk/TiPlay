package com.shilapi.xcertplay

import java.io.Closeable

/**
 * One process-wide authority for ordinary receiver publication.
 *
 * Only atomic broker lease operations and state commits run under this monitor. Socket binding,
 * discovery/network cleanup and observer notifications belong outside it.
 */
internal class AirPlayReceiverServiceAuthority {
    private val monitor = Any()
    private var current: Owner? = null

    fun acquire(commit: () -> Unit = {}): Owner = synchronized(monitor) {
        current?.retireLocked()
        Owner().also {
            current = it
            commit()
        }
    }

    inner class Owner internal constructor() {
        @Volatile private var active = true
        private var discovery: Closeable? = null // monitor; this lease closes only an atomic broker entry

        fun isCurrent(): Boolean = active

        /** The callback installs only ReceiverDiscoveryInfo's atomic lease, never a network resource. */
        fun publishDiscovery(register: () -> Closeable): Closeable? = synchronized(monitor) {
            if (!active || current !== this) return@synchronized null
            discovery?.close()
            register().also { discovery = it }
        }

        /** Commit immutable public state here; invoke its observers after returning. */
        fun commit(action: () -> Unit): Boolean = synchronized(monitor) {
            if (!active || current !== this) return@synchronized false
            action()
            true
        }

        /** Invalidate callbacks and broker ownership before asynchronous network cleanup begins. */
        fun retire(commit: () -> Unit = {}): Boolean = synchronized(monitor) {
            if (!active || current !== this) return@synchronized false
            retireLocked()
            current = null
            commit()
            true
        }

        internal fun retireLocked() {
            active = false
            discovery?.close()
            discovery = null
        }
    }
}
