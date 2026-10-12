package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.network.BonjourMdnsCleanup
import java.io.Closeable
import java.net.Inet4Address
import java.net.NetworkInterface
import javax.jmdns.JmDNS
import javax.jmdns.ServiceInfo

/** Advertise on hotspot/LAN interfaces, including those created after the receiver starts. Worker-owned. */
class ReceiverBonjour(private val config: ReceiverConfig, private val port: Int) : Closeable {
    private val instances = linkedMapOf<String, JmDNS>()
    fun refresh(): Boolean {
        val addresses = NetworkInterface.getNetworkInterfaces().toList().filter {
            it.isUp && !it.isLoopback && it.supportsMulticast() && !it.name.startsWith("tun") && !it.name.startsWith("wg")
        }.flatMap { it.inetAddresses.toList() }.filterIsInstance<Inet4Address>()
            .filter { !it.isLoopbackAddress && !it.isAnyLocalAddress }.associateBy { it.hostAddress!! }
        val retired = (instances.keys - addresses.keys).mapNotNull { instances.remove(it) }
        BonjourMdnsCleanup.closeAll(retired)
        for ((key, address) in addresses) {
            if (key in instances) continue
            var dns: JmDNS? = null
            try {
                dns = JmDNS.create(address, "tiplay-airplay-${config.deviceId.replace(":", "")}")
                dns.registerService(ServiceInfo.create("_airplay._tcp.local.", config.name, port, 0, 0, config.txt))
                instances[key] = dns
            } catch (_: Exception) { dns?.let { BonjourMdnsCleanup.closeAll(listOf(it)) } }
        }
        return instances.isNotEmpty()
    }
    override fun close() { BonjourMdnsCleanup.closeAll(instances.values.toList()); instances.clear() }
}
