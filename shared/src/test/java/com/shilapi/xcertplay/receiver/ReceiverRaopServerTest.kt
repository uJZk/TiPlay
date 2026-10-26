package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.web.WebMediaSink
import org.junit.Assert.*
import org.junit.Test
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class ReceiverRaopServerTest {
    private val sdp = "v=0\r\nm=audio 0 RTP/AVP 96\r\na=rtpmap:96 L16/44100/2\r\n".toByteArray()

    @Test fun pureAudioPublishesOwnerMetadataAndLocallyPausesWithoutBorrowingCarPlay() {
        val listener = Listener()
        val format = ReceiverMirrorAudioFormat(1, 44100, 2)
        val bit = ReceiverMirrorAudioFormat.supported.indexOf(format) + 2
        assertTrue(bit >= 2)
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(),
            audioOutputFormats = 1L shl bit), listener)
        receiver.start()
        try {
            Socket(InetAddress.getLoopbackAddress(), receiver.port).use { control ->
                control.soTimeout = 5000
                assertEquals("200", control.request("ANNOUNCE", sdp, "Content-Type: application/sdp\r\n").path)
                DatagramSocket().use { sender ->
                    val setup = control.request("SETUP", headers = "Transport: RTP/AVP/UDP;unicast;mode=record;" +
                        "control_port=${sender.localPort};timing_port=${sender.localPort}\r\n")
                    assertEquals("200", setup.path)
                    assertNotNull(setup.headers["session"])
                    val transport = requireNotNull(setup.headers["transport"]).split(';').drop(1)
                        .filter { '=' in it }.associate { it.substringBefore('=') to it.substringAfter('=') }
                    val port = requireNotNull(transport["server_port"]).toInt()
                    assertTrue(port in 1..65535)
                    assertEquals(0, listener.prepared.get())
                    assertEquals("audio", listener.states.last())

                    val first = byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8)
                    fun send(sequence: Int, sample: Int, payload: ByteArray = first) {
                        val bytes = ByteBuffer.allocate(12 + payload.size).put(0x80.toByte()).put(0x60)
                            .putShort(sequence.toShort()).putInt(sample).putInt(1).put(payload).array()
                        sender.send(DatagramPacket(bytes, bytes.size, InetAddress.getLoopbackAddress(), port))
                    }
                    send(0, 0)
                    assertNull("RAOP must not render before RECORD", listener.packets.poll(100, TimeUnit.MILLISECONDS))
                    assertEquals("200", control.request("RECORD").path)
                    send(1, 352)
                    assertArrayEquals(first, listener.packets.poll(2, TimeUnit.SECONDS))
                    assertEquals(352L to 44100, listener.samples.poll(2, TimeUnit.SECONDS))

                    val track = field("mlit", field("minm", "Real sender title".toByteArray()) +
                        field("asar", "Real sender artist".toByteArray()) + field("asal", "Real album".toByteArray()))
                    assertEquals("200", control.request("SET_PARAMETER", track,
                        "Content-Type: application/x-dmap-tagged\r\n").path)
                    val metadata = requireNotNull(listener.metadata.poll(2, TimeUnit.SECONDS))
                    assertEquals("Real sender title", metadata.title)
                    assertEquals("Real sender artist", metadata.artist)
                    assertEquals("Real album", metadata.album)
                    val cover = byteArrayOf(0xff.toByte(), 0xd8.toByte(), 1, 2, 0xff.toByte(), 0xd9.toByte())
                    assertEquals("200", control.request("SET_PARAMETER", cover, "Content-Type: image/jpeg\r\n").path)
                    val artwork = requireNotNull(listener.metadata.poll(2, TimeUnit.SECONDS)?.artwork)
                    assertArrayEquals(cover, artwork.bytes)
                    assertEquals("image/jpeg", artwork.contentType)
                    assertEquals("200", control.request("SET_PARAMETER", "progress: 0/352/441000\r\n".toByteArray(),
                        "Content-Type: text/parameters\r\n").path)
                    assertEquals(ReceiverAudioProgress(0, 352, 441000), listener.metadata.poll(2, TimeUnit.SECONDS)?.progress)

                    receiver.updateDisplay(30, false)
                    val next = byteArrayOf(8, 7, 6, 5, 4, 3, 2, 1)
                    send(2, 704, next)
                    assertArrayEquals("display negotiation must preserve the independent soundtrack", next,
                        listener.packets.poll(2, TimeUnit.SECONDS))
                    assertEquals(704L to 44100, listener.samples.poll(2, TimeUnit.SECONDS))
                    assertEquals("200", control.request("OPTIONS").path)
                    assertEquals(0, listener.prepared.get())

                    Socket(InetAddress.getLoopbackAddress(), receiver.port).use { competitor ->
                        competitor.soTimeout = 5000
                        assertEquals("453", competitor.request("ANNOUNCE", sdp).path)
                        assertEquals("403", competitor.request("SET_PARAMETER", track,
                            "Content-Type: application/x-dmap-tagged\r\n").path)
                        assertNull(listener.metadata.poll(100, TimeUnit.MILLISECONDS))
                        assertEquals(0, listener.flushes.get())
                    }

                    assertTrue(receiver.pauseAudio(true))
                    assertEquals("Pause flushes the ordinary AirPlay producer", 1, listener.flushes.get())
                    assertTrue(receiver.pauseAudio(true))
                    assertEquals("A repeated pause does not reset the producer again", 1, listener.flushes.get())
                    send(3, 1056)
                    assertNull(listener.packets.poll(100, TimeUnit.MILLISECONDS))
                    assertNull(listener.samples.poll(100, TimeUnit.MILLISECONDS))
                    assertEquals("200", control.request("OPTIONS").path)
                    assertTrue(receiver.pauseAudio(false))
                    assertEquals(2, listener.flushes.get())
                    send(4, 1408, next)
                    assertArrayEquals("Paused UDP is still ordered, allowing immediate live resume", next,
                        listener.packets.poll(2, TimeUnit.SECONDS))
                    assertEquals(1408L to 44100, listener.samples.poll(2, TimeUnit.SECONDS))
                    assertEquals("200", control.request("FLUSH", headers = "RTP-Info: seq=4;rtptime=1408\r\n").path)
                    assertEquals(3, listener.flushes.get())
                    send(4, 1408)
                    assertNull(listener.packets.poll(100, TimeUnit.MILLISECONDS))
                    send(5, 1760)
                    assertArrayEquals(first, listener.packets.poll(2, TimeUnit.SECONDS))
                    assertEquals("200", control.request("TEARDOWN").path)
                    assertEquals("listening", listener.states.last())
                    assertTrue(listener.audioStops.get() > 0)
                    assertEquals(0, listener.prepared.get())
                    assertFalse(receiver.pauseAudio(true))
                    assertEquals(3, listener.flushes.get())
                }
            }
        } finally { receiver.close() }
    }

    private class Listener : ReceiverServer.Listener {
        val packets = LinkedBlockingQueue<ByteArray>()
        val metadata = LinkedBlockingQueue<ReceiverAudioMetadataUpdate>()
        val samples = LinkedBlockingQueue<Pair<Long, Int>>()
        val states = CopyOnWriteArrayList<String>()
        val prepared = AtomicInteger()
        val flushes = AtomicInteger()
        val audioStops = AtomicInteger()
        override fun authorizeConnection(sessionToken: String, deviceName: String) = true
        override fun prepareMirror() { prepared.incrementAndGet() }
        override fun mirrorSink(): WebMediaSink = error("audio has no display resource")
        override fun mirrorAudioTimed(format: ReceiverMirrorAudioFormat, payload: ByteArray, sample: Long, presentationNanos: Long?) {
            packets.add(payload.copyOf())
        }
        override fun audioMetadata(value: ReceiverAudioMetadataUpdate) { metadata.add(value) }
        override fun audioSample(sample: Long, sampleRate: Int) { samples.add(sample to sampleRate) }
        override fun flushMirrorAudio() { flushes.incrementAndGet() }
        override fun stopMirrorAudio() { audioStops.incrementAndGet() }
        override fun play(item: ReceiverPlay) = Unit
        override fun stopPlayback() = Unit
        override fun seek(seconds: Double) = Unit
        override fun rate(value: Double) = Unit
        override fun playback() = ReceiverPlayback()
        override fun status(state: String) { states.add(state) }
    }

    private fun Socket.request(method: String, body: ByteArray = ByteArray(0), headers: String = ""): RtspMessage.Request {
        getOutputStream().write(("$method rtsp://receiver/audio RTSP/1.0\r\nCSeq: 1\r\n$headers" +
            "Content-Length: ${body.size}\r\n\r\n").toByteArray() + body)
        getOutputStream().flush()
        return requireNotNull(readReceiverRequest(getInputStream()))
    }

    private fun field(tag: String, bytes: ByteArray) = tag.toByteArray(Charsets.US_ASCII) +
        ByteBuffer.allocate(4).putInt(bytes.size).array() + bytes
}
