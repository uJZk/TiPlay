package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.web.BrowserDisplaySource
import com.shilapi.xcertplay.web.WebMediaSink
import com.shilapi.xcertplay.web.WebVideoHub
import org.junit.Assert.*
import org.junit.Test
import java.io.Closeable
import java.net.InetAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit

class ReceiverMirrorPreparationServerTest {
    @Test fun observationDoesNotCloseControlEventsOrBorrowTheCarPlayScreen() {
        Fixture(40).use { fixture ->
            fixture.peer().use { peer ->
                val transport = peer.prepare(mirror = true)
                val port = ((BplistCodec.decode(transport.body) as Map<*, *>)["eventPort"] as Number).toInt()
                Socket(InetAddress.getByName("127.0.0.1"), port).use { event ->
                    event.soTimeout = 3000
                    fixture.await("observation-elapsed")
                    assertEquals(0, fixture.preparations)
                    assertEquals(0, fixture.authorizations)
                    assertEquals(0, fixture.audioStops)
                    assertTrue(fixture.states.isEmpty())
                    assertEquals("200", peer.request("GET", "/info").path)
                    event.getOutputStream().write("POST /feedback RTSP/1.0\r\nCSeq: 22\r\nContent-Length: 0\r\n\r\n".toByteArray())
                    val feedback = requireNotNull(readReceiverRequest(event.getInputStream()))
                    assertEquals("200", feedback.path)
                    assertEquals("22", feedback.headers["cseq"])
                    assertFalse(fixture.logs.any { "MIRROR_KEYFRAME" in it })
                }
            }
        }
    }

    @Test fun lateVideoSetupStillAcquiresItsApprovedMirrorNormally() {
        Fixture(40).use { fixture ->
            fixture.peer().use { peer ->
                assertEquals("200", peer.prepare(mirror = true).path)
                fixture.await("observation-elapsed")
                val video = peer.request("SETUP", "/stream", BplistCodec.encode(mapOf(
                    "combinedGetInfoWithControlSetup" to true,
                    "streams" to listOf(mapOf("type" to 110, "streamConnectionID" to 1234L)),
                )))
                assertEquals("200", video.path)
                val ports = BplistCodec.decode(video.body) as Map<*, *>
                assertEquals(setOf("streams"), ports.keys)
                val stream = (ports["streams"] as List<*>).single() as Map<*, *>
                assertTrue((stream["dataPort"] as Number).toInt() in 1..65535)
                assertEquals(1, fixture.preparations)
                assertEquals(1, fixture.authorizations)
                assertTrue(fixture.logs.any { "reason=stream-setup" in it && "afterObservation=true" in it })
                assertTrue(fixture.states.contains("mirror"))
            }
        }
    }

    @Test fun anAudioStreamRetiresTheObservationAndKeepsItsOwnMediaAlive() {
        Fixture(250).use { fixture ->
            fixture.peer().use { peer ->
                assertEquals("200", peer.prepare(mirror = true).path)
                val audio = peer.request("SETUP", "/stream", BplistCodec.encode(mapOf("streams" to listOf(mapOf(
                    "type" to 96, "ct" to 1, "sr" to 44100, "ch" to 2, "spf" to 352, "controlPort" to 0,
                )))))
                assertEquals("200", audio.path)
                fixture.await("reason=audio-setup")
                Thread.sleep(300)
                assertFalse(fixture.logs.any { "state=observation-elapsed" in it })
                assertEquals(0, fixture.preparations)
                assertEquals(0, fixture.audioStops)
                assertEquals(listOf("audio"), fixture.states.toList())
                assertEquals("200", peer.request("GET", "/info").path)
            }
        }
    }

