package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayCrypto
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.web.BrowserDisplaySource
import com.shilapi.xcertplay.web.WebMediaSink
import com.shilapi.xcertplay.web.WebVideoHub
import com.shilapi.xcertplay.web.WebVideoRecords
import org.junit.Assert.*
import org.junit.Test
import java.io.Closeable
import java.net.InetAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit

/** Full legacy receiver negotiation and real CTR frames, without a browser/native decoder stand-in. */
class ReceiverMirrorKeyFrameTest {
    @Test fun pendingRecoveryWaitsForValidatedSourceFrameButNotBrowserReady() {
        Fixture().use { fixture ->
            fixture.event().use { event ->
                fixture.stream().use { stream ->
                    fixture.hub.subscribe(reliable = true, awaitVideoReady = true).use { subscription ->
                        stream.config()
                        val config = requireNotNull(subscription.take(3000))
                        assertEquals(WebVideoRecords.KIND_CONFIG, config.kind)
                        repeat(20) { fixture.hub.requestKeyFrame(force = true) }
                        assertSilent(event)
                        stream.frame(IDR)
                        // The source reader is now held at the six-second video-ready barrier.
                        // Recovery still has to reach the sender before that barrier is released.
                        val request = command(event)
                        assertFalse(fixture.logs.any { "mirror stage=FORWARDED" in it })
                        event.acknowledge(request)
                        assertTrue(subscription.videoReady(config.epoch))
                        val frame = requireNotNull(subscription.take(3000))
                        assertEquals(WebVideoRecords.KIND_FRAME, frame.kind)
                        assertTrue(frame.keyFrame)
                        assertArrayEquals(byteArrayOf(0, 0, 0, 1, 0x65, 1, 2), frame.payload)
                        // A repeated SPS/PPS returned with the requested IDR keeps this ready epoch.
                        stream.config()
                        stream.frame(IDR)
                        val next = requireNotNull(subscription.take(3000))
                        assertEquals(WebVideoRecords.KIND_FRAME, next.kind)
                        assertEquals(config.epoch, next.epoch)
                    }
                }
            }
        }
    }

    @Test fun recoveryDemandSurvivesAnEventConnectionThatArrivesAfterSourceFrames() {
        Fixture().use { fixture ->
            fixture.stream().use { stream ->
                stream.config()
                await("source configuration") { fixture.hub.info()?.epoch != null }
                fixture.hub.requestKeyFrame(force = true)
                stream.frame(IDR)
                await("original frame forwarded") { fixture.logs.any { "mirror stage=FORWARDED" in it } }
                fixture.event().use { event ->
                    event.acknowledge(command(event))
                    assertEquals("200", fixture.control("GET", "/info").path)
                }
            }
        }
    }

    @Test fun validatedSeiWithoutAPictureDoesNotActivatePendingRecovery() {
        Fixture().use { fixture ->
            fixture.event().use { event ->
                fixture.stream().use { stream ->
                    stream.config()
                    await("source configuration") { fixture.hub.info()?.epoch != null }
                    fixture.hub.requestKeyFrame(force = true)
                    // A valid SEI RBSP trailing stop bit carries no VCL picture.
                    stream.frame(byteArrayOf(0, 0, 0, 2, 0x06, 0x80.toByte()))
                    await("auxiliary AU processed") { fixture.logs.any { "mirror stage=FORWARDED" in it } }
                    assertSilent(event)
                    stream.frame(IDR)
                    event.acknowledge(command(event))
                }
            }
        }
    }

    @Test fun configurationAndInvalidEncryptedAuNeverAuthorizeAKeyFrameCommand() {
        Fixture().use { fixture ->
            fixture.event().use { event ->
                fixture.stream().use { stream ->
                    stream.config()
                    await("source configuration") { fixture.hub.info()?.epoch != null }
                    fixture.hub.requestKeyFrame(force = true)
                    assertSilent(event)
                    // Correctly encrypted bytes with an impossible NAL length fail AU validation.
                    stream.frame(byteArrayOf(0, 0, 0, 20, 0x65))
                    await("invalid AU retires mirror") { fixture.logs.any { "mirror stage=END reason=FAILED" in it } }
                    assertSilent(event)
                    // Retiring video must not retire the connection's audio/control acknowledgements.
                    event.getOutputStream().write("POST /feedback RTSP/1.0\r\nCSeq: 42\r\nContent-Length: 0\r\n\r\n".toByteArray())
                    val response = requireNotNull(readReceiverRequest(event.getInputStream()))
                    assertEquals("RTSP/1.0", response.method)
                    assertEquals("200", response.path)
                    assertEquals("42", response.headers["cseq"])
                    assertEquals("200", fixture.control("GET", "/info").path)
                }
            }
        }
    }

    private class Fixture : Closeable, ReceiverServer.Listener {
        val logs = CopyOnWriteArrayList<String>()
        val hub = WebVideoHub(Executor { it.run() })
        private val key = ByteArray(16) { (it + 1).toByte() }
        private val receiver = ReceiverServer(
            ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), this,
            fairPlayReply = { ByteArray(if (it.size == 16) 142 else 32) }, fairPlayDecrypt = { _, _ -> key },
        )
        private val control: Socket
        private val eventPort: Int
        private var sequence = 0
        private var connectionId = 1234L

