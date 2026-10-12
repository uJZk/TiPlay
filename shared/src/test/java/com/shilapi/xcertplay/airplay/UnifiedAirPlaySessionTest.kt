package com.shilapi.xcertplay.airplay

import com.shilapi.xcertplay.receiver.ReceiverConfig
import com.shilapi.xcertplay.receiver.ReceiverPlay
import com.shilapi.xcertplay.receiver.ReceiverPlayback
import com.shilapi.xcertplay.receiver.ReceiverServer
import com.shilapi.xcertplay.receiver.UnifiedAirPlayTrial
import com.shilapi.xcertplay.receiver.readReceiverRequest
import com.shilapi.xcertplay.web.WebMediaSink
import com.shilapi.xcertplay.web.WebVideoHub
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], manifest = Config.NONE)
class UnifiedAirPlaySessionTest {
    @Test fun ordinaryRequestsUseSharedIdentityWithoutCarPlayMediaOrActiveCallbacks() = withSession(true) { fixture ->
        val pairing = fixture.client.request("POST", "/pair-setup", ByteArray(32))
        assertEquals("200", pairing.path)
        assertArrayEquals(fixture.identity.publicKey, pairing.body)
        val info = fixture.info()
        assertEquals("TiPlay", info["name"])
        assertEquals(fixture.config.deviceId, info["deviceID"])
        assertEquals(fixture.config.deviceId, info["macAddress"])
        assertArrayEquals(fixture.identity.publicKey, info["pk"] as ByteArray)
        assertEquals(fixture.identity.pairingId, info["pi"])
        assertEquals(fixture.receiverConfig.features,
            (info["features"] as Number).toLong())
        assertEquals(fixture.receiverConfig.info()["audioFormats"], info["audioFormats"])
        val qualified = fixture.client.request("GET", "/info", BplistCodec.encode(mapOf("qualifier" to listOf("txtAirPlay"))))
        val txt = (BplistCodec.decode(qualified.body) as Map<*, *>)["txtAirPlay"] as ByteArray
        val values = mutableMapOf<String, String>()
        var at = 0
        while (at < txt.size) {
            val length = txt[at++].toInt() and 0xff
            val entry = txt.copyOfRange(at, at + length).toString(Charsets.UTF_8)
            values[entry.substringBefore('=')] = entry.substringAfter('=')
            at += length
        }
        val featureParts = values.getValue("features").split(',').map { it.removePrefix("0x").toLong(16) }
        val embeddedFeatures = featureParts[0] or (featureParts.getOrElse(1) { 0L } shl 32)
        assertEquals((info["features"] as Number).toLong(), embeddedFeatures)
        assertEquals(fixture.config.deviceId, values["deviceid"])
        val serverInfo = fixture.client.request("GET", "/server-info").body.toString(Charsets.UTF_8)
        assertTrue(serverInfo.contains("<key>deviceid</key><string>${fixture.config.deviceId}</string>"))
        assertEquals("200", fixture.client.request("RECORD", "/").path)
        assertEquals(0, fixture.active.get())
        assertTrue(fixture.session.isUnifiedOrdinary)
        assertEquals("200", fixture.client.request("TEARDOWN", "/").path)
        assertNull(readReceiverRequest(fixture.client.getInputStream()))
        assertTrue(fixture.ended.await(5, TimeUnit.SECONDS))
        assertEquals(0, fixture.mediaClosed.get())
        assertEquals(1, fixture.endedCount.get())
    }

    @Test fun disabledTrialKeepsCarBluetoothInfoAndDoesNotRouteLegacyPairing() = withSession(false) { fixture ->
        assertFalse(fixture.info().containsKey("audioFormats"))
        val pairing = fixture.client.request("POST", "/pair-setup", ByteArray(32))
        assertFalse(pairing.body.contentEquals(fixture.identity.publicKey))
        val info = fixture.info()
        assertFalse(info.containsKey("audioFormats"))
        assertEquals(fixture.config.deviceName, info["name"])
        assertEquals(AirPlayInfoPlist.features(fixture.config), (info["features"] as Number).toLong())
        assertFalse(fixture.session.isUnifiedOrdinary)
        fixture.client.close()
        assertTrue(fixture.ended.await(5, TimeUnit.SECONDS))
        assertEquals(1, fixture.mediaClosed.get())
    }