    @Test fun genericAudioTransportsAndClosedConnectionsHaveNoLateMirrorObservation() {
        for (mirror in listOf<Boolean?>(null, false, true)) {
            Fixture(80).use { fixture ->
                val peer = fixture.peer()
                assertEquals("200", peer.prepare(mirror).path)
                if (mirror == true) {
                    peer.close()
                    fixture.await("reason=control-closed")
                }
                Thread.sleep(120)
                assertFalse(fixture.logs.any { "state=observation-elapsed" in it })
                if (mirror != true) {
                    assertFalse(fixture.logs.any { "MIRROR_PREPARATION" in it })
                    assertEquals("200", peer.request("GET", "/info").path)
                    peer.close()
                }
                assertEquals(0, fixture.preparations)
            }
        }
    }

    private class Fixture(observationMillis: Long) : Closeable, ReceiverServer.Listener {
        val logs = CopyOnWriteArrayList<String>()
        val states = CopyOnWriteArrayList<String>()
        @Volatile var preparations = 0
        @Volatile var authorizations = 0
        @Volatile var audioStops = 0
        private val hub = WebVideoHub(Executor { it.run() })
        private val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(),
            audioOutputFormats = ReceiverAudioCapabilities.OUTPUT_FORMATS), this,
            fairPlayReply = { ByteArray(if (it.size == 16) 142 else 32) },
            fairPlayDecrypt = { _, _ -> ByteArray(16) })

        init { receiver.mirrorPreparationObservationMillis = observationMillis; receiver.start() }
        fun peer() = Peer(receiver.port)
        fun await(marker: String) {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
            while (!logs.any { marker in it } && System.nanoTime() < deadline) Thread.sleep(1)
            assertTrue(marker, logs.any { marker in it })
        }
        override fun prepareMirror() { preparations++ }
        override fun mirrorSink() = WebMediaSink(hub, 720, 1280, 60, BrowserDisplaySource.AIRPLAY)
        override fun authorizeConnection(sessionToken: String, deviceName: String): Boolean { authorizations++; return true }
        override fun stopMirrorAudio() { audioStops++ }
        override fun play(item: ReceiverPlay) = error("mirror setup must not start URL playback")
        override fun stopPlayback() {}
        override fun seek(seconds: Double) {}
        override fun rate(value: Double) {}
        override fun playback() = ReceiverPlayback()
        override fun status(state: String) { states.add(state) }
        override fun log(message: String) { logs.add(message) }
        override fun close() = receiver.close()
    }

    private class Peer(port: Int) : Closeable {
        private val socket = Socket(InetAddress.getByName("127.0.0.1"), port).apply { soTimeout = 3000 }
        private var sequence = 0
        fun prepare(mirror: Boolean?): RtspMessage.Request {
            for ((size, step) in listOf(16 to 1, 164 to 3)) {
                val fairPlay = ByteArray(size).apply {
                    byteArrayOf(0x46, 0x50, 0x4c, 0x59, 3, 1, step.toByte(), 0).copyInto(this)
                    ByteBuffer.wrap(this, 8, 4).putInt(size - 12)
                }
                assertEquals("200", request("POST", "/fp-setup", fairPlay).path)
            }
            val fields = mutableMapOf<String, Any>("ekey" to ByteArray(72), "eiv" to ByteArray(16),
                "timingPort" to 0, "timingProtocol" to "NTP", "combinedGetInfoWithControlSetup" to true)
            if (mirror != null) fields["isScreenMirroringSession"] = mirror
            return request("SETUP", "/session", BplistCodec.encode(fields))
        }
        fun request(method: String, target: String, body: ByteArray = ByteArray(0)): RtspMessage.Request {
            val header = "$method $target RTSP/1.0\r\nCSeq: ${++sequence}\r\nContent-Type: application/x-apple-binary-plist\r\nContent-Length: ${body.size}\r\n\r\n"
            socket.getOutputStream().apply { write(header.toByteArray() + body); flush() }
            return requireNotNull(readReceiverRequest(socket.getInputStream()))
        }
        override fun close() = socket.close()
    }
}
