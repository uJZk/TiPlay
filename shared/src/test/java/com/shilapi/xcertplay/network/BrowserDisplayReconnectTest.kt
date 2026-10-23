package com.shilapi.xcertplay.network

import com.shilapi.xcertplay.airplay.AirPlayConfig
import com.shilapi.xcertplay.airplay.AirPlayDisplayConfig
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.AirPlayListenerIdentity
import com.shilapi.xcertplay.airplay.AirPlayMediaHandler
import com.shilapi.xcertplay.airplay.AirPlaySession
import com.shilapi.xcertplay.airplay.AirPlaySessionListener
import com.shilapi.xcertplay.airplay.PairingStore
import com.shilapi.xcertplay.airplay.CarPlayScreenBorrow
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketAddress
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class BrowserDisplayReconnectTest {
    private val config = AirPlayConfig("test", "test", "", "1", AirPlayDisplayConfig(800, 480), port = 0)
    private val identity = AirPlayIdentity(ByteArray(32), ByteArray(32), "test")

    @Test fun reconnectUpdatesOnlyTheNextDisplayAndKeepsListenerAndProbe() = withService { service, owner ->
        val source = session("192.0.2.2")
        val probe = session("127.0.0.1")
        sessions(service).addAll(listOf(source, probe))
        val port = service.boundPort()
        val display = config.main.copy(widthPixels = 1280, heightPixels = 720)
        val close = service.prepareWirelessDisplayReconnect(owner, display, source)
        assertNotNull(close)
        assertFalse(source.isClosed)
        assertEquals(display, attachmentConfig(service).main)
        assertEquals(config.main, ReflectionHelpers.getField<AirPlayConfig>(source, "config").main)
        close!!()
        assertTrue(source.isClosed)
        assertFalse(probe.isClosed)
        assertTrue(service.isAttached())
        assertEquals(port, service.boundPort())
        Socket(InetAddress.getByName("127.0.0.1"), port!!).close()
    }

    @Test fun staleOwnerAndInternalProbeCannotChangeTheOffer() = withService { service, owner ->
        val source = session("192.0.2.2")
        val probe = session("127.0.0.1")
        sessions(service).addAll(listOf(source, probe))
        val display = config.main.copy(widthPixels = 1280)
        assertNull(service.prepareWirelessDisplayReconnect(AirPlayListenerIdentity(2), display, source))
        assertNull(service.prepareWirelessDisplayReconnect(owner, display, probe))
        assertEquals(config.main, attachmentConfig(service).main)
        assertFalse(source.isClosed)
        assertFalse(probe.isClosed)
    }

    @Test fun resizeBurstsStopChangingTheOfferWhenAReplacementPhoneConnects() = withService { service, owner ->
        val source = session("192.0.2.2")
        sessions(service).add(source)
        service.prepareWirelessDisplayReconnect(owner, config.main.copy(widthPixels = 1000), source)!!()
        val latest = config.main.copy(widthPixels = 1280)
        assertTrue(service.updatePendingWirelessDisplay(owner, latest, source))
        sessions(service).add(session("192.0.2.2"))
        assertFalse(service.updatePendingWirelessDisplay(owner, config.main.copy(widthPixels = 1600), source))
        assertEquals(latest, attachmentConfig(service).main)
    }

    @Test fun missingReturnedScreenRetiresOnlyItsExternalSessionAndKeepsTheTransport() = withService { service, owner ->
        val source = session("192.0.2.2")
        val probe = session("127.0.0.1")
        sessions(service).addAll(listOf(source, probe))
        val borrow = ReflectionHelpers.getField<CarPlayScreenBorrow>(source, "screenBorrow")
        borrow.onModesChanged(mapOf("resources" to listOf(mapOf("resourceID" to 1, "entity" to 1))))
        val port = service.boundPort()
        val cleanup = service.prepareWirelessDisplayReconnect(owner, config.main, source, afterScreenLoan = true)
        assertNotNull(cleanup)
        assertTrue("Recovery claims the missing old stream before asynchronous cleanup", source.isClosed)
        cleanup!!()
        assertFalse(probe.isClosed)
        assertTrue(service.isAttached())
        assertEquals(port, service.boundPort())
    }

    @Test fun aNewMainScreenCannotBeRetiredByTheOldReturnRecovery() = withService { service, owner ->
        val source = session("192.0.2.2")
        sessions(service).add(source)
        val borrow = ReflectionHelpers.getField<CarPlayScreenBorrow>(source, "screenBorrow")
        borrow.onModesChanged(mapOf("resources" to listOf(mapOf("resourceID" to 1, "entity" to 1))))
        ReflectionHelpers.setField(source, "mainScreenToken", Any())
        assertNull(service.prepareWirelessDisplayReconnect(owner, config.main, source, afterScreenLoan = true))
        assertFalse(source.isClosed)
        assertNotNull(source.mainScreenSessionToken())
    }

    private fun withService(test: (CarPlayVpnService, AirPlayListenerIdentity) -> Unit) {
        val service = Robolectric.buildService(CarPlayVpnService::class.java).create().get()
        val owner = AirPlayListenerIdentity(1)
        assertEquals(CarPlayVpnService.AttachResult.Started, service.attachWireless(
            InetAddress.getByName("127.0.0.1"), config, identity, PairingStore(), null,
            object : AirPlaySessionListener {}, object : AirPlayMediaHandler {}, listenerIdentity = owner))
        try { test(service, owner) } finally { service.detach() }
    }

    private fun sessions(service: CarPlayVpnService): MutableSet<AirPlaySession> =
        ReflectionHelpers.getField(service, "sessions")

    private fun attachmentConfig(service: CarPlayVpnService): AirPlayConfig =
        ReflectionHelpers.getField(ReflectionHelpers.getField<Any>(service, "attachment"), "config")

    private fun session(address: String): AirPlaySession {
        val peer = InetAddress.getByName(address)
        val socket = object : Socket() {
            override fun getInetAddress(): InetAddress = peer
            override fun getLocalAddress(): InetAddress = InetAddress.getByName("127.0.0.1")
            override fun getRemoteSocketAddress(): SocketAddress = InetSocketAddress(peer, 12345)
        }
        return AirPlaySession(socket, config, identity, PairingStore(), null,
            object : AirPlaySessionListener {}, object : AirPlayMediaHandler {})
    }
}
