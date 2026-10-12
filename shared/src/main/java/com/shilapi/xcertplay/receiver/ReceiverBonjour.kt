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
                      private val txtProvider: (() -> Map<String, String>)? = null) : Closeable {
    private val instances = linkedMapOf<String, JmDNS>()
    private var advertisedTxt: Map<String, String>? = null
    private var advertisedName: String? = null
    fun refresh(): Boolean {
        val current = configProvider?.invoke() ?: config
        val txt = txtProvider?.invoke() ?: current.txt
        if (advertisedTxt != txt || advertisedName != current.name) {
            BonjourMdnsCleanup.closeAll(instances.values.toList())
            instances.clear()
            advertisedTxt = txt
            advertisedName = current.name
        }
        val interfaces = NetworkInterface.getNetworkInterfaces().toList().filter {
            it.isUp && !it.isLoopback && it.supportsMulticast() && !it.name.startsWith("tun") && !it.name.startsWith("wg")
        }.flatMap { network -> network.interfaceAddresses.mapNotNull { bound ->
            val address = bound.address as? Inet4Address ?: return@mapNotNull null
            ReceiverDiscoveryInterfaces.Address(network.name, address, bound.networkPrefixLength)
        } }
        val addresses = ReceiverDiscoveryInterfaces.select(interfaces)
            .associateBy { "${it.physicalName}:${it.address.hostAddress}" }
        val retired = (instances.keys - addresses.keys).mapNotNull { instances.remove(it) }
        BonjourMdnsCleanup.closeAll(retired)
        for ((key, selected) in addresses) {
            if (key in instances) continue
            var dns: JmDNS? = null
            try {
                dns = JmDNS.create(selected.address, ReceiverDiscoveryInterfaces.hostname(current.deviceId, selected.physicalName))
                dns.registerService(ServiceInfo.create("_airplay._tcp.local.", current.name, port, 0, 0, txt))
                instances[key] = dns
            } catch (_: Exception) { dns?.let { BonjourMdnsCleanup.closeAll(listOf(it)) } }
        }
        return instances.isNotEmpty()
    }
    override fun close() { BonjourMdnsCleanup.closeAll(instances.values.toList()); instances.clear() }
}
