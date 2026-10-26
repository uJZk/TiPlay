package com.shilapi.xcertplay.receiver

import java.net.Inet4Address
import java.net.NetworkInterface

/** Apple Continuity AirPlay-target hint; media and service resolution still use IP/Bonjour. */
object ReceiverBluetoothBeacon {
    const val MANUFACTURER_ID = 0x004c

    // Observed AirPlay-target layout, not an Apple TV pairing/setup notification:
    // https://github.com/furiousMAC/continuity/blob/d9fa98bddafbfa3baafc84e37a417d78a0598546/messages/airplay_target.md
    fun payload(address: Inet4Address, configurationSeed: Int): ByteArray {
        require(configurationSeed in 0..255)
        require(!address.isAnyLocalAddress && !address.isLoopbackAddress && !address.isMulticastAddress)
        return byteArrayOf(0x09, 0x06, 0x03, configurationSeed.toByte()) + address.address
    }

    /** Prefer Wi-Fi to USB/Ethernet; never publish a VPN or the browser-only /32 alias. */
    fun localAddress(): Inet4Address? = runCatching {
        val candidates = NetworkInterface.getNetworkInterfaces().toList().filter {
            it.isUp && !it.isLoopback && it.supportsMulticast()
        }.flatMap { network -> network.interfaceAddresses.mapNotNull { bound ->
            val address = bound.address as? Inet4Address ?: return@mapNotNull null
            ReceiverDiscoveryInterfaces.Address(network.name, address, bound.networkPrefixLength)
        } }
        ReceiverDiscoveryInterfaces.select(candidates).minWithOrNull(
            compareBy<ReceiverDiscoveryInterfaces.Address> { !it.physicalName.startsWith("wlan") && !it.physicalName.startsWith("ap") }
                .thenBy { it.address.isLinkLocalAddress }
                .thenBy { it.physicalName }
        )?.address
    }.getOrNull()
}
