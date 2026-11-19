package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayCrypto
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.web.WebMediaSink
import org.junit.Assert.*
import org.junit.Test
import java.io.Closeable
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

/** Combined information uses the existing receiver profile without granting a media lease. */
class ReceiverCombinedSetupInfoTest {
    @Test fun pairedLegacyCombinedInfoMatchesTheCompleteInfoEndpoint() {
        Fixture().use { fixture ->
            fixture.peer().use { peer ->
                peer.pairLegacy()
                peer.fairPlay()
                val setup = peer.setup(true)
                assertEquals("200", setup.path)
                val response = dictionary(setup)
                assertEquals(setOf("timingPort", "eventPort", "info"), response.keys)
                assertTrue((response["timingPort"] as Number).toInt() in 1..65535)
                assertTrue((response["eventPort"] as Number).toInt() in 1..65535)
                val combined = response["info"] as Map<*, *>
                assertPlistEquals(dictionary(peer.request("GET", "/info")), combined)
                assertPlistEquals(ReceiverInfoProtocol.fullInfo(fixture.receiver.displayConfig), combined)
                assertArrayEquals(fixture.identity.publicKey, combined["pk"] as ByteArray)
                assertEquals(fixture.identity.pairingId, combined["pi"])
                assertEquals(fixture.receiver.displayConfig.features, (combined["features"] as Number).toLong())
                assertEquals(0, fixture.authorizations.get())
                assertEquals(0, fixture.preparations.get())
                assertTrue(fixture.states.isEmpty())
            }
        }
    }

    @Test fun unpairedMirrorInfoRefreshKeepsItsEstablishedTransportWithoutEarlyConsent() {
        Fixture().use { fixture ->
            DatagramSocket(InetSocketAddress("127.0.0.1", 0)).use { timing ->
                timing.soTimeout = 3000
                fixture.peer().use { peer ->
                    peer.fairPlay()
                    val setup = peer.setup(true, mapOf("timingPort" to timing.localPort))
                    assertEquals("200", setup.path)
                    val ports = dictionary(setup)
                    assertEquals(setOf("timingPort", "eventPort"), ports.keys)
                    val timingPort = (ports["timingPort"] as Number).toInt()
                    val eventPort = (ports["eventPort"] as Number).toInt()
                    assertTrue(timingPort in 1..65535)
                    assertTrue(eventPort in 1..65535)
                    assertEquals(timingPort, timingProbePort(timing))
                    Socket(InetAddress.getByName("127.0.0.1"), eventPort).use {
                        val information = peer.request("GET", "/info")
                        assertEquals("200", information.path)
                        assertPlistEquals(ReceiverInfoProtocol.fullInfo(fixture.receiver.displayConfig), dictionary(information))
                        assertEquals("200", peer.request("RECORD", "/session").path)
                        assertEquals(timingPort, timingProbePort(timing))
                        assertEquals(1, fixture.decryptions.get())
                        assertEquals(0, fixture.authorizations.get())
                        assertEquals(0, fixture.preparations.get())
                        assertTrue(fixture.states.isEmpty())
                    }
                }
            }
        }
    }

    @Test fun absentFalseAndNonBooleanCombinedRequestsKeepThePortOnlyReply() {
        for (flag in listOf(null, false, "true", 1L)) {
            Fixture().use { fixture ->
                fixture.peer().use { peer ->
                    peer.fairPlay()
                    val setup = peer.setup(flag)
                    assertEquals("200", setup.path)
                    assertEquals(setOf("timingPort", "eventPort"), dictionary(setup).keys)
                    assertEquals(0, fixture.authorizations.get())
                    assertEquals(0, fixture.preparations.get())
                }
            }
        }
    }

