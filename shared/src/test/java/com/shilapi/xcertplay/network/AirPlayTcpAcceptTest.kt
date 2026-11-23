package com.shilapi.xcertplay.network

import com.shilapi.xcertplay.airplay.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.net.InetAddress
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class AirPlayTcpAcceptTest {
    @Test fun bothAddressFamiliesReportOwnerAndOldCleanupPreservesNewListener() {
        val service = Robolectric.buildService(CarPlayVpnService::class.java).create().get()
        val received = LinkedBlockingQueue<AirPlayTcpAccepted>()
        val address = InetAddress.getByName("127.0.0.1")
        val addresses = listOf(address, InetAddress.getByName("::1"))
        val config = AirPlayConfig("test", "test", "", "1", AirPlayDisplayConfig(800, 480), port = 0)
        fun attach(owner: AirPlayListenerIdentity) {
            assertEquals(CarPlayVpnService.AttachResult.Started, service.attachWireless(address, config,
                AirPlayIdentity(ByteArray(32), ByteArray(32), "test"), PairingStore(), null,
                object : AirPlaySessionListener {
                    override fun onTcpAccepted(event: AirPlayTcpAccepted) { received.add(event) }
                }, object : AirPlayMediaHandler {},
                additionalBindAddresses = addresses.drop(1), listenerIdentity = owner))
        }
        try {
            val old = AirPlayListenerIdentity(1)
            attach(old)
            addresses.forEach { peer ->
                Socket(peer, service.boundPort()!!).use {
                    val event = received.poll(2, TimeUnit.SECONDS)!!
                    assertSame(old, event.listener)
                    assertTrue(event.internal)
                    assertTrue(event.acceptedAtNanos > 0)
                }
            }
            val current = AirPlayListenerIdentity(2)
            attach(current)
            service.detachWireless(old)
            assertTrue(service.isAttached())
            addresses.forEach { peer ->
                Socket(peer, service.boundPort()!!).use {
                    assertSame(current, received.poll(2, TimeUnit.SECONDS)!!.listener)
                }
            }
            service.detachWireless(current)
            assertFalse(service.isAttached())
        } finally { service.detach() }
    }

    @Test fun remotePhoneAddressIsExternal() {
        assertFalse(isInternalAirPlayPeer(InetAddress.getByName("192.0.2.12"), InetAddress.getByName("192.0.2.1")))
    }

    @Test fun aSessionRetiredBeforeItsControlThreadStartsSkipsSocketInitialization() {
        val initializationCalls = AtomicInteger()
        val ended = AtomicInteger()
        val controlFinished = CountDownLatch(1)
        val socket = object : Socket() {
            override fun setKeepAlive(enabled: Boolean) {
                initializationCalls.incrementAndGet()
                super.setKeepAlive(enabled)
            }
        }
        val session = AirPlaySession(socket,
            AirPlayConfig("test", "test", "", "1", AirPlayDisplayConfig(800, 480)),
            AirPlayIdentity(ByteArray(32), ByteArray(32), "test"), PairingStore(), null,
            object : AirPlaySessionListener {
                override fun onSessionEnded(session: AirPlaySession) { ended.incrementAndGet() }
                override fun onDebugLog(message: String) {
                    if (message.startsWith("airplay control closing reason=")) controlFinished.countDown()
                }
            }, object : AirPlayMediaHandler {})
        session.close()
        session.start()
        assertTrue(controlFinished.await(2, TimeUnit.SECONDS))
        assertEquals(0, initializationCalls.get())
        assertEquals(1, ended.get())
        assertTrue(session.isClosed)
    }

    @Test fun socketInitializationFailureStillClosesTheControlSession() {
        val ended = CountDownLatch(1)
        val socket = Socket().apply { close() }
        val session = AirPlaySession(socket,
            AirPlayConfig("test", "test", "", "1", AirPlayDisplayConfig(800, 480)),
            AirPlayIdentity(ByteArray(32), ByteArray(32), "test"), PairingStore(), null,
            object : AirPlaySessionListener {
                override fun onSessionEnded(session: AirPlaySession) { ended.countDown() }
            }, object : AirPlayMediaHandler {})
        session.start()
        assertTrue(ended.await(2, TimeUnit.SECONDS))
        assertTrue(session.isClosed)
    }
}
