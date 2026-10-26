package com.shilapi.xcertplay.receiver

import org.junit.Assert.*
import org.junit.Test
import java.net.Inet4Address
import java.net.InetAddress

class ReceiverBluetoothBeaconTest {
    private fun address(text: String) = InetAddress.getByName(text) as Inet4Address

    @Test fun targetHintUsesAppleContinuityTypeLengthAndNetworkByteOrder() {
        assertEquals(0x004c, ReceiverBluetoothBeacon.MANUFACTURER_ID)
        assertArrayEquals(byteArrayOf(0x09, 0x06, 0x03, 0xff.toByte(), 192.toByte(), 168.toByte(), 43, 1),
            ReceiverBluetoothBeacon.payload(address("192.168.43.1"), 255))
    }

    @Test fun neverAdvertisesAnUnusableEndpointOrTruncatesTheSeed() {
        for (text in listOf("0.0.0.0", "127.0.0.1", "224.0.0.1")) {
            assertThrows(IllegalArgumentException::class.java) { ReceiverBluetoothBeacon.payload(address(text), 1) }
        }
        for (seed in listOf(-1, 256)) {
            assertThrows(IllegalArgumentException::class.java) { ReceiverBluetoothBeacon.payload(address("192.168.43.1"), seed) }
        }
    }
}
