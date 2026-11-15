package com.shilapi.xcertplay.web

import java.net.Inet4Address
import java.net.NetworkInterface

/** Session-owned source-address preference. Addresses never enter diagnostics. */
internal class BrowserRtcAudioRoutePolicy {
    internal data class Attempt(val token: Long, val revision: Long, val address: String?)
    private var address: String? = null
    private var revision = 0L
    private var token = 0L
    private var blocked = false
    private var closed = false
    private var current: Attempt? = null
    private var sawReady = false
    private var finished = false

    /** Pure, bounded callback work: no DNS, interface enumeration, native calls or I/O. */
    @Synchronized fun selected(candidate: String?) {
        if (closed) return
        val next = candidate?.let(::hostIpv4)
        if (address == next) return
        address = next; revision++; blocked = false; current = null
    }

    @Synchronized fun disconnected() { selected(null) }
    @Synchronized fun close() { selected(null); closed = true; current = null }

    /** The assignment check runs without the policy lock; revision fencing rejects a stale result. */
    fun begin(offer: String, connected: () -> Boolean, assigned: (String) -> Boolean): Attempt {
        val observed = synchronized(this) {
            Attempt(++token, revision, address.takeUnless { closed || blocked }).also { current = it; sawReady = false; finished = false }
        }
        val eligible = observed.address?.takeIf { connected() && hasIpv4Host(offer) && runCatching { assigned(it) }.getOrDefault(false) }
        return synchronized(this) {
            if (!owns(observed)) return@synchronized observed.copy(address = null)
            val chosen = eligible?.takeIf { !blocked && address == it && connected() }
            observed.copy(address = chosen).also { current = it }
        }
    }

    @Synchronized fun ready(attempt: Attempt) {
        if (owns(attempt) && !finished) sawReady = true
    }

    @Synchronized fun failed(attempt: Attempt) {
        if (!owns(attempt) || finished) return
        if (attempt.address != null) blocked = true
        finished = true
    }

    @Synchronized fun retired(attempt: Attempt) {
        if (!owns(attempt) || finished) return
        if (attempt.address != null && !sawReady) blocked = true
        finished = true
    }

    private fun owns(attempt: Attempt) = !closed && current == attempt && revision == attempt.revision

    companion object {
        fun ipv4(value: String): String? {
            val parts = value.split('.')
            if (parts.size != 4 || parts.any { it.isEmpty() || it.length > 3 || it.any { c -> c !in '0'..'9' } ||
                    it.length > 1 && it[0] == '0' || (it.toIntOrNull() ?: 256) > 255 }) return null
            val first = parts[0].toInt()
            return value.takeIf { first in 1..223 && first != 127 }
        }

        fun hostIpv4(candidate: String): String? {
            if (candidate.length > 1024) return null
            val fields = candidate.trim().split(Regex("\\s+"))
            if (fields.size < 8 || !fields[0].startsWith("candidate:") && !fields[0].startsWith("a=candidate:") ||
                fields[1] != "1" || !fields[2].equals("udp", true) || fields[6] != "typ" || fields[7] != "host") return null
            val foundation = fields[0].removePrefix("a=").removePrefix("candidate:")
            val priority = fields[3].toLongOrNull() ?: return null
            val port = fields[5].toIntOrNull() ?: return null
            if (!foundation.matches(Regex("[A-Za-z0-9+/]{1,32}")) ||
                priority !in 0L..0xffff_ffffL || port !in 1..65535) return null
            return ipv4(fields[4])
        }

        fun hasIpv4Host(offer: String) = offer.lineSequence().any { it.startsWith("a=candidate:") && hostIpv4(it) != null }

        fun assigned(address: String): Boolean = NetworkInterface.getNetworkInterfaces()?.toList()?.any { network ->
            network.isUp && network.inetAddresses.toList().any { it is Inet4Address && it.hostAddress == address }
        } == true
    }
}

/** Lazily chooses a preference from the actual audio offer, keeping the Router's locks and budgets intact. */
internal class PreferredBrowserRtcAudioPeer(
    override val slots: List<BrowserRtcAudioSlot>,
    private val policy: BrowserRtcAudioRoutePolicy,
    private val connected: () -> Boolean,
    private val onFailure: (String) -> Unit,
    private val factory: (String?, (String) -> Unit) -> BrowserRtcAudioBackend,
    private val assigned: (String) -> Boolean = BrowserRtcAudioRoutePolicy::assigned,
) : BrowserRtcAudioBackend {
    private val lock = Any()
    @Volatile private var closed = false
    @Volatile private var delegate: BrowserRtcAudioBackend? = null
    @Volatile private var attempt: BrowserRtcAudioRoutePolicy.Attempt? = null
    private var starting = false

    override fun answer(offer: String): String {
        synchronized(lock) { check(!closed && !starting && delegate == null) { "audio-peer-unavailable" }; starting = true }
        val selected = policy.begin(offer, connected, assigned)
        val live = synchronized(lock) {
            attempt = selected
            !closed
        }
        if (!live) { policy.retired(selected); error("audio-peer-unavailable") }
        val backend = try {
            factory(selected.address) { reason -> policy.failed(selected); if (!closed) onFailure(reason) }
        } catch (cause: Throwable) { policy.failed(selected); synchronized(lock) { starting = false }; throw cause }
        val installed = synchronized(lock) { starting = false; if (closed) false else { delegate = backend; true } }
        if (!installed) { policy.retired(selected); backend.close(); error("audio-peer-unavailable") }
        return try { backend.answer(offer) } catch (cause: Throwable) { policy.failed(selected); throw cause }
    }

    override fun ready(): Boolean {
        if (closed) return false
        val ready = delegate?.ready() == true
        if (ready) attempt?.let(policy::ready)
        return ready && !closed
    }

    override fun send(slot: String, payload: ByteArray, timestampUs: Double) {
        check(!closed) { "audio-peer-unavailable" }
        try { requireNotNull(delegate) { "audio-peer-unavailable" }.send(slot, payload, timestampUs) }
        catch (cause: Throwable) { attempt?.let(policy::failed); throw cause }
    }

    override fun snapshot(): Map<String, Any?> {
        ready()
        return delegate?.snapshot() ?: mapOf("ready" to false)
    }

    override fun close() {
        val old = synchronized(lock) { if (closed) return; closed = true; delegate to attempt }
        // Do not call native getters or failure callbacks under the policy lock.
        if (runCatching { old.first?.ready() == true }.getOrDefault(false)) {
            old.second?.let(policy::ready)
            old.second?.let(policy::retired)
        } else old.second?.let(policy::failed)
        old.first?.close()
    }
}
