package com.shilapi.xcertplay.receiver

import java.net.Inet4Address
import java.net.InetAddress
import org.junit.Assert.*
import org.junit.Test

class ReceiverDiscoveryInterfacesTest {
    private fun address(name: String, ip: String, prefix: Int) = ReceiverDiscoveryInterfaces.Address(
        name, InetAddress.getByName(ip) as Inet4Address, prefix.toShort(),
    )

    @Test fun hotspotAliasAndPhysicalAddressAdvertiseOneReceiverOnThePhysicalSubnet() {
        val physical = address("wlan2", "10.244.51.156", 24)
        val linkLocal = address("wlan2", "169.254.220.253", 32)
        val alias = address("wlan2:tp", "100.64.1.2", 32)
        assertEquals(listOf(physical), ReceiverDiscoveryInterfaces.select(listOf(alias, linkLocal, physical)))
        assertEquals(listOf(physical), ReceiverDiscoveryInterfaces.select(listOf(physical, linkLocal, alias)))
    }

    @Test fun distinctPhysicalNetworksStayDiscoverableAndTunnelAddressesAreExcluded() {
        val hotspot = address("wlan2", "10.244.51.156", 24)
        val lan = address("wlan0", "192.168.1.20", 24)
        assertEquals(listOf(lan, hotspot), ReceiverDiscoveryInterfaces.select(listOf(
            hotspot, lan, address("tun0", "169.254.111.111", 32), address("wg0", "10.0.0.2", 24),
            address("lo", "127.0.0.1", 8), address("wlan3", "0.0.0.0", 0),
        )))
        assertNotEquals(ReceiverDiscoveryInterfaces.hostname("02:11:22:33:44:55", "wlan2"),
            ReceiverDiscoveryInterfaces.hostname("02:11:22:33:44:55", "wlan0"))
        assertEquals(ReceiverDiscoveryInterfaces.hostname("02:11:22:33:44:55", "wlan2"),
            ReceiverDiscoveryInterfaces.hostname("02:11:22:33:44:55", "wlan2:tp"))
    }

    @Test fun linkLocalOnlyPhysicalNetworksRemainSupported() {
        val physical = address("eth0", "169.254.4.5", 16)
        assertEquals(listOf(physical), ReceiverDiscoveryInterfaces.select(listOf(physical)))
    }
}