    @Test fun aLaterPairedCombinedSetupUsesTheCurrentDisplayCodecAndAudioProfile() {
        Fixture().use { fixture ->
            fixture.peer().use { peer ->
                peer.pairLegacy()
                peer.fairPlay()
                val previous = dictionary(peer.setup(true))["info"] as Map<*, *>
                fixture.receiver.updateDisplay(24, hevc = true)
                fixture.receiver.updateDisplaySize(1184, 920)
                fixture.receiver.updateAudioFormats(ReceiverAudioCapabilities.OUTPUT_FORMATS)
                val updated = dictionary(peer.setup(true))["info"] as Map<*, *>
                assertPlistEquals(dictionary(peer.request("GET", "/info")), updated)
                assertPlistEquals(ReceiverInfoProtocol.fullInfo(fixture.receiver.displayConfig), updated)
                val display = (updated["displays"] as List<*>).single() as Map<*, *>
                assertEquals(1184, (display["width"] as Number).toInt())
                assertEquals(920, (display["height"] as Number).toInt())
                assertEquals(24, (display["maxFPS"] as Number).toInt())
                assertEquals(1.0 / 24.0, (display["refreshRate"] as Number).toDouble(), 0.0)
                assertNotEquals(previous["features"], updated["features"])
                assertArrayEquals(previous["pk"] as ByteArray, updated["pk"] as ByteArray)
                assertEquals(0, fixture.preparations.get())
                assertEquals(0, fixture.authorizations.get())
            }
        }
    }

    @Test fun nonMirrorIntentAndStreamListsRetainTheRequestedCombinedInfo() {
        val requests = listOf(
            mapOf("isScreenMirroringSession" to false),
            mapOf("isScreenMirroringSession" to "true"),
            mapOf("isScreenMirroringSession" to 1L),
            mapOf("streams" to emptyList<Map<String, Any>>()),
        )
        for (changes in requests) {
            Fixture().use { fixture ->
                fixture.peer().use { peer ->
                    peer.fairPlay()
                    val response = peer.setup(true, changes)
                    assertEquals("200", response.path)
                    assertPlistEquals(ReceiverInfoProtocol.fullInfo(fixture.receiver.displayConfig), dictionary(response)["info"])
                    assertEquals(changes.containsKey("streams"), dictionary(response).containsKey("streams"))
                    assertEquals(0, fixture.authorizations.get())
                    assertEquals(0, fixture.preparations.get())
                }
            }
        }
        for (mirrorEnabled in listOf(true, false)) {
            Fixture(mirrorEnabled).use { fixture ->
                fixture.peer().use { peer ->
                    peer.fairPlay()
                    val response = peer.setup(true, removed = setOf("isScreenMirroringSession"))
                    assertEquals("200", response.path)
                    assertPlistEquals(ReceiverInfoProtocol.fullInfo(fixture.receiver.displayConfig), dictionary(response)["info"])
                    assertEquals(0, fixture.authorizations.get())
                    assertEquals(0, fixture.preparations.get())
                }
            }
        }
    }

    @Test fun disabledMirrorCapabilityRetainsCombinedInfoForExplicitMirrorIntent() {
        Fixture(mirrorEnabled = false).use { fixture ->
            fixture.peer().use { peer ->
                peer.fairPlay()
                val response = peer.setup(true)
                assertEquals("200", response.path)
                assertPlistEquals(ReceiverInfoProtocol.fullInfo(fixture.receiver.displayConfig), dictionary(response)["info"])
                assertEquals(0, fixture.authorizations.get())
                assertEquals(0, fixture.preparations.get())
            }
        }
    }

    @Test fun aCombinedLegacyAudioStreamKeepsItsInfoAndTypedConsent() {
        Fixture(audioFormats = ReceiverAudioCapabilities.OUTPUT_FORMATS).use { fixture ->
            fixture.peer().use { peer ->
                peer.fairPlay()
                val response = peer.setup(true, mapOf(
                    "isScreenMirroringSession" to false,
                    "streams" to listOf(mapOf("type" to 96, "ct" to 1, "sr" to 44100, "ch" to 2, "spf" to 352)),
                ))
                assertEquals("200", response.path)
                val session = dictionary(response)
                assertEquals(setOf("timingPort", "eventPort", "streams", "info"), session.keys)
                assertPlistEquals(ReceiverInfoProtocol.fullInfo(fixture.receiver.displayConfig), session["info"])
                assertEquals(0, (session["eventPort"] as Number).toInt())
                val audio = (session["streams"] as List<*>).single() as Map<*, *>
                assertEquals(96, (audio["type"] as Number).toInt())
                assertTrue((audio["dataPort"] as Number).toInt() in 1..65535)
                assertEquals(1, fixture.authorizations.get())
                assertEquals(0, fixture.preparations.get())
                assertEquals(listOf("audio"), fixture.states.toList())
            }
        }
    }

