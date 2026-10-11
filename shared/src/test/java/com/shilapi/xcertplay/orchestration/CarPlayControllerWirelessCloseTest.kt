package com.shilapi.xcertplay.orchestration

import com.shilapi.xcertplay.airplay.AirPlayConfig
import com.shilapi.xcertplay.airplay.AirPlayDisplayConfig
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.AirPlayListenerIdentity
import com.shilapi.xcertplay.airplay.AirPlayMediaHandler
import com.shilapi.xcertplay.airplay.AirPlaySessionListener
import com.shilapi.xcertplay.airplay.PairingStore
import com.shilapi.xcertplay.network.CarPlayBonjour
import com.shilapi.xcertplay.network.CarPlayVpnService
import com.shilapi.xcertplay.transport.Iap2IdentificationConfig
import java.net.InetAddress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class CarPlayControllerWirelessCloseTest {
    @Test fun closesAirPlayBeforeBonjourAndStillCompletesDiscoveryCleanup() {
        val app = RuntimeEnvironment.getApplication()
        val config = AirPlayConfig("test", "test", "", "1", AirPlayDisplayConfig(800, 480), port = 0)
        val identity = AirPlayIdentity(ByteArray(32), ByteArray(32), "test")
        val owner = AirPlayListenerIdentity(1)
        val service = Robolectric.buildService(CarPlayVpnService::class.java).create().get()
        val bonjour = CarPlayBonjour(app, config, identity)
        val observations = mutableListOf<Pair<Boolean, Boolean>>()
        val listener = object : AirPlaySessionListener {
            override fun onDebugLog(message: String) {
                if (message.contains("teardown resource=AirPlay service ") ||
                    message.contains("teardown resource=Bonjour ")) {
                    observations += service.isAttached() to ReflectionHelpers.getField<Boolean>(bonjour, "closed")
                }
            }
        }
        val controller = CarPlayController(app,
            CarPlayRuntimeConfig(mfiTarget = MfiTarget.LOCAL, transport = CarPlayTransport.WIRELESS,
                headUnitIntegrations = false, identification = Iap2IdentificationConfig(
                    name = "test", modelIdentifier = "test", manufacturer = "test", serialNumber = "test",
                    firmwareVersion = "1", hardwareVersion = "1", carPlayUsbInterfaceNumber = 3)),
            config, identity, PairingStore(), listener, object : AirPlayMediaHandler {}, {})
        try {
            assertEquals(CarPlayVpnService.AttachResult.Started, service.attachWireless(
                InetAddress.getByName("127.0.0.1"), config, identity, PairingStore(), null,
                object : AirPlaySessionListener {}, object : AirPlayMediaHandler {}, listenerIdentity = owner))
            ReflectionHelpers.setField(controller, "vpnService", service)
            ReflectionHelpers.setField(controller, "bonjour", bonjour)
            ReflectionHelpers.setField(controller, "firstTcpWatchdog",
                FirstTcpWatchdog(owner, { _, _ -> {} }, {}))

            controller.close()
            assertTrue(controller.awaitClosed(2_000))
            // The listener is already gone while discovery cleanup has yet to begin.
            assertEquals(listOf(false to false, false to true), observations)
            assertFalse(service.isAttached())
            assertTrue(ReflectionHelpers.getField<Boolean>(bonjour, "closed"))
        } finally {
            controller.close()
            controller.awaitClosed(2_000)
            service.detach()
            bonjour.close()
        }
    }
}
