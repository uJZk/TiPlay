package com.shilapi.xcertplay.network

import com.shilapi.xcertplay.airplay.AirPlayConfig
import com.shilapi.xcertplay.airplay.AirPlayDisplayConfig
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.AirPlayListenerIdentity
import com.shilapi.xcertplay.airplay.AirPlayMediaHandler
import com.shilapi.xcertplay.airplay.AirPlaySessionListener
import com.shilapi.xcertplay.airplay.AirPlayTcpAccepted
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.PairingStore
import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.receiver.ReceiverConfig
import com.shilapi.xcertplay.receiver.ReceiverPlay
import com.shilapi.xcertplay.receiver.ReceiverPlayback
import com.shilapi.xcertplay.receiver.ReceiverServer
import com.shilapi.xcertplay.receiver.UnifiedAirPlayTrial
import com.shilapi.xcertplay.receiver.readReceiverRequest
import com.shilapi.xcertplay.web.WebMediaSink
import java.io.Closeable
import java.net.ConnectException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], manifest = Config.NONE)
class UnifiedAirPlayEndpointTest {
    @Test fun ordinarySocketsSurviveCarPlayAttachAndDetachOnTheSameEntry() = Fixture().use { fixture ->
        fixture.connect().use { idleOrdinary ->
            assertArrayEquals(fixture.identity.publicKey, idleOrdinary.request("POST", "/pair-setup", ByteArray(32)).body)
            fixture.lease().use { carPlayLease ->
                assertEquals(fixture.port, carPlayLease.port)
                fixture.connect().use { carPlay ->
                    assertEquals("400", carPlay.request("POST", "/auth-setup").path)
                    assertEquals(1, fixture.accepted.get())
                    fixture.connect().use { activeOrdinary ->
                        assertEquals("200", activeOrdinary.request("POST", "/pair-setup", ByteArray(32)).path)
                        assertEquals(1, fixture.accepted.get())
                        carPlayLease.close()
                        assertNull(readReceiverRequest(carPlay.getInputStream()))
                        assertSame(fixture.entry, UnifiedAirPlayEndpoint.current)
                        assertEquals("200", idleOrdinary.request("OPTIONS", "/").path)
                        assertEquals("200", activeOrdinary.request("OPTIONS", "/").path)
                        assertEquals(fixture.carPlay.deviceId, activeOrdinary.info()["deviceID"])
                    }
                }
            }
        }
        fixture.release(fixture.receiver)
        fixture.assertEntryStopped()
    }

    @Test fun disablingOrdinaryPreservesCarPlayAndReenableUsesTheReplacementBackend() = Fixture().use { fixture ->
        fixture.lease().use { carPlayLease ->
            fixture.connect().use { carPlay ->
                assertEquals("400", carPlay.request("POST", "/auth-setup").path)
                fixture.connect().use { ordinary ->
                    assertEquals("200", ordinary.request("POST", "/pair-setup", ByteArray(32)).path)
                    fixture.release(fixture.receiver)
                    assertNull(readReceiverRequest(ordinary.getInputStream()))
                    assertSame(fixture.entry, UnifiedAirPlayEndpoint.current)
                    assertEquals("200", carPlay.request("OPTIONS", "/").path)
                    val replacementConfig = fixture.receiverConfig.copy(fps = 30)
                    val replacement = fixture.newReceiver(replacementConfig)
                    UnifiedAirPlayTrial.install(replacement, replacementConfig)
                    assertSame(fixture.entry, UnifiedAirPlayEndpoint.acquire(replacement, replacementConfig,
                        RuntimeEnvironment.getApplication()) {})
                    assertEquals(fixture.port, carPlayLease.port)
                    fixture.connect().use { newOrdinary ->
                        assertEquals("200", newOrdinary.request("POST", "/pair-setup", ByteArray(32)).path)
                        val display = (newOrdinary.info()["displays"] as List<*>).single() as Map<*, *>
                        assertEquals(30L, (display["maxFPS"] as Number).toLong())
                        fixture.entry.releaseReceiver(fixture.receiver)
                        assertEquals("200", newOrdinary.request("OPTIONS", "/").path)
                        assertEquals("200", carPlay.request("OPTIONS", "/").path)
                        carPlayLease.close()
                        assertNull(readReceiverRequest(carPlay.getInputStream()))
                        assertEquals("200", newOrdinary.request("OPTIONS", "/").path)
                        fixture.release(replacement)
                        assertNull(readReceiverRequest(newOrdinary.getInputStream()))
                    }
                }
            }
        }
        fixture.assertEntryStopped()
    }

