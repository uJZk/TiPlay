package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import java.net.InetAddress
import java.net.Socket
import org.junit.Assert.*
import org.junit.Test

class ReceiverDiscoveryInfoServerTest {
    @Test fun bluetoothProbeSharesTheStartedReceiversCurrentProfile() {
        val receiver = receiver("Synthetic receiver")
        try {
            assertEquals(503, probe().status)
            receiver.start()
            assertSameProfile(receiver)
            receiver.updateDisplaySize(1280, 720, hevc = true, mirrorEnabled = false)
            receiver.updateDisplay(30, hevc = true)
            receiver.updateAudioFormats(0L)
            assertSameProfile(receiver)
            val info = BplistCodec.decode(probe().body) as Map<*, *>
            val display = (info["displays"] as List<*>).single() as Map<*, *>
            assertEquals(1280, (display["width"] as Number).toInt())
            assertEquals(720, (display["height"] as Number).toInt())
            assertEquals(30, (display["maxFPS"] as Number).toInt())
            assertTrue(info["txtAirPlay"] is ByteArray)
            assertTrue(info["txtRAOP"] is ByteArray)
            assertFalse(info.containsKey("serviceport"))
        } finally { receiver.close() }
        assertEquals(503, probe().status)
    }

    @Test fun closingAnOlderReceiverCannotClearItsLiveReplacement() {
        val first = receiver("Synthetic first")
        val second = receiver("Synthetic second")
        try {
            first.start()
            second.start()
            first.close()
            assertEquals("Synthetic second", (BplistCodec.decode(probe().body) as Map<*, *>)["name"])
            assertSameProfile(second)
        } finally { first.close(); second.close() }
        assertEquals(503, probe().status)
    }

    @Test fun anUnstartedOrClosedReceiverCannotPublishOverTheActiveOne() {
        val active = receiver("Synthetic active")
        val unused = receiver("Synthetic unused")
        try {
            active.start()
            assertSameProfile(active)
            unused.close()
            assertThrows(IllegalStateException::class.java) { unused.start() }
            assertSameProfile(active)
        } finally { unused.close(); active.close() }
        assertEquals(503, probe().status)
    }

    private fun assertSameProfile(receiver: ReceiverServer) {
        val discovery = probe()
        assertEquals(200, discovery.status ?: 200)
        Socket(InetAddress.getByName("127.0.0.1"), receiver.port).use { socket ->
            socket.soTimeout = 3000
            socket.getOutputStream().apply {
                write("GET /info?txtAirPlay&txtRAOP RTSP/1.0\r\nX-Apple-QR: BT\r\nContent-Length: 0\r\n\r\n".toByteArray())
                flush()
            }
            val ordinary = requireNotNull(readReceiverRequest(socket.getInputStream()))
            assertEquals("200", ordinary.path)
            assertArrayEquals(ordinary.body, discovery.body)
        }
    }

    private fun probe() = requireNotNull(ReceiverDiscoveryInfo.response(RtspMessage.Request(
        "GET", "/info?txtAirPlay&txtRAOP", "RTSP/1.0", mapOf("x-apple-qr" to "BT"), ByteArray(0))))

    private fun receiver(name: String) = ReceiverServer(ReceiverConfig(name, "02:11:22:33:44:55",
        AirPlayIdentity.generate(), audioOutputFormats = ReceiverAudioCapabilities.OUTPUT_FORMATS),
        object : ReceiverServer.Listener {
            override fun mirrorSink() = error("Discovery does not create media")
            override fun play(item: ReceiverPlay) = error("Discovery does not start playback")
            override fun stopPlayback() {}
            override fun seek(seconds: Double) {}
            override fun rate(value: Double) {}
            override fun playback() = ReceiverPlayback()
            override fun status(state: String) {}
            override fun log(message: String) {}
        })
}
