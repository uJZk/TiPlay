package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayCrypto
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.web.WebMediaSink
import com.shilapi.xcertplay.web.WebVideoHub
import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress
import java.net.Socket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.BindException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ReceiverServerTest {
    private class BlockedEventOutput(private val output: java.io.OutputStream) : java.io.OutputStream() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        private val first = java.util.concurrent.atomic.AtomicBoolean(true)
        override fun write(value: Int) = write(byteArrayOf(value.toByte()), 0, 1)
        override fun write(bytes: ByteArray, offset: Int, length: Int) {
            if (first.compareAndSet(true, false)) {
                entered.countDown()
                if (!release.await(5, TimeUnit.SECONDS)) throw java.io.IOException("Blocked test writer was not released")
            }
            output.write(bytes, offset, length)
        }
        override fun flush() = output.flush()
    }

    /** Replace only the reverse socket's output with a controlled slow writer after its real upgrade. */
    private fun blockReverseOutput(receiver: ReceiverServer, id: String = "test"): BlockedEventOutput {
        val reverse = ReceiverServer::class.java.getDeclaredField("reverse").apply { isAccessible = true }
            .get(receiver) as Map<*, *>
        val connection = requireNotNull(reverse[id])
        val field = connection.javaClass.getDeclaredField("output").apply { isAccessible = true }
        return BlockedEventOutput(field.get(connection) as java.io.OutputStream).also { field.set(connection, it) }
    }

    private fun Socket.upgradeReverse() {
        getOutputStream().write("POST /reverse HTTP/1.1\r\nX-Apple-Session-ID: test\r\nUpgrade: PTTH/1.0\r\nContent-Length: 0\r\n\r\n".toByteArray())
        assertEquals("101", readReceiverRequest(getInputStream())!!.path)
    }

    @Test fun blockedReverseWritesDoNotHoldPlaybackOwnershipAndQueuedEventsKeepTheirOrder() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        var blocked: BlockedEventOutput? = null
        try {
            connect(receiver.port).use { control ->
                assertEquals(200, control.status("POST", "/play", "Content-Location: https://example.org/movie.mp4\r\n".toByteArray()))
                connect(receiver.port).use { reverse ->
                    reverse.upgradeReverse()
                    val writer = blockReverseOutput(receiver).also { blocked = it }
                    receiver.playbackEvent("playing")
                    assertTrue(writer.entered.await(1, TimeUnit.SECONDS))
                    java.util.concurrent.CompletableFuture.runAsync { receiver.playbackEvent("paused") }
                        .get(500, TimeUnit.MILLISECONDS)
                    val resource = java.util.concurrent.CompletableFuture.supplyAsync { receiver.loadResource("mlhls://app/master.m3u8") }
                    val deadline = System.nanoTime() + 1_000_000_000L
                    while (listener.logs.none { it.startsWith("resource stage=REQUEST ") } && System.nanoTime() < deadline) Thread.sleep(1)
                    assertTrue(listener.logs.any { it.startsWith("resource stage=REQUEST ") })
                    val stopped = java.util.concurrent.CompletableFuture.supplyAsync { control.status("POST", "/stop") }
                    assertEquals(200, stopped.get(500, TimeUnit.MILLISECONDS).toInt())
                    assertNull(resource.get(500, TimeUnit.MILLISECONDS))
                    assertEquals(1, listener.stopped)
                    assertEquals("listening", listener.states.last())
                    connect(receiver.port).use { next ->
                        assertEquals(200, next.status("POST", "/play", "Content-Location: https://example.org/next.mp4\r\n".toByteArray()))
                    }
                    writer.release.countDown()
                    for (state in listOf("playing", "paused", "unhandledURLRequest", "stopped")) {
                        val event = requireNotNull(readReceiverRequest(reverse.getInputStream()))
                        assertEquals("POST", event.method)
                        assertEquals("/event", event.path)
                        assertTrue(event.body.toString(Charsets.UTF_8).contains("<string>$state</string>"))
                    }
                }
            }
        } finally { blocked?.release?.countDown(); receiver.close() }
    }

    @Test fun queuedStoppedEventsCannotReachAReplacementReverseChannelAndCloseDoesNotWaitForItsWriter() {
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), Listener())
        receiver.start()
        val blocked = mutableListOf<BlockedEventOutput>()
        try {
            connect(receiver.port).use { control ->
                val play = "Content-Location: https://example.org/movie.mp4\r\n".toByteArray()
                assertEquals(200, control.status("POST", "/play", play))
                connect(receiver.port).use { oldReverse ->
                    oldReverse.upgradeReverse()
                    val oldWriter = blockReverseOutput(receiver).also { blocked.add(it) }
                    receiver.playbackEvent("playing")
                    assertTrue(oldWriter.entered.await(1, TimeUnit.SECONDS))
                    assertEquals(200, java.util.concurrent.CompletableFuture.supplyAsync { control.status("POST", "/stop") }
                        .get(500, TimeUnit.MILLISECONDS).toInt())
                    assertEquals(200, control.status("POST", "/play", play))
                    connect(receiver.port).use { replacement ->
                        replacement.upgradeReverse()
                        oldWriter.release.countDown()
                        receiver.playbackEvent("playing")
                        val event = requireNotNull(readReceiverRequest(replacement.getInputStream()))
                        assertTrue(event.body.toString(Charsets.UTF_8).contains("<string>playing</string>"))
                        replacement.soTimeout = 100
                        assertThrows(java.net.SocketTimeoutException::class.java) { readReceiverRequest(replacement.getInputStream()) }
                        replacement.soTimeout = 5000
                        val currentWriter = blockReverseOutput(receiver).also { blocked.add(it) }
                        receiver.playbackEvent("paused")
                        assertTrue(currentWriter.entered.await(1, TimeUnit.SECONDS))
                        java.util.concurrent.CompletableFuture.runAsync { receiver.close() }.get(500, TimeUnit.MILLISECONDS)
                        assertNull(readReceiverRequest(replacement.getInputStream()))
                    }
                }
            }
        } finally { blocked.forEach { it.release.countDown() }; receiver.close() }
    }

    private class Listener : ReceiverServer.Listener {
        val hub = WebVideoHub()
        val items = CopyOnWriteArrayList<ReceiverPlay>()
        val states = CopyOnWriteArrayList<String>()
        val logs = CopyOnWriteArrayList<String>()
        val ended = CountDownLatch(1)
        var stopped = 0
        var sought = 0.0
        var speed = 1.0
        override fun mirrorSink() = WebMediaSink(hub, 1920, 1080, 60)
        override fun play(item: ReceiverPlay) { items.add(item) }
        override fun stopPlayback() { stopped++ }
        override fun seek(seconds: Double) { sought = seconds }
        override fun rate(value: Double) { speed = value }
        override fun playback() = ReceiverPlayback(100.0, sought, speed, true)
        override fun status(state: String) { states.add(state); if (state == "listening") ended.countDown() }
        override fun log(message: String) { logs.add(message) }
    }

    private fun Socket.send(method: String, path: String, body: ByteArray = ByteArray(0), id: String = "test", contentType: String? = null):
        com.shilapi.xcertplay.airplay.RtspMessage.Request {
        val contentHeader = contentType?.let { "Content-Type: $it\r\n" }.orEmpty()
        getOutputStream().write(("$method $path HTTP/1.1\r\nX-Apple-Session-ID: $id\r\n${contentHeader}Content-Length: ${body.size}\r\n\r\n").toByteArray() + body)
        return requireNotNull(readReceiverRequest(getInputStream()))
    }
    private fun Socket.status(method: String, path: String, body: ByteArray = ByteArray(0), id: String = "test") = send(method, path, body, id).path.toInt()
    private fun connect(port: Int) = Socket(InetAddress.getLoopbackAddress(), port).apply { soTimeout = 5000 }

    @Test fun videoControlAndReverseEventsBelongToTheirSessionAndShutdownClosesSockets() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                assertEquals(200, control.status("GET", "/info"))
                assertTrue(listener.logs.any { it.contains("method=GET path=/info bodyBytes=0") })
                assertEquals(404, control.status("GET", "/unknown"))
                assertEquals(200, control.status("POST", "/play", "Content-Location: https://example.org/movie.mp4\r\nStart-Position: 0\r\n".toByteArray()))
                assertEquals(1, listener.items.size)
                assertEquals(403, control.status("POST", "/stop", id = "another"))
                assertEquals(0, listener.stopped)
                assertEquals(200, control.status("POST", "/scrub?position=12.5"))
                assertEquals(12.5, listener.sought, 0.0)
                assertEquals(200, control.status("POST", "/rate?value=0"))
                assertEquals(0.0, listener.speed, 0.0)
                assertEquals(400, control.status("POST", "/rate?value=NaN"))
                assertTrue(listener.logs.any { it.contains("exception=IllegalArgumentException") })
                assertFalse(listener.logs.any { it.contains("example.org") || it.contains("value=NaN") })
                connect(receiver.port).use { reverse ->
                    reverse.getOutputStream().write("POST /reverse HTTP/1.1\r\nX-Apple-Session-ID: test\r\nUpgrade: PTTH/1.0\r\nContent-Length: 0\r\n\r\n".toByteArray())
                    assertEquals("101", readReceiverRequest(reverse.getInputStream())!!.path)
                    receiver.playbackEvent("playing")
                    val event = readReceiverRequest(reverse.getInputStream())!!
                    assertEquals("POST", event.method); assertEquals("/event", event.path)
                    assertTrue(event.body.toString(Charsets.UTF_8).contains("<string>playing</string>"))
                    assertEquals(200, control.status("POST", "/stop"))
                    assertEquals(1, listener.stopped)
                    assertEquals("listening", listener.states.last())
                    receiver.close()
                    // One stopped event may already be buffered before the orderly close.
                    val stopped = readReceiverRequest(reverse.getInputStream())
                    if (stopped != null) assertNull(readReceiverRequest(reverse.getInputStream()))
                }
            }
        } finally { receiver.close() }
    }

    @Test fun encryptedMirrorUsesIndependentKeyAndGeometryAndControlDisconnectEndsStream() = encryptedMirrorProbe(false)

    @Test fun explicitMirrorTeardownRestoresTheRetainedDisplay() = encryptedMirrorProbe(true)

    @Test fun mirrorDataEofKeepsControlAndTimingUntilTeardownAndAllowsAnotherSetup() = encryptedMirrorProbe(false, true)

    @Test fun combinedAudioAndMirrorSetupHasRealUdpPortsAndAudioTeardownKeepsThePicture() =
        encryptedMirrorProbe(false, audioDrain = true)

    @Test fun mirrorEofWithAudioStillRunningKeepsSessionOwnershipUntilTeardown() =
        encryptedMirrorProbe(false, dataEofRecovery = true, audioDrain = true)

    @Test fun sleepResumeWithRepeatedConfigurationKeepsThePredictionChainAndCipherPosition() =
        encryptedMirrorProbe(false, sleepResume = true)

    private fun encryptedMirrorProbe(teardown: Boolean, dataEofRecovery: Boolean = false, audioDrain: Boolean = false,
                                     sleepResume: Boolean = false) {
        val identity = AirPlayIdentity.generate()
        val listener = Listener()
        val rawKey = ByteArray(16) { (it + 1).toByte() }
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", identity), listener,
            fairPlayReply = { ByteArray(if (it.size == 16) 142 else 32) }, fairPlayDecrypt = { _, _ -> rawKey })
        receiver.start()
        val control = connect(receiver.port)
        try {
            val curve = AirPlayCrypto.x25519Generate()
            val signing = AirPlayCrypto.ed25519Generate()
            val reply = control.send("POST", "/pair-verify", byteArrayOf(1, 0, 0, 0) + curve.publicKey + signing.publicKey).body
            val serverCurve = reply.copyOf(32)
            val secret = AirPlayCrypto.x25519Shared(curve.privateKey, serverCurve)
            val verifyCipher = aesCtr(AirPlayCrypto.sha512("Pair-Verify-AES-Key".toByteArray(), secret).copyOf(16),
                AirPlayCrypto.sha512("Pair-Verify-AES-IV".toByteArray(), secret).copyOf(16))
            verifyCipher.update(reply.copyOfRange(32, 96))
            assertEquals(200, control.status("POST", "/pair-verify", ByteArray(4) + verifyCipher.update(AirPlayCrypto.ed25519Sign(signing.privateKey, curve.publicKey + serverCurve))))
            fun fairPlay(size: Int, sequence: Int) = ByteArray(size).apply {
                byteArrayOf(0x46, 0x50, 0x4c, 0x59, 3, 1, sequence.toByte(), 0).copyInto(this)
                java.nio.ByteBuffer.wrap(this, 8, 4).putInt(size - 12)
            }
            assertEquals(142, control.send("POST", "/fp-setup", fairPlay(16, 1)).body.size)
            assertEquals(32, control.send("POST", "/fp-setup", fairPlay(164, 3)).body.size)
            val setup = mapOf("eiv" to ByteArray(16), "ekey" to ByteArray(72), "timingPort" to 0)
            val initialSetup = control.send("SETUP", "rtsp://receiver/stream", BplistCodec.encode(setup))
            assertEquals("200", initialSetup.path)
            val initialPorts = BplistCodec.decode(initialSetup.body) as Map<*, *>
            assertEquals(0, (initialPorts["eventPort"] as Number).toInt())
            assertTrue((initialPorts["timingPort"] as Number).toInt() > 0)
            connect(receiver.port).use { probe ->
                // Key/timing-only negotiation has no media lease, so another control session is not busy.
                assertEquals(200, probe.status("SETUP", "/", BplistCodec.encode(emptyMap<String, Any?>())))
            }
            assertEquals(200, control.status("GET", "/info"))
            val volume = control.send("GET_PARAMETER", "rtsp://receiver/stream", "volume\r\n".toByteArray(), contentType = "text/parameters")
            assertEquals("200", volume.path)
            assertEquals("text/parameters", volume.headers["content-type"])
            assertEquals("volume: 0.0\r\n", volume.body.toString(Charsets.US_ASCII))
            assertEquals("volume: 0.0\r\n", control.send("GET_PARAMETER", "rtsp://receiver/stream",
                "volume\r\n".toByteArray()).body.toString(Charsets.US_ASCII))
            val requested = listOf(mapOf("type" to 110, "streamConnectionID" to 1234L)) +
                if (audioDrain) listOf(mapOf("type" to 96, "ct" to 8, "audioFormat" to 0x1000000L, "spf" to 480)) else emptyList()
            val stream = BplistCodec.decode(control.send("SETUP", "/", BplistCodec.encode(mapOf("streams" to requested))).body) as Map<*, *>
            val ports = (stream["streams"] as List<*>).map { it as Map<*, *> }
            val port = (ports.single { (it["type"] as Number).toInt() == 110 }["dataPort"] as Number).toInt()
            val audioPorts = ports.find { (it["type"] as Number).toInt() == 96 }?.let {
                listOf((it["dataPort"] as Number).toInt(), (it["controlPort"] as Number).toInt())
            }.orEmpty()
            for (audioPort in audioPorts) {
                try {
                    DatagramSocket(null).use { it.bind(InetSocketAddress(InetAddress.getByName("::"), audioPort)) }
                    fail("Advertised audio port must already be bound")
                } catch (_: BindException) { /* Receiver owns the real UDP port. */ }
            }
            val subscription = listener.hub.subscribe()
            connect(port).use { data ->
                fun packet(op: Int, body: ByteArray, flag: Int = 0): ByteArray {
                    val header = ByteBuffer.allocate(128).order(ByteOrder.LITTLE_ENDIAN)
                    header.putInt(0, body.size); header.put(4, op.toByte()); header.putFloat(56, 720f); header.putFloat(60, 1280f)
                    header.put(6, flag.toByte())
                    return header.array() + body
                }
                val avcc = byteArrayOf(1, 0x42, 0, 0x1f, -1, -31, 0, 4, 0x67, 0x42, 0, 0x1f, 1, 0, 2, 0x68, 1)
                data.getOutputStream().write(packet(1, avcc))
                assertNotNull(subscription.take(5000))
                assertEquals(720, listener.hub.info()!!.width)
                assertTrue(listener.logs.any { it.contains("mirror stage=CONFIG codec=H264") })
                val mirrorKey = AirPlayCrypto.sha512(rawKey, secret).copyOf(16)
                val encryption = aesCtr(AirPlayCrypto.sha512("AirPlayStreamKey1234".toByteArray(), mirrorKey).copyOf(16),
                    AirPlayCrypto.sha512("AirPlayStreamIV1234".toByteArray(), mirrorKey).copyOf(16))
                val first = byteArrayOf(0, 0, 0, 3, 0x65, 1, 2)
                val second = byteArrayOf(0, 0, 0, 2, 0x41, 1)
                data.getOutputStream().write(packet(0, encryption.update(first)) + packet(0, encryption.update(second)))
                assertNotNull(subscription.take(5000)); assertNotNull(subscription.take(5000))
                if (sleepResume) {
                    val epoch = listener.hub.info()!!.epoch
                    data.getOutputStream().write(packet(1, avcc, 0x56) +
                        packet(0, encryption.update(second)) + packet(1, avcc, 0x16) +
                        packet(0, encryption.update(second)))
                    assertEquals(com.shilapi.xcertplay.web.WebVideoRecords.KIND_FRAME, subscription.take(5000)!!.kind)
                    assertEquals(epoch, listener.hub.info()!!.epoch)
                }
                if (audioDrain && !dataEofRecovery) {
                    assertEquals(200, control.status("TEARDOWN", "/", BplistCodec.encode(mapOf("streams" to listOf(mapOf("type" to 96))))))
                    assertEquals(200, control.status("OPTIONS", "/"))
                    assertNotNull(listener.hub.info())
                    assertFalse(listener.logs.any { it.contains("Media clock final:") })
                    for (audioPort in audioPorts) {
                        DatagramSocket(null).use { awaitReleasedUdpPort(it, InetSocketAddress(InetAddress.getByName("::"), audioPort)) }
                    }
                    data.getOutputStream().write(packet(0, encryption.update(second)))
                    assertEquals(com.shilapi.xcertplay.web.WebVideoRecords.KIND_FRAME, subscription.take(5000)!!.kind)
                    assertEquals(200, control.status("TEARDOWN", "/"))
                    assertNull(readReceiverRequest(control.getInputStream()))
                } else if (dataEofRecovery) {
                    data.close()
                    assertTrue(listener.ended.await(5, TimeUnit.SECONDS))
                    if (audioDrain) connect(receiver.port).use { competing ->
                        assertEquals(453, competing.status("SETUP", "/", BplistCodec.encode(mapOf("streams" to listOf(
                            mapOf("type" to 110, "streamConnectionID" to 999L),
                        )))))
                    }
                    assertNull(listener.hub.info())
                    assertEquals(com.shilapi.xcertplay.web.WebVideoRecords.KIND_IDLE, subscription.take(5000)!!.kind)
                    assertEquals(200, control.status("OPTIONS", "/"))
                    assertEquals(200, control.status("POST", "/feedback"))
                    assertTrue(listener.logs.any { it.contains("Media clock snapshot: reason=VIDEO_END") })
                    assertFalse("Data EOF must not close the session timing clock", listener.logs.any { it.contains("Media clock final:") })
                    val nextSetup = control.send("SETUP", "/", BplistCodec.encode(mapOf("streams" to listOf(
                        mapOf("type" to 110, "streamConnectionID" to 1235L),
                    ))))
                    assertEquals("200", nextSetup.path)
                    val nextPorts = BplistCodec.decode(nextSetup.body) as Map<*, *>
                    val nextPort = (((nextPorts["streams"] as List<*>).single() as Map<*, *>)["dataPort"] as Number).toInt()
                    connect(nextPort).use { nextData ->
                        nextData.getOutputStream().write(packet(1, avcc))
                        assertEquals(com.shilapi.xcertplay.web.WebVideoRecords.KIND_CONFIG, subscription.take(5000)!!.kind)
                        assertEquals(720, listener.hub.info()!!.width)
                        val nextEncryption = aesCtr(AirPlayCrypto.sha512("AirPlayStreamKey1235".toByteArray(), mirrorKey).copyOf(16),
                            AirPlayCrypto.sha512("AirPlayStreamIV1235".toByteArray(), mirrorKey).copyOf(16))
                        nextData.getOutputStream().write(packet(0, nextEncryption.update(first)))
                        assertEquals(com.shilapi.xcertplay.web.WebVideoRecords.KIND_FRAME, subscription.take(5000)!!.kind)
                        assertEquals(200, control.status("TEARDOWN", "/"))
                        assertTrue(listener.logs.any { it.contains("Media clock final:") })
                        assertNull(readReceiverRequest(control.getInputStream()))
                    }
                } else if (teardown) assertEquals(200, control.status("TEARDOWN", "/")) else control.close()
                assertTrue(listener.ended.await(5, TimeUnit.SECONDS))
                assertNull(listener.hub.info())
            }
            subscription.close()
        } finally { control.close(); receiver.close() }
    }

    @Test fun seekCancellationKeepsTheIphoneExchangeForTheReplacementLoader() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                val url = "mlhls://app/master.m3u8"
                assertEquals(200, control.status("POST", "/play", BplistCodec.encode(mapOf("Content-Location" to url))))
                connect(receiver.port).use { reverse ->
                    reverse.getOutputStream().write("POST /reverse HTTP/1.1\r\nX-Apple-Session-ID: test\r\nUpgrade: PTTH/1.0\r\nContent-Length: 0\r\n\r\n".toByteArray())
                    assertEquals("101", readReceiverRequest(reverse.getInputStream())!!.path)
                    val interrupted = java.util.concurrent.atomic.AtomicBoolean(false)
                    val oldLoader = Thread {
                        assertNull(receiver.loadResource(url))
                        interrupted.set(Thread.currentThread().isInterrupted)
                    }
                    oldLoader.start()
                    val xml = readReceiverRequest(reverse.getInputStream())!!.body.toString(Charsets.UTF_8)
                    val requestId = Regex("<key>FCUP_Response_RequestID</key><integer>([0-9]+)</integer>").find(xml)!!.groupValues[1].toLong()
                    oldLoader.interrupt()
                    oldLoader.join(2000)
                    assertFalse(oldLoader.isAlive)
                    assertTrue(interrupted.get())
                    val replacement = java.util.concurrent.CompletableFuture.supplyAsync { receiver.loadResource(url) }
                    val bytes = "#EXTM3U\n#EXT-X-ENDLIST\n".toByteArray()
                    val answer = BplistCodec.encode(mapOf("type" to "unhandledURLResponse", "params" to mapOf(
                        "FCUP_Response_RequestID" to requestId, "FCUP_Response_URL" to url,
                        "FCUP_Response_Data" to bytes, "FCUP_Response_StatusCode" to 0,
                    )))
                    assertEquals(200, control.status("POST", "/action", answer))
                    assertArrayEquals(bytes, replacement.get(2, TimeUnit.SECONDS)!!.bytes)
                    assertEquals(1, listener.logs.count { it.startsWith("resource stage=REQUEST ") })
                    assertTrue(listener.logs.any { it == "resource stage=REUSED request=$requestId" })
                    assertEquals(404, control.status("POST", "/action", answer))
                }
            }
        } finally { receiver.close() }
    }

    @Test fun iphoneResourcesAreCorrelatedAndReverseDisconnectCancelsWaitingLoadsAndRestoresDisplay() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                val url = "mlhls://app/master.m3u8"
                assertEquals(200, control.status("POST", "/play", BplistCodec.encode(mapOf("Content-Location" to url))))
                connect(receiver.port).use { reverse ->
                    reverse.getOutputStream().write("POST /reverse HTTP/1.1\r\nX-Apple-Session-ID: test\r\nUpgrade: PTTH/1.0\r\nContent-Length: 0\r\n\r\n".toByteArray())
                    assertEquals("101", readReceiverRequest(reverse.getInputStream())!!.path)
                    val future = java.util.concurrent.CompletableFuture.supplyAsync { receiver.loadResource(url) }
                    val event = readReceiverRequest(reverse.getInputStream())!!
                    val xml = event.body.toString(Charsets.UTF_8)
                    assertTrue(xml.contains("<string>unhandledURLRequest</string>"))
                    val requestId = Regex("<key>FCUP_Response_RequestID</key><integer>([0-9]+)</integer>").find(xml)!!.groupValues[1].toLong()
                    val bytes = "#EXTM3U\n#EXT-X-ENDLIST\n".toByteArray()
                    val answer = BplistCodec.encode(mapOf("type" to "unhandledURLResponse", "params" to mapOf(
                        "FCUP_Response_RequestID" to requestId, "FCUP_Response_URL" to url,
                        "FCUP_Response_Data" to bytes, "FCUP_Response_StatusCode" to 0,
                    )))
                    assertEquals(403, control.status("POST", "/action", answer, "wrong-session"))
                    assertFalse(future.isDone)
                    assertEquals(200, control.status("POST", "/action", answer))
                    assertArrayEquals(bytes, future.get(2, TimeUnit.SECONDS)!!.bytes)
                    assertNull(receiver.loadResource("skd://protected"))
                    val pending = java.util.concurrent.CompletableFuture.supplyAsync { receiver.loadResource(url) }
                    assertNotNull(readReceiverRequest(reverse.getInputStream()))
                    reverse.close()
                    assertNull(pending.get(2, TimeUnit.SECONDS))
                    assertTrue(listener.ended.await(2, TimeUnit.SECONDS))
                    assertEquals("listening", listener.states.last())
                }
            }
        } finally { receiver.close() }
    }
}
