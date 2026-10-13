package com.shilapi.xcertplay.media

import com.shilapi.xcertplay.airplay.*
import com.shilapi.xcertplay.web.WebAudioHub
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.nio.ByteBuffer
import java.nio.ByteOrder

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class BrowserAudioMediaSinkTest {
    @Test fun aNewPausedCarPlaySinkDoesNotTakeAudioFromAirPlay() {
        val hub = WebAudioHub()
        val airPlay = Any()
        hub.begin(airPlay)
        val subscription = hub.subscribe()
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub, initiallyPaused = true)
        try {
            hub.publish(airPlay, 0, 48000, 2, byteArrayOf(1, 0, 2, 0))
            assertNotNull(subscription.take(1000))
            sink.close()
            hub.publish(airPlay, 0, 48000, 2, byteArrayOf(3, 0, 4, 0))
            assertNotNull(subscription.take(1000))
        } finally { sink.close(); subscription.close() }
    }

    @Test fun pcmIsConvertedForTheBrowserAndStopClearsPlayback() {
        val hub = WebAudioHub()
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub)
        val subscription = hub.subscribe()
        try {
            val id = AudioStreamId(100, "telephony")
            val format = AudioFormat(AudioCodecKind.LPCM, 16000, 1, 100, "telephony")
            sink.onAudioStarted(id, format, 0)
            sink.onAudioClock(id, 0, 1_000_000_000L)
            sink.onAudioRtp(id, format, ByteArray(12) + byteArrayOf(0x12, 0x34, 0x56, 0x78), 0)
            val packet = subscription.take(1000)!!
            assertEquals(2, packet[5].toInt())
            assertEquals(2, packet[7].toInt() and 2)
            assertEquals(2, packet[4].toInt())
            assertEquals(1000.0, ByteBuffer.wrap(packet).order(ByteOrder.BIG_ENDIAN).getDouble(20), 0.0)
            assertArrayEquals(byteArrayOf(0x34, 0x12, 0x78, 0x56), packet.copyOfRange(28, packet.size))
            sink.onAudioStopped(id)
            val stopped = subscription.take(1000)!!
            assertEquals(28, stopped.size)
            assertEquals(2, stopped[7].toInt() and 2)
            sink.onAudioRtp(id, format, ByteArray(14), 0)
            assertNull(subscription.take(30))
        } finally { sink.close(); subscription.close() }
    }

    @Test fun browserMicrophoneUploadsAreSealedForTheNegotiatedPeerAndEndOnTeardown() {
        val hub = WebAudioHub()
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub)
        DatagramSocket(0, InetAddress.getLoopbackAddress()).use { receiver ->
            receiver.soTimeout = 1000
            val key = ByteArray(32) { it.toByte() }
            val id = AudioStreamId(100, "telephony")
            val config = MicrophoneConfig("telephony", 16000, 1, 97, 20,
                InetAddress.getLoopbackAddress(), receiver.localPort, key)
            try {
                sink.onMicrophoneStarted(id, config)
                assertEquals(true, hub.microphoneStatus()["active"])
                val pcm = ByteArray(config.frameBytes) { it.toByte() }
                assertTrue(hub.acceptMicrophone(pcm))
                val datagram = DatagramPacket(ByteArray(2048), 2048)
                receiver.receive(datagram)
                val wire = datagram.data.copyOf(datagram.length)
                val tail = wire.size - 8
                val nonce = ByteArray(12).also { wire.copyInto(it, 4, tail, wire.size) }
                val payload = AirPlayCrypto.chachaOpen(key, nonce, wire.copyOfRange(12, tail), wire.copyOfRange(4, 12))
                assertArrayEquals(MicrophonePacketizer.toWirePcm(pcm), payload)
                sink.onMicrophoneStopped(id)
                assertEquals(false, hub.microphoneStatus()["active"])
                assertFalse(hub.acceptMicrophone(pcm))
            } finally { sink.close() }
        }
    }
}
