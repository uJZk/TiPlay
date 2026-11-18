package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.web.BrowserDisplaySource
import com.shilapi.xcertplay.web.WebMediaSink
import com.shilapi.xcertplay.web.WebVideoHub
import java.io.BufferedInputStream
import java.io.ByteArrayInputStream
import java.io.Closeable
import java.io.InputStream
import java.io.SequenceInputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test

/** Original accepted sockets and synthetic protocol metadata; no proxy or captured sender data. */
class ReceiverLegacyConnectionServerTest {
    @Test fun queuedRequestsPrefetchedBytesAndLiveInputKeepTheOriginalPeerAndControlThread() {
        Fixture().use { fixture ->
            SocketPair(sender = "127.0.0.2").use { pair ->
                DatagramSocket(InetSocketAddress(InetAddress.getByName("127.0.0.2"), 0)).use { timing ->
                    timing.soTimeout = 3000
                    val control = request("SETUP", "/session", 2, BplistCodec.encode(mapOf(
                        "ekey" to ByteArray(72), "eiv" to ByteArray(16), "timingPort" to timing.localPort,
                        "timingProtocol" to "NTP", "isScreenMirroringSession" to true,
                        "combinedGetInfoWithControlSetup" to true, "deviceID" to "02:AA:22:33:44:55",
                    )))
                    pair.write(wire(control) + wire(request("GET_PARAMETER", "/", 3)))
                    val buffered = BufferedInputStream(pair.accepted.getInputStream(), 8192)
                    val restPrefix = ByteArray(7)
                    for (i in restPrefix.indices) restPrefix[i] = buffered.read().also { assertTrue(it >= 0) }.toByte()
                    val input = SequenceInputStream(ByteArrayInputStream(restPrefix), buffered)
                    val serving = fixture.serve(pair, input, listOf(fairPlay(16, 0), fairPlay(164, 1)))
                    assertResponse(pair.read(), 0, 142)
                    assertResponse(pair.read(), 1, 32)
                    val setup = pair.read()
                    assertResponse(setup, 2)
                    assertResponse(pair.read(), 3)
                    assertEquals(0, fixture.authorizations.size)
                    assertEquals(0, fixture.preparations.get())
                    // A loopback proxy would send timing to 127.0.0.1 and this bound peer could not receive it.
                    val packet = DatagramPacket(ByteArray(64), 64)
                    timing.receive(packet)
                    val ports = BplistCodec.decode(setup.body) as Map<*, *>
                    assertEquals((ports["timingPort"] as Number).toInt(), packet.port)
                    assertEquals(210, packet.data[1].toInt() and 0xff)
                    pair.write(wire(request("SETUP", "/stream", 4, BplistCodec.encode(mapOf(
                        "streams" to listOf(mapOf("type" to 110, "streamConnectionID" to 1234L)),
                    )))))
                    val mirror = pair.read()
                    assertResponse(mirror, 4)
                    val stream = ((BplistCodec.decode(mirror.body) as Map<*, *>)["streams"] as List<*>).single() as Map<*, *>
                    assertTrue((stream["dataPort"] as Number).toInt() in 1..65535)
                    val expected = ReceiverSenderIdentity.identity(emptyMap(), mapOf("deviceID" to "02:AA:22:33:44:55"))
                    assertArrayEquals(expected, fixture.authorizations.single())
                    assertEquals(1, fixture.preparations.get())
                    assertTrue(fixture.callbackThreads.all { it.startsWith("synthetic-airplay-control-") })
                    assertFalse(serving.isDone)
                    pair.write(wire(request("TEARDOWN", "/session", 5)))
                    assertResponse(pair.read(), 5)
                    pair.client.close()
                    assertTrue(serving.get(3, TimeUnit.SECONDS))
                    assertTrue(pair.accepted.isClosed)
                    assertEquals(1, fixture.ended.size)
                }
            }
        }
    }

    @Test fun closedUnstartedAndRetiredReceiversRejectWithoutReadingOrClosingTheCallersSocket() {
        Fixture(start = false).use { assertRejectedWithoutTakingSocket(it.receiver) }
        Fixture().use { closed ->
            closed.receiver.close()
            assertRejectedWithoutTakingSocket(closed.receiver)
        }
        Fixture().use { retired ->
            Fixture().use { replacement ->
                assertRejectedWithoutTakingSocket(retired.receiver)
                retired.receiver.close()
                SocketPair().use { pair ->
                    assertTrue(replacement.receiver.serveLegacyConnection(pair.accepted,
                        ByteArrayInputStream(ByteArray(0)), listOf(fairPlay(16, 0))))
                    assertResponse(pair.read(), 0, 142)
                }
            }
        }
    }

