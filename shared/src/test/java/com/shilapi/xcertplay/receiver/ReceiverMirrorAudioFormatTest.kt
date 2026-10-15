package com.shilapi.xcertplay.receiver

import org.junit.Assert.*
import org.junit.Test

class ReceiverMirrorAudioFormatTest {
    @Test fun everyDeclaredBitSelectsAnImplementedFormatAndExplicitMismatchesAreRejected() {
        assertEquals(24, ReceiverMirrorAudioFormat.supported.size)
        for (bit in 2..25) {
            val expected = ReceiverMirrorAudioFormat.supported[bit - 2]
            assertEquals(expected, ReceiverMirrorAudioFormat.parse(mapOf("audioFormat" to (1L shl bit))))
            assertNull(ReceiverMirrorAudioFormat.parse(mapOf("audioFormat" to (1L shl bit), "sr" to 12345)))
        }
        assertNull(ReceiverMirrorAudioFormat.parse(mapOf("audioFormat" to 0x3fffffcL)))
        assertNull(ReceiverMirrorAudioFormat.parse(mapOf("audioFormat" to (1L shl 26))))
        assertNull(ReceiverMirrorAudioFormat.parse(mapOf("audioFormat" to 16777216.5, "ct" to 8)))
        assertNull(ReceiverMirrorAudioFormat.parse(mapOf("audioFormat" to "16777216", "ct" to 8)))
        assertNull(ReceiverMirrorAudioFormat.parse(mapOf("ct" to 8, "spf" to 1024)))
    }

    @Test fun aacSpecificConfigsEncodeNegotiatedRateProfileAndFrameLength() {
        assertArrayEquals(byteArrayOf(0xf8.toByte(), 0xe8.toByte(), 0x50, 0), ReceiverMirrorAudioFormat(8, 44100, 2, 480).codecConfig())
        assertArrayEquals(byteArrayOf(0xf8.toByte(), 0xe8.toByte(), 0x40, 0), ReceiverMirrorAudioFormat(8, 44100, 2, 512).codecConfig())
        assertArrayEquals(byteArrayOf(0xf8.toByte(), 0xe6.toByte(), 0x50, 0), ReceiverMirrorAudioFormat(8, 48000, 2, 480).codecConfig())
        assertArrayEquals(byteArrayOf(0x12, 0x10), ReceiverMirrorAudioFormat(4, 44100, 2, 1024).codecConfig())
        assertArrayEquals(byteArrayOf(0x11, 0x94.toByte()), ReceiverMirrorAudioFormat(4, 48000, 2, 960).codecConfig())
    }

    @Test fun alacCookieRetainsBitDepthAndSamplesPerFrame() {
        val config = java.nio.ByteBuffer.wrap(ReceiverMirrorAudioFormat(2, 48000, 2, 352, 24).codecConfig())
        assertEquals(352, config.int); assertEquals(0, config.get().toInt()); assertEquals(24, config.get().toInt())
        assertEquals(48000, config.getInt(20))
    }

}
