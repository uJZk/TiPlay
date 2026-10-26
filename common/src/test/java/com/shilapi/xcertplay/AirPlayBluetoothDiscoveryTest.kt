package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test
import java.net.Inet4Address
import java.net.InetAddress

class AirPlayBluetoothDiscoveryTest {
    private class Radio : AirPlayBluetoothDiscovery.Radio {
        var unavailable: String? = null
        var failure: Exception? = null
        val starts = mutableListOf<ByteArray>()
        val callbacks = mutableListOf<(Int?) -> Unit>()
        var stops = 0
        override fun unavailableReason() = unavailable
        override fun start(payload: ByteArray, completion: (Int?) -> Unit) {
            starts += payload.copyOf()
            callbacks += completion
            failure?.let { throw it }
        }
        override fun stop() { stops++ }
    }

    private fun address(text: String) = InetAddress.getByName(text) as Inet4Address

    @Test fun stableDiscoveryUsesOneAdvertiserAndReplacesChangedEndpoints() {
        val radio = Radio()
        var endpoint = address("192.168.43.1")
        val discovery = AirPlayBluetoothDiscovery({}, radio) { endpoint }
        discovery.refresh("features=1")
        radio.callbacks.last()(null)
        repeat(4) { discovery.refresh("features=1") }
        assertEquals(1, radio.starts.size)
        endpoint = address("192.168.1.10")
        discovery.refresh("features=1")
        assertEquals(2, radio.starts.size)
        assertEquals(1, radio.stops)
        assertFalse(radio.starts[0].contentEquals(radio.starts[1]))
        assertNotEquals(radio.starts[0][3], radio.starts[1][3])
        discovery.refresh("features=2")
        assertEquals(3, radio.starts.size)
        assertEquals(2, radio.stops)
        discovery.close()
        assertEquals(3, radio.stops)
    }

    @Test fun revokedPermissionAndLostNetworkStopAdvertisingAndRecoverOnRefresh() {
        val radio = Radio()
        var endpoint: Inet4Address? = address("192.168.43.1")
        val states = mutableListOf<String>()
        val discovery = AirPlayBluetoothDiscovery(states::add, radio) { endpoint }
        discovery.refresh("1")
        radio.unavailable = "permission"
        discovery.refresh("1")
        assertEquals(1, radio.stops)
        assertTrue(states.last().endsWith("=permission"))
        radio.unavailable = null
        endpoint = null
        discovery.refresh("1")
        assertEquals(1, radio.starts.size)
        assertTrue(states.last().endsWith("=no-network"))
        endpoint = address("192.168.43.1")
        discovery.refresh("1")
        assertEquals(2, radio.starts.size)
        discovery.close()
    }

    @Test fun delayedFailureCannotStopAReplacementAndDestroyedInstanceNeverRestarts() {
        val radio = Radio()
        val states = mutableListOf<String>()
        val discovery = AirPlayBluetoothDiscovery(states::add, radio) { address("192.168.43.1") }
        discovery.refresh("1")
        discovery.refresh("2")
        radio.callbacks[0](4)
        radio.callbacks[1](null)
        assertEquals(1, radio.stops)
        assertTrue(states.last().endsWith("=advertising"))
        discovery.close()
        val count = states.size
        radio.callbacks[1](4)
        discovery.refresh("3")
        discovery.close()
        assertEquals(count, states.size)
        assertEquals(2, radio.starts.size)
        assertEquals(2, radio.stops)
    }

    @Test fun startFailureReleasesSlotAndRetriesOnlyOnNextRefresh() {
        val radio = Radio()
        val discovery = AirPlayBluetoothDiscovery({}, radio) { address("192.168.43.1") }
        discovery.refresh("1")
        radio.callbacks.last()(2)
        assertEquals(1, radio.starts.size)
        assertEquals(1, radio.stops)
        discovery.refresh("1")
        assertEquals(2, radio.starts.size)
        radio.callbacks.last()(null)
        discovery.close()
    }

    @Test fun permissionRevokedBetweenCheckAndStartDoesNotEscapeToReceiver() {
        val radio = Radio().apply { failure = SecurityException() }
        val states = mutableListOf<String>()
        val discovery = AirPlayBluetoothDiscovery(states::add, radio) { address("192.168.43.1") }
        discovery.refresh("1")
        assertTrue(states.last().endsWith("=permission"))
        assertEquals(1, radio.stops)
        discovery.close()
    }
}
