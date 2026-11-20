package com.shilapi.xcertplay

import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.receiver.ReceiverConfig
import com.shilapi.xcertplay.receiver.ReceiverMirrorExperiment
import com.shilapi.xcertplay.receiver.ReceiverServer
import java.lang.reflect.Proxy
import java.net.InetAddress
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class AirPlayReceiverExperimentServiceTest {
    /** Exercise the actual discovery refresh policy with an already running advertiser. */
    @Test fun noBleModeStopsAnExistingAdvertiserAndLaterRefreshCannotRestartIt() {
        val service = Robolectric.buildService(AirPlayReceiverService::class.java).get()
        val listener = Proxy.newProxyInstance(javaClass.classLoader, arrayOf(ReceiverServer.Listener::class.java)) { _, _, _ -> null }
            as ReceiverServer.Listener
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(),
            mirrorExperiment = ReceiverMirrorExperiment.NO_BLE), listener,
            fairPlayReply = { null }, fairPlayDecrypt = { _, _ -> null })
        var starts = 0
        var stops = 0
        val advertiser = AirPlayBluetoothDiscovery({}, object : AirPlayBluetoothDiscovery.Radio {
            override fun unavailableReason(): String? = null
            override fun start(payload: ByteArray, completion: (Int?) -> Unit) { starts++; completion(null) }
            override fun stop() { stops++ }
        }, { InetAddress.getByName("192.168.43.1") as java.net.Inet4Address })
        advertiser.refresh("old-profile")
        field("server").set(service, receiver)
        field("bluetoothDiscovery").set(service, advertiser)
        val refresh = AirPlayReceiverService::class.java.getDeclaredMethod("refreshDiscovery").apply { isAccessible = true }
        try {
            repeat(2) { refresh.invoke(service) }
            assertEquals(1, starts)
            assertEquals(1, stops)
            assertNull(field("bluetoothDiscovery").get(service))
            assertSame(receiver, field("server").get(service))
            assertEquals(ReceiverMirrorExperiment.NO_BLE, receiver.displayConfig.mirrorExperiment)
        } finally {
            advertiser.close()
            receiver.close()
        }
    }

    private fun field(name: String) = AirPlayReceiverService::class.java.getDeclaredField(name).apply { isAccessible = true }
}
