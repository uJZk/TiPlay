package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayConfig
import com.shilapi.xcertplay.airplay.AirPlayDisplayConfig
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.AirPlayInfoPlist
import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.web.WebMediaSink
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import java.net.Socket

class UnifiedAirPlayTrialTest {
    private val identity = AirPlayIdentity(ByteArray(32) { 1 }, ByteArray(32) { 2 }, "shared-id")
    private val config = ReceiverConfig("TiPlay AirPlay", "02:11:22:33:44:55", identity)
    private val carPlay = AirPlayConfig("TiPlay", config.deviceId, config.deviceId, "test", AirPlayDisplayConfig(1920, 1080))
    private val servers = mutableListOf<ReceiverServer>()

    @After fun cleanup() {
        UnifiedAirPlayTrial.configure(false)
        servers.forEach { UnifiedAirPlayTrial.remove(it); it.close() }
    }

    private fun server(): ReceiverServer = ReceiverServer(config, object : ReceiverServer.Listener {
        override fun mirrorSink(): WebMediaSink = error("not used")
        override fun play(item: ReceiverPlay) = Unit
        override fun stopPlayback() = Unit
        override fun seek(seconds: Double) = Unit
        override fun rate(value: Double) = Unit
        override fun playback() = ReceiverPlayback()
        override fun status(state: String) = Unit
    }).also { servers.add(it) }

    private fun request(path: String, body: ByteArray = ByteArray(0), method: String = "POST") =
        RtspMessage.Request(method, path, "RTSP/1.0", emptyMap(), body)

    private class Ordinary : ReceiverRequestConnection {
        val requests = mutableListOf<RtspMessage.Request>()
        var closes = 0
        override fun handle(request: RtspMessage.Request): RtspMessage.Response {
            requests.add(request)
            return RtspMessage.Response(status = 200)
        }
        override fun close() { closes++ }
    }

    @Test fun disabledAndMissingBackendKeepRoutingSafe() {
        val receiver = server()
        UnifiedAirPlayTrial.install(receiver, config)
        Socket().use { socket ->
            assertNull(UnifiedAirPlayTrial.connection(socket, carPlay, identity))
            assertEquals("TiPlay", UnifiedAirPlayTrial.advertisedName("TiPlay"))
            assertEquals(8L, UnifiedAirPlayTrial.bonjourFeatures(8L))
            UnifiedAirPlayTrial.remove(receiver)
            UnifiedAirPlayTrial.configure(true)
            assertNull(UnifiedAirPlayTrial.connection(socket, carPlay, identity))
            assertEquals("TiPlay", UnifiedAirPlayTrial.advertisedName("TiPlay"))
        }
    }

    @Test fun registryRequiresMatchingKeysAndAcceptsTheWirelessDeviceAlias() {
        UnifiedAirPlayTrial.configure(true)
        UnifiedAirPlayTrial.install(server(), config)
        Socket().use { socket ->
            val copied = identity.copy(privateKey = identity.privateKey.copyOf(), publicKey = identity.publicKey.copyOf())
            assertNotNull(UnifiedAirPlayTrial.connection(socket, carPlay, copied))
            listOf(identity.copy(pairingId = "other"), identity.copy(publicKey = ByteArray(32)),
                identity.copy(privateKey = ByteArray(32))).forEach {
                assertNull(UnifiedAirPlayTrial.connection(socket, carPlay, it))
            }
            assertNotNull(UnifiedAirPlayTrial.connection(socket, carPlay.copy(deviceId = "02:00:00:00:00:00"), identity))
            assertEquals(config.features,
                UnifiedAirPlayTrial.bonjourFeatures(AirPlayInfoPlist.features(carPlay)))
        }
    }

    @Test fun oldServiceCannotRemoveReplacementBackend() {
        UnifiedAirPlayTrial.configure(true)
        val old = server()
        val replacement = server()
        UnifiedAirPlayTrial.install(old, config)
        UnifiedAirPlayTrial.install(replacement, config)
        UnifiedAirPlayTrial.remove(old)
        Socket().use { assertNotNull(UnifiedAirPlayTrial.connection(it, carPlay, identity)) }
        UnifiedAirPlayTrial.remove(replacement)
        Socket().use { assertNull(UnifiedAirPlayTrial.connection(it, carPlay, identity)) }
    }

    @Test fun legacyHandshakesSelectOneOrdinaryBackendAndCloseItOnce() {
        val triggers = listOf(
            request("/pair-setup", ByteArray(32)),
            request("/pair-verify", ByteArray(68).also { it[0] = 1 }),
            request("/pair-verify", ByteArray(68)), request("/fp-setup"),
            request("/server-info", method = "GET"), request("/reverse"), request("/play"),
        )
        triggers.forEach { trigger ->
            val ordinary = Ordinary()
            var created = 0
            val connection = UnifiedAirPlayConnection(identity, config.features) { created++; ordinary }
            assertNull(connection.handle(request("/info", method = "GET")))
            assertFalse(connection.isOrdinary)
            assertEquals(200, connection.handle(trigger)?.status)
            assertTrue(connection.isOrdinary)
            connection.handle(request("/info", method = "GET"))
            connection.handle(request("/feedback"))
            assertEquals(1, created)
            assertEquals(3, ordinary.requests.size)
            connection.close(); connection.close()
            assertEquals(1, ordinary.closes)
        }
    }

    @Test fun carPlayHandshakeNeverSwitchesToLegacyAndDoesNotCreateOrdinaryState() {
        val triggers = listOf(request("/auth-setup"), request("/pair-verify", byteArrayOf(6, 1, 1)),
            request("/pair-setup", byteArrayOf(6, 1, 1)))
        triggers.forEach { trigger ->
            val connection = UnifiedAirPlayConnection(identity, config.features) { error("CarPlay must not create ordinary state") }
            assertNull(connection.handle(trigger))
            assertNull(connection.handle(request("/fp-setup")))
            assertNull(connection.handle(request("/pair-verify", ByteArray(68))))
            assertNull(connection.handle(request("/pair-setup", ByteArray(32))))
            assertFalse(connection.isOrdinary)
            connection.close()
        }
    }

    @Test fun sharedInfoPreservesCarPlayAudioAndDisplayContracts() {
        val connection = UnifiedAirPlayConnection(identity, 123L) { error("not used") }
        val audio = listOf(mapOf("carPlay" to true))
        val display = listOf(mapOf("carPlay" to true))
        val info = mutableMapOf<String, Any?>("name" to "TiPlay", "audioFormats" to audio,
            "displays" to display, "bluetoothIDs" to listOf("car"))
        connection.decorateCarPlayInfo(info)
        assertEquals("TiPlay", info["name"])
        assertEquals(123L, info["features"])
        assertEquals(identity.pairingId, info["pi"])
        assertArrayEquals(identity.publicKey, info["pk"] as ByteArray)
        assertSame(audio, info["audioFormats"])
        assertSame(display, info["displays"])
        assertEquals(listOf("car"), info["bluetoothIDs"])
        connection.close()
    }
}