    @Test fun inFlightCarPlayAcquisitionKeepsThePortWhenTheLastOrdinaryLeaseReleases() = Fixture().use { fixture ->
        val reserved = UnifiedAirPlayEndpoint.acquireCarPlay(fixture.carPlay, fixture.identity,
            RuntimeEnvironment.getApplication()) {}
        val token = Any()
        try {
            fixture.release(fixture.receiver)
            assertSame(fixture.entry, UnifiedAirPlayEndpoint.current)
            assertEquals(fixture.port, reserved.attach(token, fixture.carPlay, fixture.identity, PairingStore(),
                null, fixture.listener, fixture.media, AirPlayListenerIdentity(1)))
        } finally {
            reserved.releaseAttachReservation()
        }
        fixture.connect().use { carPlay ->
            assertEquals("400", carPlay.request("POST", "/auth-setup").path)
            assertEquals("200", carPlay.request("OPTIONS", "/").path)
            reserved.detach(token)
            assertNull(readReceiverRequest(carPlay.getInputStream()))
        }
        fixture.assertEntryStopped()
    }

    private class Fixture : Closeable {
        val identity = AirPlayIdentity(ByteArray(32) { 1 }, ByteArray(32) { 2 }, "lease-test")
        val receiverConfig = ReceiverConfig("TiPlay", "02:11:22:33:44:55", identity)
        val carPlay = AirPlayConfig("TiPlay", "02:66:77:88:99:AA", receiverConfig.deviceId, "220.68",
            AirPlayDisplayConfig(1920, 1080), audioViaCarBluetooth = true)
        private val receivers = mutableListOf<ReceiverServer>()
        val receiver = newReceiver(receiverConfig)
        val accepted = AtomicInteger()
        val listener = object : AirPlaySessionListener {
            override fun onTcpAccepted(event: AirPlayTcpAccepted) { accepted.incrementAndGet() }
        }
        val media = object : AirPlayMediaHandler {}
        val entry = UnifiedAirPlayEndpoint(receiver, receiverConfig, RuntimeEnvironment.getApplication()) {}
        val port: Int

        init {
            UnifiedAirPlayTrial.configure(true)
            UnifiedAirPlayTrial.install(receiver, receiverConfig)
            port = entry.start(0)
        }

        fun newReceiver(config: ReceiverConfig): ReceiverServer = ReceiverServer(config, object : ReceiverServer.Listener {
            override fun mirrorSink(): WebMediaSink = error("These lifecycle tests open no media streams")
            override fun play(item: ReceiverPlay) = Unit
            override fun stopPlayback() = Unit
            override fun seek(seconds: Double) = Unit
            override fun rate(value: Double) = Unit
            override fun playback() = ReceiverPlayback()
            override fun status(state: String) = Unit
        }).also { receivers.add(it) }

        fun connect() = Socket(InetAddress.getByName("127.0.0.1"), port).apply { soTimeout = 5000 }
        fun lease() = UnifiedAirPlayWirelessLease(carPlay.copy(port = port), identity, PairingStore(), null,
            listener, media, AirPlayListenerIdentity(1), RuntimeEnvironment.getApplication())

        fun release(receiver: ReceiverServer) {
            UnifiedAirPlayTrial.remove(receiver)
            entry.releaseReceiver(receiver)
            receiver.close()
        }

        fun assertEntryStopped() {
            assertNull(UnifiedAirPlayEndpoint.current)
            val deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(1)
            // JDK pre-closes a socket with an in-flight accept; its descriptor is released
            // when that operation exits. Check the eventual port release, not thread scheduling.
            while (System.nanoTime() < deadline) {
                Socket().use { probe ->
                    try { probe.connect(InetSocketAddress("127.0.0.1", port), 200) }
                    catch (_: ConnectException) { return }
                }
                Thread.sleep(10)
            }
            fail("The last lease must close the listening socket")
        }

        override fun close() {
            try { entry.close() }
            finally {
                receivers.forEach { UnifiedAirPlayTrial.remove(it); it.close() }
                UnifiedAirPlayTrial.configure(false)
            }
        }
    }

    private companion object {
        fun Socket.request(method: String, path: String, body: ByteArray = ByteArray(0)): RtspMessage.Request {
            getOutputStream().write(("$method $path RTSP/1.0\r\nCSeq: 1\r\nContent-Length: ${body.size}\r\n\r\n")
                .toByteArray() + body)
            return requireNotNull(readReceiverRequest(getInputStream()))
        }

        fun Socket.info(): Map<*, *> {
            val response = request("GET", "/info")
            assertEquals("200", response.path)
            return BplistCodec.decode(response.body) as Map<*, *>
        }
    }
}
