package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.network.BonjourMdnsCleanup
import com.shilapi.xcertplay.network.BonjourCleanupPool
import java.io.Closeable
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.TimeUnit
import javax.jmdns.JmDNS
import javax.jmdns.ServiceInfo

/** Advertise on hotspot/LAN interfaces, including those created after the receiver starts. Worker-owned. */
class ReceiverBonjour(private val config: ReceiverConfig, private val port: Int,
                      private val configProvider: (() -> ReceiverConfig)? = null,
                      private val dacp: ReceiverDacpDiscovery? = null,
                      private val interfaceAddresses: () -> List<Pair<String, Inet4Address>> = ::localAddresses,
                      private val createDns: (Inet4Address, String) -> JmDNS = { address, hostname -> JmDNS.create(address, hostname) }) : Closeable {
    private data class Registry(val dns: JmDNS, val cleanup: BonjourCleanupPool.Reservation)
    private val instances = linkedMapOf<String, Registry>()
    private var closed = false
    private var advertisedTxt: Map<String, String>? = null
    private var advertisedName: String? = null
    private var advertisedRaopTxt: Map<String, String>? = null
    private var advertisedRaopName: String? = null
    fun refresh(): Boolean {
        if (closed) return false
        val current = configProvider?.invoke() ?: config
        val txt = current.txt
        val raopTxt = current.raopTxt
        val raopName = current.raopName
        if (advertisedTxt != txt || advertisedName != current.name ||
            advertisedRaopTxt != raopTxt || advertisedRaopName != raopName) {
            retire(instances.values.toList())
            instances.clear()
            advertisedTxt = txt
            advertisedName = current.name
            advertisedRaopTxt = raopTxt
            advertisedRaopName = raopName
        }
        val addresses = interfaceAddresses().associateBy { (name, address) -> "$name:${address.hostAddress}" }
        val retired = (instances.keys - addresses.keys).mapNotNull { instances.remove(it) }
        retire(retired)
        for ((key, selected) in addresses) {
            if (key in instances) continue
            // Reserve before an opaque create call, so even its late result has cleanup capacity.
            val cleanup = BonjourMdnsCleanup.reserve("receiver:${selected.second.hostAddress}") ?: continue
            var attached = false
            try {
                val dns = createDns(selected.second, ReceiverDiscoveryInterfaces.hostname(current.deviceId, selected.first))
                cleanup.attach(AutoCloseable { try { dacp?.detach(dns) } finally { dns.close() } })
                attached = true
                cleanup.use {
                    dns.registerService(ServiceInfo.create("_airplay._tcp.local.", current.name, port, 0, 0, txt))
                    if (raopTxt["cn"].orEmpty().isNotEmpty()) {
                        dns.registerService(ServiceInfo.create("_raop._tcp.local.", raopName, port, 0, 0, raopTxt))
                    }
                    dacp?.attach(dns)
                }
                instances[key] = Registry(dns, cleanup)
            } catch (_: Exception) {
                if (attached) cleanup.requestClose() else cleanup.abandon()
            }
        }
        return instances.isNotEmpty()
    }
    private fun retire(resources: List<Registry>) {
        resources.forEach { it.cleanup.requestClose() }
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(2_000)
        resources.forEach {
            val remaining = TimeUnit.NANOSECONDS.toMillis((deadline - System.nanoTime()).coerceAtLeast(0))
            it.cleanup.await(remaining)
        }
        // Timed-out/failed registries remain strongly owned by the bounded pool, including their
        // address keys; subsequent refreshes fast-fail until the old goodbye has safely completed.
    }
    override fun close() { closed = true; retire(instances.values.toList()); instances.clear() }

    companion object {
        private fun localAddresses(): List<Pair<String, Inet4Address>> {
            val interfaces = NetworkInterface.getNetworkInterfaces().toList().filter {
                it.isUp && !it.isLoopback && it.supportsMulticast() && !it.name.startsWith("tun") && !it.name.startsWith("wg")
            }.flatMap { network -> network.interfaceAddresses.mapNotNull { bound ->
                val address = bound.address as? Inet4Address ?: return@mapNotNull null
                ReceiverDiscoveryInterfaces.Address(network.name, address, bound.networkPrefixLength)
            } }
            return ReceiverDiscoveryInterfaces.select(interfaces).map { it.physicalName to it.address }
        }
    }
}