    @Test fun authSetupLocksCarPlayDialectAgainstLaterLegacyPairingOnTheSameSocket() = withSession(true) { fixture ->
        assertEquals("400", fixture.client.request("POST", "/auth-setup").path)
        assertFalse(fixture.info().containsKey("audioFormats"))
        val pairing = fixture.client.request("POST", "/pair-setup", ByteArray(32))
        assertFalse(pairing.body.contentEquals(fixture.identity.publicKey))
        val info = fixture.info()
        assertFalse(info.containsKey("audioFormats"))
        assertEquals("TiPlay", info["name"])
        assertEquals(AirPlayInfoPlist.features(fixture.config) or fixture.receiverConfig.features,
            (info["features"] as Number).toLong())
        assertFalse(fixture.session.isUnifiedOrdinary)
        fixture.client.close()
        assertTrue(fixture.ended.await(5, TimeUnit.SECONDS))
        assertEquals(1, fixture.mediaClosed.get())
    }

    private class Fixture(val client: Socket, val identity: AirPlayIdentity, val config: AirPlayConfig,
                          val receiverConfig: ReceiverConfig) {
        val active = AtomicInteger()
        val mediaClosed = AtomicInteger()
        val endedCount = AtomicInteger()
        val ended = CountDownLatch(1)
        lateinit var session: AirPlaySession
        fun info(): Map<*, *> {
            val reply = client.request("GET", "/info")
            assertEquals("200", reply.path)
            return BplistCodec.decode(reply.body) as Map<*, *>
        }
    }

    private fun withSession(enabled: Boolean, block: (Fixture) -> Unit) {
        val identity = AirPlayIdentity.generate()
        val deviceId = "02:11:22:33:44:55"
        val advertisedDeviceId = if (enabled) "02:66:77:88:99:AA" else deviceId
        val config = AirPlayConfig("TiPlay", advertisedDeviceId, deviceId, "220.68",
            AirPlayDisplayConfig(1920, 1080), audioViaCarBluetooth = true)
        val receiverConfig = ReceiverConfig(if (enabled) "TiPlay" else "TiPlay AirPlay", deviceId, identity)
        val receiver = ReceiverServer(receiverConfig, object : ReceiverServer.Listener {
            override fun mirrorSink() = WebMediaSink(WebVideoHub(), 1920, 1080, 60)
            override fun play(item: ReceiverPlay) {}
            override fun stopPlayback() {}
            override fun seek(seconds: Double) {}
            override fun rate(value: Double) {}
            override fun playback() = ReceiverPlayback()
            override fun status(state: String) {}
        }, fairPlayReply = { ByteArray(32) }, fairPlayDecrypt = { _, _ -> ByteArray(16) })
        UnifiedAirPlayTrial.configure(enabled)
        UnifiedAirPlayTrial.install(receiver, receiverConfig)
        try {
            ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { server ->
                Socket(InetAddress.getByName("127.0.0.1"), server.localPort).use { client ->
                    client.soTimeout = 5000
                    val fixture = Fixture(client, identity, config, receiverConfig)
                    val session = AirPlaySession(server.accept(), config, identity, PairingStore(), null,
                        object : AirPlaySessionListener {
                            override fun onSessionActive(session: AirPlaySession) { fixture.active.incrementAndGet() }
                            override fun onSessionEnded(session: AirPlaySession) {
                                fixture.endedCount.incrementAndGet()
                                fixture.ended.countDown()
                            }
                        }, object : AirPlayMediaHandler {
                            override fun onSessionClosed(session: AirPlaySession) { fixture.mediaClosed.incrementAndGet() }
                        })
                    fixture.session = session
                    session.start()
                    try { block(fixture) } finally { session.close() }
                }
            }
        } finally {
            UnifiedAirPlayTrial.remove(receiver)
            UnifiedAirPlayTrial.configure(false)
            receiver.close()
        }
    }

    companion object {
        private fun Socket.request(method: String, path: String, body: ByteArray = ByteArray(0)): RtspMessage.Request {
            getOutputStream().write(("$method $path RTSP/1.0\r\nCSeq: 1\r\nContent-Length: ${body.size}\r\n\r\n")
                .toByteArray() + body)
            return requireNotNull(readReceiverRequest(getInputStream()))
        }
    }
}