    @Test fun originalAndAdoptedConnectionsShareTwelveSlotsAndAnEndedHandoffReturnsItsSlot() {
        Fixture().use { fixture ->
            val ordinary = mutableListOf<Socket>()
            val adopted = mutableListOf<SocketPair>()
            val running = mutableListOf<CompletableFuture<Boolean>>()
            try {
                repeat(6) { index ->
                    val socket = Socket(InetAddress.getByName("127.0.0.1"), fixture.receiver.port).apply { soTimeout = 3000 }
                    ordinary.add(socket)
                    socket.getOutputStream().apply { write(wire(request("GET", "/info", index))); flush() }
                    assertResponse(requireNotNull(readReceiverRequest(socket.getInputStream())), index)
                }
                repeat(6) {
                    val pair = SocketPair()
                    adopted.add(pair)
                    running.add(fixture.serve(pair, pair.accepted.getInputStream(), listOf(fairPlay(16, 0))))
                    assertResponse(pair.read(), 0, 142)
                }
                assertRejectedWithoutTakingSocket(fixture.receiver)
                adopted.first().client.close()
                assertTrue(running.first().get(3, TimeUnit.SECONDS))
                SocketPair().use { replacement ->
                    assertTrue(fixture.receiver.serveLegacyConnection(replacement.accepted,
                        ByteArrayInputStream(ByteArray(0)), listOf(fairPlay(16, 0))))
                    assertResponse(replacement.read(), 0, 142)
                }
                // Its synchronous return includes the release; the slot is available again immediately.
                SocketPair().use { replacement ->
                    assertTrue(fixture.receiver.serveLegacyConnection(replacement.accepted,
                        ByteArrayInputStream(ByteArray(0)), listOf(fairPlay(16, 0))))
                    assertResponse(replacement.read(), 0, 142)
                }
            } finally {
                ordinary.forEach { it.close() }
                adopted.forEach { it.close() }
                running.forEach { assertTrue(it.get(3, TimeUnit.SECONDS)) }
            }
        }
    }

    @Test fun shutdownClosesAnAdoptedSocketAndEndsItsAuthorizationSessionExactlyOnce() {
        Fixture().use { fixture ->
            SocketPair().use { pair ->
                val serving = fixture.serve(pair, pair.accepted.getInputStream(), listOf(fairPlay(16, 0)))
                assertResponse(pair.read(), 0, 142)
                assertFalse(serving.isDone)
                fixture.receiver.close()
                assertTrue(serving.get(3, TimeUnit.SECONDS))
                assertTrue(pair.accepted.isClosed)
                assertEquals(-1, pair.client.getInputStream().read())
                assertEquals(1, fixture.ended.size)
                assertRejectedWithoutTakingSocket(fixture.receiver)
            }
        }
    }

    @Test fun aSecondHandoffCannotReadOrRetireAnAlreadyOwnedSocket() {
        Fixture().use { fixture ->
            SocketPair().use { pair ->
                val serving = fixture.serve(pair, pair.accepted.getInputStream(), listOf(fairPlay(16, 0)))
                assertResponse(pair.read(), 0, 142)
                val duplicateInput = UnreadInput()
                assertFalse(fixture.receiver.serveLegacyConnection(pair.accepted, duplicateInput, listOf(fairPlay(16, 0))))
                assertEquals(0, duplicateInput.reads.get())
                assertFalse(pair.accepted.isClosed)
                pair.write(wire(request("GET", "/info", 1)))
                assertResponse(pair.read(), 1)
                pair.client.close()
                assertTrue(serving.get(3, TimeUnit.SECONDS))
                assertEquals(1, fixture.ended.size)
            }
        }
    }

    @Test fun anOversizedAlreadyParsedControlBodyStillReturns413WithoutReadingTheFollowingInput() {
        Fixture().use { fixture ->
            SocketPair().use { pair ->
                val following = UnreadInput()
                val serving = fixture.serve(pair, following, listOf(fairPlay(16, 0),
                    request("GET", "/info", 1, ByteArray(1024 * 1024 + 1))))
                assertResponse(pair.read(), 0, 142)
                val rejected = pair.read()
                assertEquals("413", rejected.path)
                assertEquals("1", rejected.headers["cseq"])
                assertEquals("close", rejected.headers["connection"])
                assertTrue(serving.get(3, TimeUnit.SECONDS))
                assertEquals(0, following.reads.get())
                assertTrue(pair.accepted.isClosed)
                assertTrue(fixture.authorizations.isEmpty())
            }
        }
    }

