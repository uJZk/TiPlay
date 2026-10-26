package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.web.WebMediaSink
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class ReceiverDacpServerTest {
    @Test fun currentSenderCommandsUseDacpAndWaitForAuthoritativeProgressAfterHttpAcknowledgement() {
        DacpPeer { ACK }.use { dacp ->
            Fixture().use { fixture ->
                fixture.advertise(dacp.port)
                fixture.sender().use { sender ->
                    fixture.awaitActions("previous", "next")
                    assertFalse(fixture.receiver.remoteAudio("skip-forward"))
                    sender.progress(15_000)
                    fixture.awaitActions("previous", "next", "skip-back", "skip-forward")
                    val metadataCount = fixture.listener.metadata.size

                    assertTrue(fixture.receiver.remoteAudio("next"))
                    dacp.request("nextitem", TOKEN)
                    assertEquals(true, fixture.listener.finished.poll(2, TimeUnit.SECONDS))
                    assertFalse("HTTP 204 alone must not release pending sender state", fixture.receiver.remoteAudio("previous"))
                    assertEquals("Remote acknowledgement must not invent a metadata/progress update", metadataCount, fixture.listener.metadata.size)

                    sender.title("Next sender track")
                    fixture.awaitActions("previous", "next")
                    assertFalse("A new title cannot reuse the preceding track's seek coordinates", fixture.receiver.remoteAudio("skip-forward"))
                    assertEquals(1, fixture.listener.requested.get())
                    assertEquals("Next sender track", fixture.listener.metadata.last().title)
                    sender.progress(15_000)
                    fixture.awaitActions("previous", "next", "skip-back", "skip-forward")
                    assertTrue(fixture.receiver.remoteAudio("previous"))
                    dacp.request("previtem", TOKEN)
                    assertEquals(true, fixture.listener.finished.poll(2, TimeUnit.SECONDS))
                    sender.progress(5_000)
                    assertTrue(fixture.receiver.remoteAudio("skip-back"))
                    dacp.request("setproperty?dacp.playingtime=0", TOKEN)
                    assertEquals(true, fixture.listener.finished.poll(2, TimeUnit.SECONDS))
                    sender.progress(59_000)
                    assertTrue(fixture.receiver.remoteAudio("skip-forward"))
                    dacp.request("setproperty?dacp.playingtime=60000", TOKEN)
                    assertEquals(true, fixture.listener.finished.poll(2, TimeUnit.SECONDS))
                    assertEquals(4, fixture.listener.requested.get())
                    assertEquals(0, fixture.listener.screenLoans.get())
                }
            }
        }
    }

    @Test fun onlyMatchingPeerAndIdWithCompleteCredentialsExposeRemoteActionsAndPartialRefreshesKeepTheOtherField() {
        DacpPeer { ACK }.use { dacp ->
            Fixture().use { fixture ->
                fixture.advertise(dacp.port)
                fixture.sender(headers = "DACP-ID: $ID\r\n").use { sender ->
                    fixture.awaitActions()
                    assertFalse(fixture.receiver.remoteAudio("next"))
                    assertEquals("200", sender.request("OPTIONS", headers = credentials()).path)
                    fixture.awaitActions("previous", "next")

                    fixture.advertise(dacp.port, addresses = listOf(InetAddress.getByName("127.0.0.2")))
                    fixture.awaitActions()
                    assertFalse(fixture.receiver.remoteAudio("previous"))
                    fixture.advertise(dacp.port, id = "BAD")
                    fixture.awaitActions()
                    assertFalse(fixture.receiver.remoteAudio("next"))
                    fixture.advertise(dacp.port)
                    fixture.awaitActions("previous", "next")

                    assertEquals("200", sender.request("OPTIONS", headers = "Active-Remote: 987654321\r\n").path)
                    assertTrue(fixture.receiver.remoteAudio("next"))
                    dacp.request("nextitem", "987654321")
                    assertEquals(true, fixture.listener.finished.poll(2, TimeUnit.SECONDS))
                    sender.progress(1_000)
                    assertEquals("200", sender.request("OPTIONS", headers = "DACP-ID: 0000${ID.lowercase()}\r\n").path)
                    assertTrue(fixture.receiver.remoteAudio("previous"))
                    dacp.request("previtem", "987654321")
                    assertEquals(true, fixture.listener.finished.poll(2, TimeUnit.SECONDS))
                    sender.progress(2_000)
                    assertEquals("200", sender.request("OPTIONS", headers = "Active-Remote: invalid\r\n").path)
                    fixture.awaitActions()
                    assertFalse(fixture.receiver.remoteAudio("next"))
                }
            }
        }
    }

    @Test fun teardownCancelsTheOldCommandAndTheSuccessorUsesOnlyItsOwnToken() {
        DacpPeer { index -> if (index == 0) null else ACK }.use { dacp ->
            Fixture().use { fixture ->
                fixture.advertise(dacp.port)
                fixture.sender().use { retired ->
                    assertTrue(fixture.receiver.remoteAudio("next"))
                    dacp.request("nextitem", TOKEN)
                    assertFalse("Another click cannot queue behind an in-flight sender command", fixture.receiver.remoteAudio("previous"))
                    assertEquals("200", retired.request("TEARDOWN").path)
                    assertTrue("TEARDOWN must close the retired DACP response reader", dacp.cancelled.await(2, TimeUnit.SECONDS))
                    assertFalse(fixture.receiver.remoteAudio("next"))
                }
                fixture.sender(headers = credentials("31415926")).use {
                    assertTrue(fixture.receiver.remoteAudio("previous"))
                    dacp.request("previtem", "31415926")
                    assertEquals(true, fixture.listener.finished.poll(2, TimeUnit.SECONDS))
                    assertNull("A retired response cannot report into the successor", fixture.listener.finished.poll(100, TimeUnit.MILLISECONDS))
                    assertEquals(0, fixture.listener.screenLoans.get())
                }
            }
        }
    }

    @Test fun replacingTheDiscoveredPortCancelsTheOldReadAndRoutesTheNextCommandToTheNewEndpoint() {
        DacpPeer { null }.use { old ->
            DacpPeer { ACK }.use { replacement ->
                Fixture().use { fixture ->
                    fixture.advertise(old.port)
                    fixture.sender().use {
                        assertTrue(fixture.receiver.remoteAudio("next"))
                        old.request("nextitem", TOKEN)
                        fixture.advertise(replacement.port)
                        assertTrue(old.cancelled.await(2, TimeUnit.SECONDS))
                        fixture.awaitActions("previous", "next")
                        assertTrue(fixture.receiver.remoteAudio("previous"))
                        replacement.request("previtem", TOKEN)
                        assertEquals(true, fixture.listener.finished.poll(2, TimeUnit.SECONDS))
                        assertNull(fixture.listener.finished.poll(100, TimeUnit.MILLISECONDS))
                    }
                }
            }
        }
    }

    @Test fun validDurationAndSampleRateGateSkipsAndANewSenderProgressCanMoveBackwards() {
        DacpPeer { ACK }.use { dacp ->
            Fixture().use { fixture ->
                fixture.advertise(dacp.port)
                fixture.sender().use { sender ->
                    sender.progress(0, durationMillis = 0)
                    fixture.awaitActions("previous", "next")
                    assertFalse(fixture.receiver.remoteAudio("skip-back"))
                    sender.audio(1, 44_100 * 50)
                    assertNotNull(fixture.listener.samples.poll(2, TimeUnit.SECONDS))
                    sender.progress(5_000)
                    fixture.awaitActions("previous", "next", "skip-back", "skip-forward")
                    assertTrue(fixture.receiver.remoteAudio("skip-back"))
                    dacp.request("setproperty?dacp.playingtime=0", TOKEN)
                    assertEquals(true, fixture.listener.finished.poll(2, TimeUnit.SECONDS))
                }
            }
        }
    }

    private class Fixture : Closeable {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(),
            audioOutputFormats = ReceiverAudioCapabilities.OUTPUT_FORMATS), listener)
        private val scope = Any()
        private val peer = InetAddress.getByName("127.0.0.1")
        private var advertisedName: String? = null
        init { receiver.start(); receiver.dacpDiscovery.directory.attach(scope) }
        fun advertise(port: Int, id: String = ID, addresses: List<InetAddress> = listOf(peer)) {
            val name = "iTunes_Ctrl_$id"
            advertisedName?.takeIf { it != name }?.let { receiver.dacpDiscovery.directory.remove(scope, it) }
            receiver.dacpDiscovery.directory.update(scope, name, addresses, port)
            advertisedName = name
        }
        fun sender(headers: String = credentials()) = Sender(receiver.port, headers)
        fun awaitActions(vararg expected: String) {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
            while (listener.actions != expected.toList() && System.nanoTime() < deadline) Thread.sleep(1)
            assertEquals(expected.toList(), listener.actions)
        }
        override fun close() { receiver.close() }
    }

    private class Sender(port: Int, headers: String) : Closeable {
        private val socket = Socket("127.0.0.1", port).apply { soTimeout = 3000 }
        private val udp = DatagramSocket()
        private val audioPort: Int
        init {
            val sdp = "v=0\r\nm=audio 0 RTP/AVP 96\r\na=rtpmap:96 L16/44100/2\r\n".toByteArray()
            assertEquals("200", request("ANNOUNCE", sdp, "Content-Type: application/sdp\r\n$headers").path)
            val setup = request("SETUP", headers = "Transport: RTP/AVP/UDP;unicast;mode=record;" +
                "control_port=${udp.localPort};timing_port=${udp.localPort}\r\n")
            assertEquals("200", setup.path)
            audioPort = requireNotNull(setup.headers["transport"]).split(';')
                .single { it.startsWith("server_port=") }.substringAfter('=').toInt()
            assertEquals("200", request("RECORD").path)
        }
        fun progress(positionMillis: Long, durationMillis: Long = 60_000) {
            val text = "progress: 0/${positionMillis * 44_100 / 1000}/${durationMillis * 44_100 / 1000}\r\n"
            assertEquals("200", request("SET_PARAMETER", text.toByteArray(), "Content-Type: text/parameters\r\n").path)
        }
        fun title(value: String) {
            val text = value.toByteArray(Charsets.UTF_8)
            val body = "minm".toByteArray(Charsets.US_ASCII) + ByteBuffer.allocate(4).putInt(text.size).array() + text
            assertEquals("200", request("SET_PARAMETER", body, "Content-Type: application/x-dmap-tagged\r\n").path)
        }
        fun audio(sequence: Int, sample: Int) {
            val bytes = ByteBuffer.allocate(16).put(0x80.toByte()).put(0x60.toByte())
                .putShort(sequence.toShort()).putInt(sample).putInt(1).putInt(0x01020304).array()
            udp.send(DatagramPacket(bytes, bytes.size, InetAddress.getByName("127.0.0.1"), audioPort))
        }
        fun request(method: String, body: ByteArray = ByteArray(0), headers: String = ""): RtspMessage.Request {
            socket.getOutputStream().write(("$method rtsp://receiver/audio RTSP/1.0\r\nCSeq: 1\r\n$headers" +
                "Content-Length: ${body.size}\r\n\r\n").toByteArray() + body)
            socket.getOutputStream().flush()
            return requireNotNull(readReceiverRequest(socket.getInputStream()))
        }
        override fun close() { socket.close(); udp.close() }
    }

    private class Listener : ReceiverServer.Listener {
        @Volatile var actions = emptyList<String>()
        val requested = AtomicInteger()
        val finished = LinkedBlockingQueue<Boolean>()
        val metadata = CopyOnWriteArrayList<ReceiverAudioMetadataUpdate>()
        val samples = LinkedBlockingQueue<Long>()
        val screenLoans = AtomicInteger()
        override fun authorizeDevice(verifiedPublicKey: ByteArray?, deviceName: String) = true
        override fun authorizeConnection(sessionToken: String, deviceName: String) = true
        override fun audioRemoteControls(actions: List<String>) { this.actions = actions.toList() }
        override fun audioRemoteRequested() { requested.incrementAndGet() }
        override fun audioRemoteFinished(accepted: Boolean) { finished.add(accepted) }
        override fun audioMetadata(value: ReceiverAudioMetadataUpdate) { metadata.add(value) }
        override fun audioSample(sample: Long, sampleRate: Int) { samples.add(sample) }
        override fun prepareMirror() { screenLoans.incrementAndGet() }
        override fun mirrorSink(): WebMediaSink = error("audio must not borrow a canvas")
        override fun play(item: ReceiverPlay) = Unit
        override fun stopPlayback() = Unit
        override fun seek(seconds: Double) = Unit
        override fun rate(value: Double) = Unit
        override fun playback() = ReceiverPlayback()
        override fun status(state: String) = Unit
    }

    /** Null response waits for retirement and records the peer's EOF instead of acknowledging. */
    private class DacpPeer(response: (Int) -> String?) : Closeable {
        private val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
        val port = server.localPort
        private val requests = LinkedBlockingQueue<String>()
        val cancelled = CountDownLatch(1)
        @Volatile private var client: Socket? = null
        init {
            Thread({
                var index = 0
                try {
                    while (!server.isClosed) server.accept().use { socket ->
                        client = socket
                        socket.soTimeout = 3000
                        val bytes = ByteArrayOutputStream()
                        var ending = 0
                        while (ending != 0x0d0a0d0a && bytes.size() < 8192) {
                            val value = socket.getInputStream().read()
                            if (value < 0) return@use
                            bytes.write(value); ending = (ending shl 8) or value
                        }
                        requests.add(bytes.toString(Charsets.US_ASCII.name()))
                        val reply = response(index++)
                        if (reply == null) {
                            if (socket.getInputStream().read() < 0) cancelled.countDown()
                        } else socket.getOutputStream().write(reply.toByteArray(Charsets.US_ASCII))
                    }
                } catch (_: Exception) {
                    if (!server.isClosed) cancelled.countDown()
                } finally { client = null }
            }, "dacp-server-test-peer").apply { isDaemon = true; start() }
        }
        fun request(command: String, token: String) {
            val request = requireNotNull(requests.poll(2, TimeUnit.SECONDS)) { "No DACP request received" }
            assertTrue(request, request.startsWith("GET /ctrl-int/1/$command HTTP/1.1\r\n"))
            assertTrue(request, request.contains("\r\nActive-Remote: $token\r\n"))
        }
        override fun close() { server.close(); runCatching { client?.close() } }
    }

    companion object {
        private const val ID = "AABBCCDD"
        private const val TOKEN = "12345678"
        private const val ACK = "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n"
        private fun credentials(token: String = TOKEN) = "DACP-ID: $ID\r\nActive-Remote: $token\r\n"
    }
}