        init {
            receiver.start()
            control = connect(receiver.port)
            fun fairPlay(size: Int, sequence: Int) = ByteArray(size).apply {
                byteArrayOf(0x46, 0x50, 0x4c, 0x59, 3, 1, sequence.toByte(), 0).copyInto(this)
                ByteBuffer.wrap(this, 8, 4).putInt(size - 12)
            }
            assertEquals("200", control("POST", "/fp-setup", fairPlay(16, 1)).path)
            assertEquals("200", control("POST", "/fp-setup", fairPlay(164, 3)).path)
            val setup = control("SETUP", "/session", BplistCodec.encode(mapOf(
                "eiv" to ByteArray(16), "ekey" to ByteArray(72), "timingPort" to 0,
                "timingProtocol" to "NTP", "isScreenMirroringSession" to true,
            )))
            assertEquals("200", setup.path)
            eventPort = ((BplistCodec.decode(setup.body) as Map<*, *>)["eventPort"] as Number).toInt()
            assertTrue(eventPort in 1..65535)
            assertNotEquals(receiver.port, eventPort)
        }

        fun event() = connect(eventPort)
        fun stream(): Stream {
            val id = connectionId++
            val setup = control("SETUP", "/stream", BplistCodec.encode(mapOf("streams" to listOf(mapOf(
                "type" to 110, "streamConnectionID" to id,
            )))))
            assertEquals("200", setup.path)
            val entry = (((BplistCodec.decode(setup.body) as Map<*, *>)["streams"] as List<*>).single() as Map<*, *>)
            return Stream(connect((entry["dataPort"] as Number).toInt()), id, key)
        }

        fun control(method: String, path: String, body: ByteArray = ByteArray(0)): RtspMessage.Request {
            val header = "$method $path RTSP/1.0\r\nCSeq: ${++sequence}\r\nContent-Type: application/x-apple-binary-plist\r\nContent-Length: ${body.size}\r\n\r\n"
            control.getOutputStream().apply { write(header.toByteArray() + body); flush() }
            return requireNotNull(readReceiverRequest(control.getInputStream()))
        }

        override fun authorizeConnection(sessionToken: String, deviceName: String) = true
        override fun mirrorSink() = WebMediaSink(hub, 720, 1280, 60, BrowserDisplaySource.AIRPLAY)
        override fun play(item: ReceiverPlay) = error("mirror must not open URL playback")
        override fun stopPlayback() {}
        override fun seek(seconds: Double) {}
        override fun rate(value: Double) {}
        override fun playback() = ReceiverPlayback()
        override fun status(state: String) {}
        override fun log(message: String) { logs.add(message) }
        override fun close() {
            control.close()
            receiver.close()
        }
    }

    private class Stream(private val socket: Socket, id: Long, key: ByteArray) : Closeable {
        private val encryption = aesCtr(
            AirPlayCrypto.sha512("AirPlayStreamKey$id".toByteArray(), key).copyOf(16),
            AirPlayCrypto.sha512("AirPlayStreamIV$id".toByteArray(), key).copyOf(16),
        )
        fun config() = packet(1, ReceiverSdrFixtures.avcc())
        fun frame(avcc: ByteArray) = packet(0, encryption.update(avcc))
        private fun packet(type: Int, body: ByteArray) {
            val header = ByteBuffer.allocate(128).order(ByteOrder.LITTLE_ENDIAN).apply {
                putInt(0, body.size)
                put(4, type.toByte())
                putFloat(56, 720f)
                putFloat(60, 1280f)
            }.array()
            socket.getOutputStream().apply { write(header); write(body); flush() }
        }
        override fun close() = socket.close()
    }

    companion object {
        private val IDR = byteArrayOf(0, 0, 0, 3, 0x65, 1, 2)
        private fun connect(port: Int) = Socket(InetAddress.getByName("127.0.0.1"), port).apply { soTimeout = 3000 }
        private fun command(event: Socket) = requireNotNull(readReceiverRequest(event.getInputStream())).also {
            assertEquals("POST", it.method)
            assertEquals("/command", it.path)
            assertEquals("RTSP/1.0", it.protocol)
            assertEquals("application/x-apple-binary-plist", it.headers["content-type"])
            assertEquals(mapOf("type" to "forceKeyFrame"), BplistCodec.decode(it.body))
            assertTrue(it.headers.getValue("cseq").toLong() > 0)
        }
        private fun Socket.acknowledge(request: RtspMessage.Request) {
            getOutputStream().apply { write(RtspMessage.buildResponse(request, RtspMessage.Response())); flush() }
        }
        private fun assertSilent(socket: Socket) {
            socket.soTimeout = 100
            try { assertThrows(SocketTimeoutException::class.java) { readReceiverRequest(socket.getInputStream()) } }
            finally { socket.soTimeout = 3000 }
        }
        private fun await(description: String, condition: () -> Boolean) {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
            while (!condition() && System.nanoTime() < deadline) Thread.sleep(1)
            assertTrue(description, condition())
        }
    }
}
