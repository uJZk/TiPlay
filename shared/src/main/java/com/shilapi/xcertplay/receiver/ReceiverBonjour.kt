package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.network.BonjourMdnsCleanup
import java.io.Closeable
import java.net.Inet4Address
import java.net.NetworkInterface
import javax.jmdns.JmDNS
import javax.jmdns.ServiceInfo

/** Advertise on hotspot/LAN interfaces, including those created after the receiver starts. Worker-owned. */
class ReceiverBonjour(private val config: ReceiverConfig, private val port: Int,
                      private val configProvider: (() -> ReceiverConfig)? = null,
                      private val dacp: ReceiverDacpDiscovery? = null,
                      private val interfaceAddresses: () -> List<Pair<String, Inet4Address>> = ::localAddresses,
                      private val createDns: (Inet4Address, String) -> JmDNS = { address, hostname -> JmDNS.create(address, hostname) }) : Closeable {
    private val instances = linkedMapOf<String, JmDNS>()
    private var advertisedTxt: Map<String, String>? = null
    private var advertisedName: String? = null
    private var advertisedRaopTxt: Map<String, String>? = null
    private var advertisedRaopName: String? = null
    fun refresh(): Boolean {
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
            var dns: JmDNS? = null
            try {
                dns = createDns(selected.second, ReceiverDiscoveryInterfaces.hostname(current.deviceId, selected.first))
                dns.registerService(ServiceInfo.create("_airplay._tcp.local.", current.name, port, 0, 0, txt))
                if (raopTxt["cn"].orEmpty().isNotEmpty()) {
                    dns.registerService(ServiceInfo.create("_raop._tcp.local.", raopName, port, 0, 0, raopTxt))
                }
                instances[key] = dns
                dacp?.attach(dns)
            } catch (_: Exception) { dns?.let { retire(listOf(it)) } }
        }
        return instances.isNotEmpty()
    }
    private fun retire(resources: List<JmDNS>) {
        resources.forEach { dacp?.detach(it) }
        BonjourMdnsCleanup.closeAll(resources)
    }
    override fun close() { retire(instances.values.toList()); instances.clear() }

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
