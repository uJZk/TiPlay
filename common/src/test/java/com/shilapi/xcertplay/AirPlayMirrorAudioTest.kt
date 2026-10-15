package com.shilapi.xcertplay

import com.shilapi.xcertplay.receiver.ReceiverMirrorAudioFormat
import com.shilapi.xcertplay.web.WebAudioHub
import java.nio.ByteBuffer
import org.junit.Assert.*
import org.junit.Test

class AirPlayMirrorAudioTest {
    @Test fun everyDeclaredFormatForwardsUntouchedAccessUnitsInsteadOfDecodingOnAndroid() {
        for (format in ReceiverMirrorAudioFormat.supported) {
            val hub = WebAudioHub()
            AirPlayMirrorAudio(format, hub).use { transport ->
                val reader = hub.subscribe()
                val config = requireNotNull(reader.take(10))
                val json = String(config.copyOfRange(28, config.size), Charsets.UTF_8)
                assertTrue(json.contains("\"sampleRate\":${format.sampleRate}"))
                assertTrue(json.contains("\"bitDepth\":${format.bitDepth}"))
                assertTrue(json.contains("\"littleEndian\":false"))
                if (format.codec == 2) assertTrue(json.contains("\"cookie\":[0,0,0,36,97,108,97,99"))
                // RFC 3551 network sample order: +0x1234/-32768, or +0x123456/-8388608.
                val raw = if (format.codec == 1 && format.bitDepth == 16)
                    byteArrayOf(0x12, 0x34, 0x80.toByte(), 0)
                else byteArrayOf(0x12, 0x34, 0x56, 0x80.toByte(), 0, 0)
                transport.offer(raw, format.sampleRate.toLong(), 2_000_000_000L)
                val packet = requireNotNull(reader.take(10))
                assertEquals(7, packet[4].toInt())
                assertEquals(1_000_000.0, ByteBuffer.wrap(packet).getDouble(28), 0.0)
                assertEquals(2000.0, ByteBuffer.wrap(packet).getDouble(20), 0.0)
                assertArrayEquals(raw, packet.copyOfRange(36, packet.size))
            }
        }
    }

    @Test fun flushAndCloseRetireEncodedQueueWithoutPublishingDecodedPcm() {
        val hub = WebAudioHub()
        val transport = AirPlayMirrorAudio(ReceiverMirrorAudioFormat(8, 48000, 2, 512), hub)
        val reader = hub.subscribe()
        val initial = requireNotNull(reader.take(10))
        transport.offer(byteArrayOf(1), 0, null)
        transport.flush()
        val config = requireNotNull(reader.take(10))
        assertEquals(6, config[4].toInt())
        assertTrue(ByteBuffer.wrap(initial).getInt(16) != ByteBuffer.wrap(config).getInt(16))
        assertNull(reader.take(1))
        transport.close()
        val ended = buildList { while (true) add(reader.take(1) ?: break) }.last()
        assertTrue(String(ended.copyOfRange(28, ended.size)).contains("\"ended\":true"))
        transport.offer(byteArrayOf(2), 512, null)
        assertNull(reader.take(1))
    }
}