    @Test fun aPresentedButUnverifiedPairingKeyCannotUseTheUnpairedCompatibilityReply() {
        Fixture().use { fixture ->
            fixture.peer().use { peer ->
                peer.pairLegacy(complete = false)
                peer.fairPlay()
                val response = peer.setup(true)
                assertEquals("403", response.path)
                assertEquals(0, response.body.size)
                assertEquals(0, fixture.decryptions.get())
                assertEquals(0, fixture.authorizations.get())
                assertEquals(0, fixture.preparations.get())
            }
        }
    }

    @Test fun combinedTransportIntentDoesNotReserveTheScreenOrBlockAnotherMediaSession() {
        Fixture().use { fixture ->
            fixture.peer().use { transport ->
                transport.fairPlay()
                assertEquals("200", transport.setup(true).path)
                assertEquals(0, fixture.preparations.get())
                assertEquals(0, fixture.authorizations.get())
                fixture.peer().use { media ->
                    assertEquals("200", media.play().path)
                    assertEquals(1, fixture.played.get())
                    assertEquals(1, fixture.authorizations.get())
                    assertEquals(0, fixture.preparations.get())
                    assertEquals("200", transport.request("GET", "/info").path)
                    assertEquals(0, fixture.stopped.get())
                }
            }
        }
    }

    @Test fun aCombinedRequestCannotReplaceAnotherConnectionsActiveMedia() {
        Fixture().use { fixture ->
            fixture.peer().use { media ->
                assertEquals("200", media.play().path)
                fixture.peer().use { contender ->
                    contender.fairPlay()
                    val rejected = contender.setup(true)
                    assertEquals("453", rejected.path)
                    assertEquals(0, rejected.body.size)
                    assertEquals(1, fixture.played.get())
                    assertEquals(0, fixture.stopped.get())
                    assertEquals(0, fixture.preparations.get())
                    assertEquals("200", media.request("GET", "/playback-info").path)
                }
            }
        }
    }

    @Test fun combinedInfoDoesNotBypassTransportValidationOrTheFairPlayHandshake() {
        Fixture().use { fixture ->
            fixture.peer().use { peer ->
                val uninitialized = peer.setup(true)
                assertEquals("400", uninitialized.path)
                assertEquals(0, uninitialized.body.size)
                peer.fairPlay()
                for ((change, status) in listOf(
                    mapOf("timingProtocol" to "PTP") to "461",
                    mapOf("eiv" to ByteArray(15)) to "400",
                )) {
                    val invalid = peer.setup(true, change)
                    assertEquals(status, invalid.path)
                    assertEquals(0, invalid.body.size)
                }
                assertEquals("200", peer.setup(true).path)
                assertEquals(0, fixture.authorizations.get())
                assertEquals(0, fixture.preparations.get())
            }
        }
    }

