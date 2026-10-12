package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.VideoCodec
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer

class ReceiverMirrorCodecTest {
    private fun hevc() = byteArrayOf(
        1, 1, 0x60, 0, 0, 0, 0xb0.toByte(), 0, 0, 0, 0, 0, 120,
        0xf0.toByte(), 0, 0xfc.toByte(), 0xfd.toByte(), 0xf8.toByte(), 0xf8.toByte(), 0, 0, 0x0f, 3,
        0xa0.toByte(), 0, 1, 0, 2, 0x40, 1,
        0xa1.toByte(), 0, 1, 0, 2, 0x42, 1,
        0xa2.toByte(), 0, 1, 0, 2, 0x44, 1,
    )

    @Test fun hevcSampleEntryAndRawConfigurationProduceTheSameBrowserRecord() {
        val record = hevc()
        val entry = ByteArray(94) + record
        ByteBuffer.wrap(entry).putInt(entry.size)
        "hvc1".toByteArray().copyInto(entry, 4)
        ByteBuffer.wrap(entry, 86, 4).putInt(record.size + 8)
        "hvcC".toByteArray().copyInto(entry, 90)
        val parsed = ReceiverMirrorCodec.config(entry, true)
        assertEquals(VideoCodec.H265, parsed.codec)
        assertEquals(4, parsed.lengthBytes)
        assertArrayEquals(record, parsed.record)
        assertArrayEquals(record, ReceiverMirrorCodec.config(record, true).record)
        assertThrows(IllegalArgumentException::class.java) { ReceiverMirrorCodec.config(entry, false) }
        assertThrows(IllegalArgumentException::class.java) { ReceiverMirrorCodec.config(entry.copyOf(116), true) }
        assertThrows(IllegalArgumentException::class.java) {
            ReceiverMirrorCodec.config(entry.copyOf().apply { this[89] = 0 }, true)
        }
    }

    @Test fun shortNalLengthsBecomeAnnexBAndTruncatedUnitsAreRejected() {
        assertArrayEquals(byteArrayOf(0, 0, 0, 1, 0x40, 1, 0, 0, 0, 1, 0x42, 1),
            ReceiverMirrorCodec.annexB(byteArrayOf(2, 0x40, 1, 2, 0x42, 1), 1))
        assertThrows(IllegalArgumentException::class.java) { ReceiverMirrorCodec.annexB(byteArrayOf(3, 0x40, 1), 1) }
        val nal = ByteArray(300) { 0x41 }
        val prefixed = ByteBuffer.allocate(304).putInt(nal.size).put(nal).array()
        assertArrayEquals(byteArrayOf(0, 0, 0, 1) + nal, ReceiverMirrorCodec.annexB(prefixed, 4))
        assertTrue(ReceiverMirrorCodec.suspended(0x5e, false))
        assertFalse(ReceiverMirrorCodec.suspended(0x1e, true))
    }
}
