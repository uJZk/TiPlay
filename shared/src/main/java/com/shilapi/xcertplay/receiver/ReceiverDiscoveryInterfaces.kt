package com.shilapi.xcertplay.receiver

import java.net.Inet4Address

/** An extra hotspot address is a route for the car browser, not another Bonjour host. */
internal object ReceiverDiscoveryInterfaces {
    data class Address(val interfaceName: String, val address: Inet4Address, val prefixLength: Short) {
        val physicalName: String get() = interfaceName.substringBefore(':')
    }

    fun select(candidates: List<Address>): List<Address> = candidates.filter {
        val name = it.physicalName
        name.isNotBlank() && !name.startsWith("tun") && !name.startsWith("wg") &&
            !it.address.isAnyLocalAddress && !it.address.isLoopbackAddress && !it.address.isMulticastAddress
    }.groupBy { it.physicalName }.toSortedMap().values.map { addresses ->
        addresses.minWith(compareBy<Address> { it.prefixLength.toInt() == 32 }
            .thenBy { ':' in it.interfaceName }
            .thenBy { it.address.isLinkLocalAddress }
            .thenBy { it.address.hostAddress })
    }

    fun hostname(deviceId: String, interfaceName: String): String =
        "tiplay-airplay-${deviceId.replace(":", "")}-${interfaceName.substringBefore(':').replace(Regex("[^a-zA-Z0-9-]"), "-")}"
}