    private class Fixture(mirrorEnabled: Boolean = true, audioFormats: Long = 0L) : Closeable, ReceiverServer.Listener {
        val identity = AirPlayIdentity.generate()
        val decryptions = AtomicInteger()
        val preparations = AtomicInteger()
        val authorizations = AtomicInteger()
        val played = AtomicInteger()
        val stopped = AtomicInteger()
        val states = CopyOnWriteArrayList<String>()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", identity,
            mirrorEnabled = mirrorEnabled, audioOutputFormats = audioFormats), this,
            fairPlayReply = { ByteArray(if (it.size == 16) 142 else 32) },
            fairPlayDecrypt = { _, _ -> decryptions.incrementAndGet(); ByteArray(16) { (it + 1).toByte() } })

        init { receiver.start() }
        fun peer() = Peer(receiver.port)
        override fun prepareMirror() { preparations.incrementAndGet() }
        override fun mirrorSink(): WebMediaSink = error("transport information must not borrow the browser screen")
        override fun authorizeConnection(sessionToken: String, deviceName: String): Boolean {
            authorizations.incrementAndGet()
            return true
        }
        override fun play(item: ReceiverPlay) { played.incrementAndGet() }
        override fun stopPlayback() { stopped.incrementAndGet() }
        override fun seek(seconds: Double) {}
        override fun rate(value: Double) {}
        override fun playback() = ReceiverPlayback(duration = 100.0, ready = true, rate = 1.0)
        override fun status(state: String) { states.add(state) }
        override fun close() = receiver.close()
    }

    private class Peer(port: Int) : Closeable {
        private val socket = Socket(InetAddress.getByName("127.0.0.1"), port).apply { soTimeout = 3000 }
        private var sequence = 0
        fun request(method: String, target: String, body: ByteArray = ByteArray(0)): RtspMessage.Request {
            val header = "$method $target RTSP/1.0\r\nCSeq: ${++sequence}\r\n" +
                "X-Apple-Session-ID: 11223344556677889900aabbccddeeff\r\n" +
                "Content-Type: application/x-apple-binary-plist\r\nContent-Length: ${body.size}\r\n\r\n"
            socket.getOutputStream().apply { write(header.toByteArray() + body); flush() }
            return requireNotNull(readReceiverRequest(socket.getInputStream()))
        }
        fun setup(flag: Any?, changes: Map<String, Any> = emptyMap(), removed: Set<String> = emptySet()): RtspMessage.Request {
            val fields = linkedMapOf<String, Any>("eiv" to ByteArray(16), "ekey" to ByteArray(72),
                "timingPort" to 0, "timingProtocol" to "NTP", "isScreenMirroringSession" to true)
            if (flag != null) fields["combinedGetInfoWithControlSetup"] = flag
            fields.putAll(changes)
            removed.forEach { fields.remove(it) }
            return request("SETUP", "/session", BplistCodec.encode(fields))
        }
        fun pairLegacy(complete: Boolean = true) {
            val curve = AirPlayCrypto.x25519Generate()
            val signing = AirPlayCrypto.ed25519Generate()
            val response = request("POST", "/pair-verify", byteArrayOf(1, 0, 0, 0) + curve.publicKey + signing.publicKey)
            assertEquals("200", response.path)
            assertEquals(96, response.body.size)
            if (!complete) return
            val serverCurve = response.body.copyOf(32)
            val secret = AirPlayCrypto.x25519Shared(curve.privateKey, serverCurve)
            val cipher = aesCtr(AirPlayCrypto.sha512("Pair-Verify-AES-Key".toByteArray(), secret).copyOf(16),
                AirPlayCrypto.sha512("Pair-Verify-AES-IV".toByteArray(), secret).copyOf(16))
            cipher.update(response.body.copyOfRange(32, 96))
            val signature = AirPlayCrypto.ed25519Sign(signing.privateKey, curve.publicKey + serverCurve)
            assertEquals("200", request("POST", "/pair-verify", ByteArray(4) + cipher.update(signature)).path)
        }
        fun fairPlay() {
            for ((size, step) in listOf(16 to 1, 164 to 3)) {
                val message = ByteArray(size).apply {
                    byteArrayOf(0x46, 0x50, 0x4c, 0x59, 3, 1, step.toByte(), 0).copyInto(this)
                    ByteBuffer.wrap(this, 8, 4).putInt(size - 12)
                }
                assertEquals("200", request("POST", "/fp-setup", message).path)
            }
        }
        fun play() = request("POST", "/play", "Content-Location: https://example.org/movie.mp4\r\n".toByteArray())
        override fun close() = socket.close()
    }

    private companion object {
        fun timingProbePort(socket: DatagramSocket): Int {
            val packet = DatagramPacket(ByteArray(32), 32)
            socket.receive(packet)
            assertEquals(32, packet.length)
            assertEquals(210, packet.data[1].toInt() and 0xff)
            return packet.port
        }
        fun dictionary(response: RtspMessage.Request) = BplistCodec.decode(response.body) as Map<*, *>
        fun assertPlistEquals(expected: Any?, actual: Any?) {
            when (expected) {
                is ByteArray -> assertArrayEquals(expected, actual as ByteArray)
                is Map<*, *> -> {
                    val map = actual as Map<*, *>
                    assertEquals(expected.keys, map.keys)
                    expected.forEach { (key, value) -> assertPlistEquals(value, map[key]) }
                }
                is List<*> -> {
                    val list = actual as List<*>
                    assertEquals(expected.size, list.size)
                    expected.indices.forEach { assertPlistEquals(expected[it], list[it]) }
                }
                is Number -> {
                    val number = actual as Number
                    if (expected is Double || expected is Float) assertEquals(expected.toDouble(), number.toDouble(), 0.0)
                    else assertEquals(expected.toLong(), number.toLong())
                }
                else -> assertEquals(expected, actual)
            }
        }
    }
}