    private fun assertRejectedWithoutTakingSocket(receiver: ReceiverServer) {
        SocketPair().use { pair ->
            pair.accepted.soTimeout = 1234
            val input = UnreadInput()
            assertFalse(receiver.serveLegacyConnection(pair.accepted, input, listOf(fairPlay(16, 0))))
            assertEquals(0, input.reads.get())
            assertFalse(pair.accepted.isClosed)
            assertEquals(1234, pair.accepted.soTimeout)
            pair.accepted.getOutputStream().apply { write(byteArrayOf(42)); flush() }
            assertEquals(42, pair.client.getInputStream().read())
        }
    }

    private class UnreadInput : InputStream() {
        val reads = AtomicInteger()
        override fun read(): Int { reads.incrementAndGet(); return -1 }
    }

    private class Fixture(start: Boolean = true) : Closeable, ReceiverServer.Listener {
        val authorizations = CopyOnWriteArrayList<ByteArray>()
        val callbackThreads = CopyOnWriteArrayList<String>()
        val ended = CopyOnWriteArrayList<String>()
        val preparations = AtomicInteger()
        private val hub = WebVideoHub(Executor { it.run() })
        private val workerNumber = AtomicInteger()
        private val workers = Executors.newCachedThreadPool {
            Thread(it, "synthetic-airplay-control-${workerNumber.incrementAndGet()}").apply { isDaemon = true }
        }
        val receiver = ReceiverServer(ReceiverConfig("Synthetic receiver", "02:11:22:33:44:55",
            AirPlayIdentity.generate(), audioOutputFormats = ReceiverAudioCapabilities.OUTPUT_FORMATS), this,
            fairPlayReply = { ByteArray(if (it.size == 16) 142 else 32) },
            fairPlayDecrypt = { _, _ -> ByteArray(16) })
        init { if (start) receiver.start() }
        fun serve(pair: SocketPair, input: InputStream, initial: List<RtspMessage.Request>) =
            CompletableFuture.supplyAsync({ receiver.serveLegacyConnection(pair.accepted, input, initial) }, workers)
        override fun authorizeDevice(sessionToken: String, identity: ByteArray, deviceName: String,
            mediaType: String, verifiedSessionId: String?): Boolean {
            authorizations.add(identity.copyOf())
            callbackThreads.add(Thread.currentThread().name)
            return true
        }
        override fun prepareMirror() {
            preparations.incrementAndGet()
            callbackThreads.add(Thread.currentThread().name)
        }
        override fun mirrorSink() = WebMediaSink(hub, 720, 1280, 60, BrowserDisplaySource.AIRPLAY)
        override fun onAuthorizationSessionEnded(sessionToken: String) { ended.add(sessionToken) }
        override fun play(item: ReceiverPlay) = error("Unexpected URL playback")
        override fun stopPlayback() {}
        override fun seek(seconds: Double) {}
        override fun rate(value: Double) {}
        override fun playback() = ReceiverPlayback()
        override fun status(state: String) {}
        override fun log(message: String) {}
        override fun close() { receiver.close(); workers.shutdownNow() }
    }

    private class SocketPair(sender: String = "127.0.0.1") : Closeable {
        val client: Socket
        val accepted: Socket
        init {
            val listener = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
            try {
                client = Socket(listener.inetAddress, listener.localPort, InetAddress.getByName(sender), 0)
                    .apply { soTimeout = 3000 }
                accepted = listener.accept()
            } finally { listener.close() }
        }
        fun write(bytes: ByteArray) { client.getOutputStream().apply { write(bytes); flush() } }
        fun read() = requireNotNull(readReceiverRequest(client.getInputStream()))
        override fun close() { client.close(); accepted.close() }
    }

    companion object {
        private fun request(method: String, path: String, sequence: Int, body: ByteArray = ByteArray(0)) =
            RtspMessage.Request(method, path, "RTSP/1.0", mapOf("cseq" to sequence.toString(),
                "content-type" to "application/x-apple-binary-plist", "content-length" to body.size.toString()), body)
        private fun fairPlay(size: Int, sequence: Int) = request("POST", "/fp-setup", sequence,
            ByteArray(size).apply {
                byteArrayOf(0x46, 0x50, 0x4c, 0x59, 3, 1, (if (size == 16) 1 else 3).toByte(), 0).copyInto(this)
                ByteBuffer.wrap(this, 8, 4).putInt(size - 12)
            })
        private fun wire(request: RtspMessage.Request): ByteArray =
            ("${request.method} ${request.path} ${request.protocol}\r\n" +
                request.headers.entries.joinToString("") { "${it.key}: ${it.value}\r\n" } + "\r\n").toByteArray() + request.body
        private fun assertResponse(response: RtspMessage.Request, sequence: Int, bytes: Int? = null) {
            assertEquals("200", response.path)
            assertEquals(sequence.toString(), response.headers["cseq"])
            if (bytes != null) assertEquals(bytes, response.body.size)
        }
    }
}
