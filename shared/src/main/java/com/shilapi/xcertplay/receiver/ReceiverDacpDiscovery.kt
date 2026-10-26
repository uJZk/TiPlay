package com.shilapi.xcertplay.receiver

import java.io.Closeable
import java.net.InetAddress
import java.util.IdentityHashMap
import java.util.Locale
import javax.jmdns.JmDNS
import javax.jmdns.ServiceEvent
import javax.jmdns.ServiceListener

/** DACP browsing shares the receiver's existing per-interface mDNS instances.
 * Names select a sender ID, but only an address equal to that RTSP peer can supply its port.
 * Protocol comparison: Shairport Sync b991d913, mdns_avahi.c resolve_callback.
 */
class ReceiverDacpDiscovery(changed: () -> Unit = {}) : Closeable {
    internal val directory = ReceiverDacpDirectory(changed)
    private val lock = Any()
    private val bindings = IdentityHashMap<JmDNS, Binding>()
    private var closed = false

    private inner class Binding(val dns: JmDNS) {
        val requested = mutableSetOf<String>()
        val listener = object : ServiceListener {
            override fun serviceAdded(event: ServiceEvent) {
                if (!event.type.equals(SERVICE_TYPE, true) || serviceId(event.name) == null) return
                val name = event.name.lowercase(Locale.ROOT)
                val request = synchronized(lock) {
                    if (closed || bindings[dns] !== this@Binding || name in requested ||
                        requested.size >= ReceiverDacpDirectory.MAX_ENTRIES) false
                    else { requested.add(name); true }
                }
                if (request) runCatching { dns.requestServiceInfo(SERVICE_TYPE, event.name, true, 1_000L) }
            }

            override fun serviceRemoved(event: ServiceEvent) {
                if (!event.type.equals(SERVICE_TYPE, true)) return
                val active = synchronized(lock) {
                    if (bindings[dns] !== this@Binding) false
                    else { requested.remove(event.name.lowercase(Locale.ROOT)); true }
                }
                if (active) directory.remove(this@Binding, event.name)
            }

            override fun serviceResolved(event: ServiceEvent) {
                if (!event.type.equals(SERVICE_TYPE, true)) return
                val active = synchronized(lock) { !closed && bindings[dns] === this@Binding }
                if (!active) return
                val info = event.info ?: return
                directory.update(this@Binding, event.name, info.inetAddresses.toList(), info.port)
            }
        }
    }

    fun attach(dns: JmDNS) {
        val binding = synchronized(lock) {
            if (closed || bindings.containsKey(dns)) return
            Binding(dns).also { bindings[dns] = it; directory.attach(it) }
        }
        try {
            dns.addServiceListener(SERVICE_TYPE, binding.listener)
            // Detach/close can race listener installation; retire the late registration too.
            val retained = synchronized(lock) { !closed && bindings[dns] === binding }
            if (!retained) runCatching { dns.removeServiceListener(SERVICE_TYPE, binding.listener) }
        } catch (_: Exception) {
            val removed = synchronized(lock) {
                if (bindings[dns] === binding) { bindings.remove(dns); true } else false
            }
            if (removed) directory.retire(binding)
            runCatching { dns.removeServiceListener(SERVICE_TYPE, binding.listener) }
        }
    }

    /** The DNS object itself remains owned and closed by ReceiverBonjour. */
    fun detach(dns: JmDNS) {
        val binding = synchronized(lock) { bindings.remove(dns) } ?: return
        directory.retire(binding)
        runCatching { dns.removeServiceListener(SERVICE_TYPE, binding.listener) }
    }

    fun endpoint(dacpId: String, peer: InetAddress): Int? = directory.endpoint(dacpId, peer)

    override fun close() {
        val retired = synchronized(lock) {
            if (closed) return
            closed = true
            bindings.values.toList().also { bindings.clear() }
        }
        retired.forEach {
            directory.retire(it)
            runCatching { it.dns.removeServiceListener(SERVICE_TYPE, it.listener) }
        }
    }

    companion object {
        const val SERVICE_TYPE = "_dacp._tcp.local."

        internal fun normalizeId(value: String): String? = value.takeIf {
            it.length in 1..16 && it.all { c -> c in '0'..'9' || c in 'a'..'f' || c in 'A'..'F' }
        }?.uppercase(Locale.ROOT)?.trimStart('0')?.ifEmpty { "0" }

        internal fun serviceId(name: String): String? = if (name.startsWith("iTunes_Ctrl_", true))
            normalizeId(name.substring("iTunes_Ctrl_".length)) else null
    }
}

/** Pure, bounded records scoped to one mDNS attachment generation. No hostnames/TXT are resolved here. */
internal class ReceiverDacpDirectory(private val changed: () -> Unit = {}) {
    private data class Entry(val id: String, val addresses: Set<InetAddress>, val port: Int)
    private val lock = Any()
    private val scopes = IdentityHashMap<Any, LinkedHashMap<String, Entry>>()

    fun attach(scope: Any) = synchronized(lock) { scopes.getOrPut(scope) { linkedMapOf() }; Unit }

    fun update(scope: Any, name: String, addresses: List<InetAddress>, port: Int) {
        val id = ReceiverDacpDiscovery.serviceId(name) ?: return
        val key = name.lowercase(Locale.ROOT)
        val safeAddresses = addresses.take(16).filterNot { it.isAnyLocalAddress || it.isMulticastAddress }.toSet()
        val entry = if (port in 1..65535 && safeAddresses.isNotEmpty()) Entry(id, safeAddresses, port) else null
        val modified = synchronized(lock) {
            val records = scopes[scope] ?: return
            if (entry == null) records.remove(key) != null
            else if (records[key] == entry || key !in records && records.size >= MAX_ENTRIES) false
            else { records[key] = entry; true }
        }
        if (modified) notifyChanged()
    }

    fun remove(scope: Any, name: String) {
        val modified = synchronized(lock) { scopes[scope]?.remove(name.lowercase(Locale.ROOT)) != null }
        if (modified) notifyChanged()
    }

    fun retire(scope: Any) {
        val modified = synchronized(lock) { scopes.remove(scope)?.isNotEmpty() == true }
        if (modified) notifyChanged()
    }

    fun endpoint(dacpId: String, peer: InetAddress): Int? {
        val id = ReceiverDacpDiscovery.normalizeId(dacpId) ?: return null
        return synchronized(lock) {
            // Conflicting advertisements for the same sender/address do not authorize a guessed port.
            scopes.values.flatMap { it.values }.filter { it.id == id && peer in it.addresses }
                .map { it.port }.distinct().singleOrNull()
        }
    }

    private fun notifyChanged() { runCatching(changed) }

    companion object { const val MAX_ENTRIES = 128 }
}
