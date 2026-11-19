package com.shilapi.xcertplay.airplay

import com.shilapi.xcertplay.receiver.ReceiverConfig
import com.shilapi.xcertplay.receiver.ReceiverDiscoveryInfo
import com.shilapi.xcertplay.receiver.ReceiverAudioCapabilities
import com.shilapi.xcertplay.receiver.ReceiverDeviceTrust
import com.shilapi.xcertplay.receiver.ReceiverPlay
import com.shilapi.xcertplay.receiver.ReceiverPlayback
import com.shilapi.xcertplay.receiver.ReceiverServer
import com.shilapi.xcertplay.receiver.ReceiverSdrFixtures
import com.shilapi.xcertplay.receiver.aesCtr
import com.shilapi.xcertplay.receiver.readReceiverRequest
import com.shilapi.xcertplay.web.BrowserDisplaySource
import com.shilapi.xcertplay.web.WebMediaSink
import com.shilapi.xcertplay.web.WebVideoHub
import com.shilapi.xcertplay.web.WebVideoRecords
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class AirPlayBleDiscoverySocketTest {
    @Test fun firstBtRequestReturnsOrdinaryReceiverInfoAndBothBonjourTxtRecords() {
        val receiver = ReceiverConfig("ordinary-receiver", "02:11:22:33:44:55", AirPlayIdentity.generate(), hevcEnabled = true)
        val lease = ReceiverDiscoveryInfo.register { receiver }
        try {
            withSession { peer, _, _, _ ->
                val response = exchange(peer, "GET", "/info?txtAirPlay&txtRAOP", mapOf("X-Apple-QR" to "BT"))
                assertEquals("200", response.path)
                assertFalse(response.body.isEmpty())
                assertEquals("application/x-apple-binary-plist", response.headers["content-type"])
                assertFalse(response.headers.containsKey("cseq"))
                val info = BplistCodec.decode(response.body) as Map<*, *>
                assertEquals(receiver.deviceId, info["deviceID"])
                assertEquals(receiver.name, info["name"])
                assertArrayEquals(receiver.identity.publicKey, info["pk"] as ByteArray)
                assertEquals(receiver.features, (info["features"] as Number).toLong())
                assertEquals(receiver.txt, decodeTxt(info["txtAirPlay"] as ByteArray))
                assertEquals(receiver.raopTxt, decodeTxt(info["txtRAOP"] as ByteArray))
                assertFalse(info.containsKey("port"))
            }
        } finally { lease.close() }
    }

    @Test fun normalInfoAndPairingKeepTheCarPlayProfileAfterDiscovery() {
        val receiver = ReceiverConfig("ordinary-receiver", "02:11:22:33:44:55", AirPlayIdentity.generate())
        val reads = AtomicInteger()
        val lease = ReceiverDiscoveryInfo.register { reads.incrementAndGet(); receiver }
        try {
            withSession { peer, session, config, identity ->
                assertEquals("200", exchange(peer, "GET", "/info?txtAirPlay&txtRAOP", mapOf("X-Apple-QR" to "BT")).path)
                val response = exchange(peer, "GET", "/info", mapOf("CSeq" to "1"))
                val info = BplistCodec.decode(response.body) as Map<*, *>
                assertEquals(config.deviceId, info["deviceID"])
                assertEquals(config.deviceName, info["name"])
                assertFalse(info.containsKey("txtAirPlay"))
                assertFalse(info.containsKey("txtRAOP"))
                val setup = exchange(peer, "POST", "/pair-setup", mapOf("CSeq" to "2"),
                    Tlv8Codec.encode(listOf(Tlv8Item(6, byteArrayOf(1)))))
                assertEquals("application/pairing+tlv8", setup.headers["content-type"])
                val setupTlv = Tlv8Codec.decode(setup.body)
                assertArrayEquals(byteArrayOf(2), setupTlv[6])
                assertTrue(setupTlv.getValue(2).isNotEmpty())
                val ephemeral = AirPlayCrypto.x25519Generate()
                val verify = exchange(peer, "POST", "/pair-verify", mapOf("CSeq" to "3"),
                    Tlv8Codec.encode(listOf(Tlv8Item(6, byteArrayOf(1)), Tlv8Item(3, ephemeral.publicKey))))
                assertEquals("application/pairing+tlv8", verify.headers["content-type"])
                val verifyTlv = Tlv8Codec.decode(verify.body)
                val shared = AirPlayCrypto.x25519Shared(ephemeral.privateKey, verifyTlv.getValue(3))
                val key = AirPlayCrypto.hkdfSha512(shared, "Pair-Verify-Encrypt-Salt".asciiBytes(),
                    "Pair-Verify-Encrypt-Info".asciiBytes())
                val accessory = Tlv8Codec.decode(AirPlayCrypto.chachaOpen(key,
                    AirPlayCrypto.nonceLabel("PV-Msg02"), verifyTlv.getValue(5)))
                assertEquals(identity.pairingId, accessory.getValue(1).toString(Charsets.UTF_8))
                assertTrue(AirPlayCrypto.ed25519Verify(identity.publicKey,
                    concatBytes(verifyTlv.getValue(3), accessory.getValue(1), ephemeral.publicKey), accessory.getValue(10)))
                assertFalse(session.pairSetup.complete)
                assertFalse(session.pairVerify.isVerified)
                assertEquals(1, reads.get())
                assertTrue(session.activeStreams.isEmpty())
            }
        } finally { lease.close() }
    }

    @Test fun disabledReceiverDoesNotReturnSuccessfulOrStaleDiscoveryInfo() {
        val lease = ReceiverDiscoveryInfo.register {
            ReceiverConfig("retired", "02:11:22:33:44:55", AirPlayIdentity.generate())
        }
        lease.close()
        withSession { peer, _, _, _ ->
            val response = exchange(peer, "GET", "/info?txtAirPlay&txtRAOP", mapOf("X-Apple-QR" to "BT"))
            assertEquals("503", response.path)
            assertTrue(response.body.isEmpty())
        }
    }

    @Test fun discoveryThenNewConnectionsCompleteFairPlayControlMirrorAndRememberedConsentOnTheSameEndpoint() {
        ReceiverFixture().use { fixture ->
            ControlEndpoint().use { endpoint ->
                endpoint.peer().use { peer ->
                    val info = BplistCodec.decode(peer.request("GET", "/info?txtAirPlay&txtRAOP",
                        headers = mapOf("X-Apple-QR" to "BT")).body) as Map<*, *>
                    assertEquals(fixture.receiver.displayConfig.deviceId, info["deviceID"])
                    assertArrayEquals(fixture.receiver.displayConfig.identity.publicKey, info["pk"] as ByteArray)
                }
                await { endpoint.legacyClosed.get() == 1 }
                for (session in listOf("11111111-2222-3333-4444-555555555555", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")) {
                    endpoint.peer().use { peer ->
                        prepareAndMirror(peer, fixture, session)
                        assertEquals("200", peer.request("TEARDOWN", "/session").path)
                    }
                    await { fixture.ended.get() == if (session.startsWith("111")) 1 else 2 }
                }
                await { endpoint.live.isEmpty() }
                assertEquals(3, endpoint.legacyClosed.get())
                assertEquals(0, endpoint.carPlayEnded.get())
                assertEquals(0, endpoint.carPlayMediaClosed.get())
                assertEquals(0, endpoint.carPlayBorrowChanges.get())
                assertEquals(0, endpoint.carPlaySetupResponses.get())
                assertEquals(listOf(true), fixture.prompts.toList())
                assertEquals(1, fixture.store.values.size)
            }
        }
    }

    @Test fun unpairedMirrorRefreshesInfoOnTheFixedEndpointWithoutReplacingItsKeysOrTiming() {
        ReceiverFixture().use { fixture ->
            ControlEndpoint(port = 7000).use { endpoint ->
                DatagramSocket(InetSocketAddress(InetAddress.getByName("127.0.0.2"), 0)).use { timing ->
                    timing.soTimeout = 3000
                    endpoint.peer().use { peer ->
                        assertEquals(7000, peer.socket.port)
                        prepareAndMirror(peer, fixture, "11111111-2222-3333-4444-555555555555", timing = timing)
                        assertEquals(1, fixture.decryptions.get())
                        assertEquals("200", peer.request("TEARDOWN", "/session").path)
                    }
                }
                await { endpoint.live.isEmpty() }
                assertEquals(1, endpoint.legacyClosed.get())
                assertEquals(0, endpoint.carPlayEnded.get())
                assertEquals(0, endpoint.carPlayMediaClosed.get())
                assertEquals(0, endpoint.carPlayBorrowChanges.get())
                assertEquals(0, endpoint.carPlaySetupResponses.get())
                assertEquals(listOf(true), fixture.prompts.toList())
                assertEquals(1, fixture.store.values.size)
            }
        }
    }

    @Test fun sameConnectionDiscoveryAndPipelinedFairPlayKeepQueuedRequestsAndPartialTail() {
        ReceiverFixture().use { fixture ->
            ControlEndpoint().use { endpoint ->
                endpoint.peer().use { peer ->
                    val third = wire("GET", "/info", mapOf("CSeq" to "3"))
                    val prefix = 13
                    peer.write(wire("GET", "/info?txtAirPlay&txtRAOP", mapOf("X-Apple-QR" to "BT")) +
                        wire("POST", "/fp-setup", mapOf("CSeq" to "1"), fairPlay(16)) +
                        wire("POST", "/fp-setup", mapOf("CSeq" to "2"), fairPlay(164)) + third.copyOf(prefix))
                    val discovery = BplistCodec.decode(peer.read().body) as Map<*, *>
                    assertEquals(fixture.receiver.displayConfig.deviceId, discovery["deviceID"])
                    assertEquals(142, peer.read().body.size)
                    assertEquals(32, peer.read().body.size)
                    peer.write(third.copyOfRange(prefix, third.size))
                    val info = BplistCodec.decode(peer.read().body) as Map<*, *>
                    assertArrayEquals(fixture.receiver.displayConfig.identity.publicKey, info["pk"] as ByteArray)
                    prepareAndMirror(peer, fixture, "11111111-2222-3333-4444-555555555555", fairPlayDone = true)
                }
                await { endpoint.live.isEmpty() }
                assertEquals(1, endpoint.legacyClosed.get())
                assertEquals(0, endpoint.carPlayEnded.get())
                assertEquals(0, endpoint.carPlayMediaClosed.get())
            }
        }
    }

    @Test fun unavailableLegacyReceiverReturns503AndClosesWithoutCarPlayLossCallbacks() {
        val lease = ReceiverDiscoveryInfo.register { null }
        try {
            ControlEndpoint().use { endpoint ->
                endpoint.peer().use { peer ->
                    val response = peer.request("POST", "/fp-setup", fairPlay(16))
                    assertEquals("503", response.path)
                    assertTrue(response.body.isEmpty())
                    assertEquals(-1, peer.socket.getInputStream().read())
                }
                await { endpoint.live.isEmpty() }
                assertEquals(1, endpoint.legacyClosed.get())
                assertEquals(0, endpoint.carPlayEnded.get())
                assertEquals(0, endpoint.carPlayMediaClosed.get())
                assertEquals(0, endpoint.carPlayBorrowChanges.get())
            }
        } finally { lease.close() }
    }

    @Test fun connectionCannotSwitchFromItsAdvertisedReceiverToAReplacement() {
        ReceiverFixture().use { first ->
            ControlEndpoint().use { endpoint ->
                endpoint.peer().use { peer ->
                    assertEquals("200", peer.request("GET", "/info?txtAirPlay&txtRAOP",
                        headers = mapOf("X-Apple-QR" to "BT")).path)
                    ReceiverFixture().use { replacement ->
                        assertNotEquals(first.receiver.displayConfig.identity.pairingId,
                            replacement.receiver.displayConfig.identity.pairingId)
                        assertEquals("503", peer.request("POST", "/fp-setup", fairPlay(16)).path)
                        assertEquals(-1, peer.socket.getInputStream().read())
                        endpoint.peer().use { fresh ->
                            assertEquals(142, fresh.request("POST", "/fp-setup", fairPlay(16)).body.size)
                        }
                    }
                }
                await { endpoint.live.isEmpty() }
                assertEquals(0, endpoint.carPlayEnded.get())
                assertEquals(0, endpoint.carPlayMediaClosed.get())
            }
        }
    }

    @Test fun selectedCarPlayPairingAuthOrSetupNeverSwitchesToTheOrdinaryReceiver() {
        val calls = AtomicInteger()
        val config = ReceiverConfig("ordinary", "02:11:22:33:44:55", AirPlayIdentity.generate())
        val lease = ReceiverDiscoveryInfo.register({ config }, { _, _, _ -> calls.incrementAndGet(); true })
        try {
            ControlEndpoint().use { endpoint ->
                for ((path, body) in listOf(
                    "/pair-setup" to Tlv8Codec.encode(listOf(Tlv8Item(6, byteArrayOf(1)))),
                    "/auth-setup" to byteArrayOf(),
                    "/session" to BplistCodec.encode(mapOf("streams" to emptyList<Any>())),
                )) endpoint.peer().use { peer ->
                    peer.request(if (path == "/session") "SETUP" else "POST", path, body)
                    assertTrue(peer.request("POST", "/fp-setup", fairPlay(16)).body.isEmpty())
                    assertTrue(peer.request("GET", "/info?txtAirPlay&txtRAOP",
                        headers = mapOf("X-Apple-QR" to "BT")).body.isEmpty())
                }
                await { endpoint.live.isEmpty() }
                assertEquals(0, calls.get())
                assertEquals(0, endpoint.legacyClosed.get())
                assertEquals(3, endpoint.carPlayEnded.get())
            }
        } finally { lease.close() }
    }

    @Test fun encryptedCarPlayControlNeverSwitchesToTheOrdinaryReceiver() {
        val calls = AtomicInteger()
        val config = ReceiverConfig("ordinary", "02:11:22:33:44:55", AirPlayIdentity.generate())
        val lease = ReceiverDiscoveryInfo.register({ config }, { _, _, _ -> calls.incrementAndGet(); true })
        try {
            ControlEndpoint().use { endpoint ->
                endpoint.peer(encrypted = true).use { peer ->
                    assertTrue(peer.request("POST", "/fp-setup", fairPlay(16)).body.isEmpty())
                    assertTrue(peer.request("GET", "/info?txtAirPlay&txtRAOP",
                        headers = mapOf("X-Apple-QR" to "BT")).body.isEmpty())
                }
                await { endpoint.live.isEmpty() }
                assertEquals(0, calls.get())
                assertEquals(0, endpoint.legacyClosed.get())
                assertEquals(1, endpoint.carPlayEnded.get())
            }
        } finally { lease.close() }
    }

    private class Store : ReceiverDeviceTrust.Store {
        val values = ConcurrentHashMap.newKeySet<String>()
        override fun contains(fingerprint: String) = fingerprint in values
        override fun remember(fingerprint: String) { values.add(fingerprint) }
        override fun forgetAll() { values.clear() }
    }

    private class ReceiverFixture : Closeable, ReceiverServer.Listener {
        val store = Store()
        val prompts = CopyOnWriteArrayList<Boolean>()
        val logs = CopyOnWriteArrayList<String>()
        val ended = AtomicInteger()
        val authorized = AtomicInteger()
        val preparations = AtomicInteger()
        val decryptions = AtomicInteger()
        val transportKey = ByteArray(16) { (it + 1).toByte() }
        private val trust = ReceiverDeviceTrust(store)
        private val hub = WebVideoHub(Executor { it.run() })
        val receiver = ReceiverServer(ReceiverConfig("ordinary-receiver", "02:11:22:33:44:55",
            AirPlayIdentity.generate(), audioOutputFormats = ReceiverAudioCapabilities.OUTPUT_FORMATS), this,
            fairPlayReply = { ByteArray(if (it.size == 16) 142 else 32) },
            fairPlayDecrypt = { _, _ -> decryptions.incrementAndGet(); transportKey.copyOf() })
        init { receiver.start() }
        fun video() = hub.subscribe(reliable = true)
        override fun authorizeDevice(sessionToken: String, identity: ByteArray, deviceName: String,
            mediaType: String, verifiedSessionId: String?): Boolean {
            authorized.incrementAndGet()
            trust.browserSeen("synthetic-browser")
            if (trust.requestSession(sessionToken, identity, deviceName, mediaType, verifiedSessionId)
                is ReceiverDeviceTrust.Decision.Pending) {
                val prompt = requireNotNull(trust.prompt("synthetic-browser"))
                prompts.add(prompt["verified"] as Boolean)
                assertTrue(trust.respond("synthetic-browser", prompt["id"] as String, allow = true, remember = true))
            }
            return trust.authorizeSession(sessionToken, identity, deviceName, mediaType, verifiedSessionId)
        }
        override fun onAuthorizationSessionEnded(sessionToken: String) { trust.endSession(sessionToken); ended.incrementAndGet() }
        override fun prepareMirror() { preparations.incrementAndGet() }
        override fun mirrorSink() = WebMediaSink(hub, 720, 1280, 60, BrowserDisplaySource.AIRPLAY)
        override fun play(item: ReceiverPlay) = error("Unexpected playback")
        override fun stopPlayback() {}
        override fun seek(seconds: Double) {}
        override fun rate(value: Double) {}
        override fun playback() = ReceiverPlayback()
        override fun status(state: String) {}
        override fun log(message: String) { logs.add(message) }
        override fun close() { receiver.close(); trust.close() }
    }

    private class ControlEndpoint(port: Int = 0) : Closeable {
        private val server = ServerSocket().apply {
            reuseAddress = true
            bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 8)
        }
        val live = ConcurrentHashMap.newKeySet<AirPlaySession>()
        val legacyClosed = AtomicInteger()
        val carPlayEnded = AtomicInteger()
        val carPlayMediaClosed = AtomicInteger()
        val carPlayBorrowChanges = AtomicInteger()
        val carPlaySetupResponses = AtomicInteger()
        fun peer(encrypted: Boolean = false): ControlPeer {
            val peer = connectFrom("127.0.0.2", server.localPort)
            val session = AirPlaySession(server.accept(), AirPlayConfig("carplay", "02:99:88:77:66:55",
                "02:00:00:00:00:01", "1.0", main = AirPlayDisplayConfig(800, 480)),
                AirPlayIdentity.generate(), PairingStore(), null,
                object : AirPlaySessionListener {
                    override fun onSessionEnded(session: AirPlaySession) { carPlayEnded.incrementAndGet(); live.remove(session) }
                    override fun onLegacyConnectionClosed(session: AirPlaySession) { legacyClosed.incrementAndGet(); live.remove(session) }
                    override fun onScreenBorrowChanged(session: AirPlaySession, state: CarPlayScreenBorrowState) { carPlayBorrowChanges.incrementAndGet() }
                }, object : AirPlayMediaHandler {
                    override fun onSessionClosed(session: AirPlaySession) { carPlayMediaClosed.incrementAndGet() }
                    override fun onSetupResponseSent(session: AirPlaySession) { carPlaySetupResponses.incrementAndGet() }
                })
            val readKey = ByteArray(32) { 1 }
            val writeKey = ByteArray(32) { 2 }
            if (encrypted) session.cipher = ControlCipher(readKey, writeKey)
            live.add(session)
            session.start()
            return ControlPeer(peer, if (encrypted) ControlCipher(writeKey, readKey) else null)
        }
        override fun close() { live.toList().forEach { it.close() }; server.close() }
    }

    private class ControlPeer(val socket: Socket, private val cipher: ControlCipher?) : Closeable {
        private var cseq = 10
        private var encrypted = byteArrayOf()
        private var plaintext = byteArrayOf()
        fun request(method: String, path: String, body: ByteArray = byteArrayOf(),
            headers: Map<String, String> = mapOf("CSeq" to (++cseq).toString())): RtspMessage.Request {
            val contentType = when {
                body.isEmpty() -> null
                path == "/fp-setup" -> "application/octet-stream"
                method == "SETUP" -> "application/x-apple-binary-plist"
                else -> null
            }
            val typedHeaders = if (contentType == null) headers else headers + ("Content-Type" to contentType)
            write(wire(method, path, typedHeaders, body))
            return read()
        }
        fun write(bytes: ByteArray) { socket.getOutputStream().apply { write(cipher?.encrypt(bytes) ?: bytes); flush() } }
        fun read(): RtspMessage.Request {
            if (cipher == null) return requireNotNull(readReceiverRequest(socket.getInputStream()))
            val buffer = ByteArray(4096)
            while (true) {
                val parsed = RtspMessage.parseMessages(plaintext)
                parsed.messages.firstOrNull()?.let { plaintext = parsed.rest; return it }
                val count = socket.getInputStream().read(buffer)
                check(count >= 0) { "Encrypted control closed before response" }
                encrypted += buffer.copyOf(count)
                val decoded = cipher.decrypt(encrypted)
                encrypted = decoded.rest
                plaintext += decoded.data
            }
        }
        override fun close() { socket.close() }
    }

    companion object {
        private fun wire(method: String, path: String, headers: Map<String, String>, body: ByteArray = byteArrayOf()): ByteArray =
            buildString {
                append("$method $path RTSP/1.0\r\n")
                for ((name, value) in headers) append("$name: $value\r\n")
                append("Content-Length: ${body.size}\r\n\r\n")
            }.toByteArray(Charsets.US_ASCII) + body
        private fun fairPlay(size: Int) = ByteArray(size).apply {
            byteArrayOf(0x46, 0x50, 0x4c, 0x59, 3, 1, (if (size == 16) 1 else 3).toByte(), 0).copyInto(this)
            ByteBuffer.wrap(this, 8, 4).putInt(size - 12)
        }
        private fun prepareAndMirror(peer: ControlPeer, fixture: ReceiverFixture, session: String,
            fairPlayDone: Boolean = false, timing: DatagramSocket? = null) {
            if (!fairPlayDone) {
                assertEquals(142, peer.request("POST", "/fp-setup", fairPlay(16)).body.size)
                assertEquals(32, peer.request("POST", "/fp-setup", fairPlay(164)).body.size)
            }
            val before = fixture.authorized.get()
            val preparationsBefore = fixture.preparations.get()
            val decryptionsBefore = fixture.decryptions.get()
            val target = "rtsp://127.0.0.2/session"
            val setup = peer.request("SETUP", target, BplistCodec.encode(mapOf(
                "ekey" to ByteArray(72), "eiv" to ByteArray(16), "timingPort" to (timing?.localPort ?: 0),
                "timingProtocol" to "NTP", "combinedGetInfoWithControlSetup" to true,
                "isScreenMirroringSession" to true, "sessionUUID" to session, "deviceID" to "02:AA:22:33:44:55")))
            assertEquals("200", setup.path)
            val ports = BplistCodec.decode(setup.body) as Map<*, *>
            assertEquals(setOf("timingPort", "eventPort"), ports.keys)
            val timingPort = (ports["timingPort"] as Number).toInt()
            assertTrue(timingPort in 1..65535)
            assertTrue((ports["eventPort"] as Number).toInt() in 1..65535)
            timing?.let { answerTimingProbe(it, timingPort) }
            // The optional combined response is omitted on this unpaired legacy mirror path.
            // Refresh on the same control connection without a qualifier body or another SETUP.
            val information = peer.request("GET", "/info")
            assertEquals("200", information.path)
            assertEquals("application/x-apple-binary-plist", information.headers["content-type"])
            val info = BplistCodec.decode(information.body) as Map<*, *>
            assertArrayEquals(fixture.receiver.displayConfig.identity.publicKey, info["pk"] as ByteArray)
            assertEquals(fixture.receiver.displayConfig.deviceId, info["deviceID"])
            assertEquals(fixture.receiver.displayConfig.name, info["name"])
            assertEquals(fixture.receiver.displayConfig.features, (info["features"] as Number).toLong())
            assertTrue((info["displays"] as List<*>).isNotEmpty())
            assertFalse(info.containsKey("txtAirPlay"))
            assertEquals(decryptionsBefore + 1, fixture.decryptions.get())
            assertEquals(preparationsBefore, fixture.preparations.get())
            timing?.let { answerTimingProbe(it, timingPort) }
            assertEquals("200", peer.request("RECORD", target).path)
            assertEquals(before, fixture.authorized.get())
            val mirror = peer.request("SETUP", "/stream", BplistCodec.encode(mapOf("streams" to listOf(
                mapOf("type" to 110, "streamConnectionID" to 1234L)))))
            assertEquals("200", mirror.path)
            val stream = ((BplistCodec.decode(mirror.body) as Map<*, *>)["streams"] as List<*>).single() as Map<*, *>
            val dataPort = (stream["dataPort"] as Number).toInt()
            assertTrue(dataPort in 1..65535)
            assertEquals(before + 1, fixture.authorized.get())
            assertEquals(preparationsBefore + 1, fixture.preparations.get())
            assertEquals(decryptionsBefore + 1, fixture.decryptions.get())
            timing?.let { answerTimingProbe(it, timingPort) }
            // A loopback proxy would incorrectly bind the receiver's peer to 127.0.0.1.
            connectFrom("127.0.0.1", dataPort).use { wrong -> assertEquals(-1, wrong.getInputStream().read()) }
            fixture.video().use { video ->
                connectFrom("127.0.0.2", dataPort).use { media ->
                    fun packet(type: Int, body: ByteArray) {
                        val header = ByteBuffer.allocate(128).order(ByteOrder.LITTLE_ENDIAN).apply {
                            putInt(0, body.size); put(4, type.toByte()); putFloat(56, 720f); putFloat(60, 1280f)
                        }.array()
                        media.getOutputStream().apply { write(header); write(body); flush() }
                    }
                    packet(1, ReceiverSdrFixtures.avcc())
                    val configuration = requireNotNull(video.take(3000))
                    assertEquals(WebVideoRecords.KIND_CONFIG, configuration.kind)
                    val encryption = aesCtr(
                        AirPlayCrypto.sha512("AirPlayStreamKey1234".toByteArray(), fixture.transportKey).copyOf(16),
                        AirPlayCrypto.sha512("AirPlayStreamIV1234".toByteArray(), fixture.transportKey).copyOf(16),
                    )
                    packet(0, encryption.update(byteArrayOf(0, 0, 0, 3, 0x65, 1, 2)))
                    val frame = requireNotNull(video.take(3000))
                    assertEquals(WebVideoRecords.KIND_FRAME, frame.kind)
                    assertTrue(frame.keyFrame)
                    assertEquals(configuration.epoch, frame.epoch)
                    assertArrayEquals(byteArrayOf(0, 0, 0, 1, 0x65, 1, 2), frame.payload)
                    assertEquals(decryptionsBefore + 1, fixture.decryptions.get())
                }
            }
        }
        private fun answerTimingProbe(timing: DatagramSocket, expectedPort: Int) {
            val probe = DatagramPacket(ByteArray(64), 64)
            timing.receive(probe)
            assertEquals(expectedPort, probe.port)
            assertEquals(32, probe.length)
            assertEquals(210, probe.data[1].toInt() and 0xff)
            val response = ByteArray(32).apply {
                this[0] = 0x80.toByte(); this[1] = 211.toByte(); this[3] = 7
                for (offset in listOf(8, 16, 24)) probe.data.copyInto(this, offset, 24, 32)
            }
            timing.send(DatagramPacket(response, response.size, probe.socketAddress))
        }
        private fun connectFrom(address: String, port: Int) = Socket().apply {
            bind(InetSocketAddress(InetAddress.getByName(address), 0))
            connect(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 1_000)
            soTimeout = 3_000
        }
        private fun await(condition: () -> Boolean) {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
            while (!condition() && System.nanoTime() < deadline) Thread.yield()
            assertTrue(condition())
        }
    }

    private fun withSession(block: (Socket, AirPlaySession, AirPlayConfig, AirPlayIdentity) -> Unit) {
        ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { server ->
            Socket(server.inetAddress, server.localPort).use { peer ->
                peer.soTimeout = 2_000
                val config = AirPlayConfig("carplay-accessory", "02:99:88:77:66:55", "02:00:00:00:00:01", "1.0",
                    main = AirPlayDisplayConfig(800, 480))
                val identity = AirPlayIdentity.generate()
                val session = AirPlaySession(server.accept(), config, identity, PairingStore(), null,
                    object : AirPlaySessionListener {}, object : AirPlayMediaHandler {})
                session.start()
                try { block(peer, session, config, identity) } finally { session.close() }
            }
        }
    }

    private fun exchange(peer: Socket, method: String, path: String, headers: Map<String, String>,
        body: ByteArray = byteArrayOf()): RtspMessage.Request {
        val head = buildString {
            append("$method $path RTSP/1.0\r\n")
            for ((key, value) in headers) append("$key: $value\r\n")
            if (body.isNotEmpty()) append("Content-Length: ${body.size}\r\n")
            append("\r\n")
        }
        peer.getOutputStream().apply { write(head.toByteArray(Charsets.US_ASCII) + body); flush() }
        val received = ByteArrayOutputStream()
        val buffer = ByteArray(4096)
        while (true) {
            val count = peer.getInputStream().read(buffer)
            check(count >= 0) { "Control socket closed before response" }
            received.write(buffer, 0, count)
            RtspMessage.parseMessages(received.toByteArray()).messages.firstOrNull()?.let { return it }
        }
    }

    private fun decodeTxt(bytes: ByteArray): Map<String, String> {
        val result = linkedMapOf<String, String>()
        var position = 0
        while (position < bytes.size) {
            val length = bytes[position++].toInt() and 0xff
            assertTrue(length > 0 && position + length <= bytes.size)
            val entry = bytes.copyOfRange(position, position + length).toString(Charsets.UTF_8)
            result[entry.substringBefore('=')] = entry.substringAfter('=')
            position += length
        }
        assertEquals(bytes.size, position)
        return result
    }
}
