package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.VideoCodec
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer

class ReceiverMirrorCodecTest {
    private fun hevc() = ReceiverSdrFixtures.hvcc()

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

    @Test fun sdrConfigurationAcceptsEightBitAvcAndHevcAndRejectsPqHlgOrHigherBitDepth() {
        for (profile in listOf(66, 77, 100)) assertEquals(VideoCodec.H264,
            ReceiverMirrorCodec.config(ReceiverSdrFixtures.avcc(profile = profile), false).codec)
        assertEquals(VideoCodec.H265, ReceiverMirrorCodec.config(ReceiverSdrFixtures.hvcc(), true).codec)
        for (transfer in listOf(16, 18)) {
            assertThrows(IllegalArgumentException::class.java) {
                ReceiverMirrorCodec.config(ReceiverSdrFixtures.avcc(transfer), false)
            }
            assertThrows(IllegalArgumentException::class.java) {
                ReceiverMirrorCodec.config(ReceiverSdrFixtures.hvcc(transfer), true)
            }
        }
        assertThrows(IllegalArgumentException::class.java) {
            ReceiverMirrorCodec.config(ReceiverSdrFixtures.avcc(profile = 110, depth = 10), false)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ReceiverMirrorCodec.config(ReceiverSdrFixtures.hvcc(profile = 2, depth = 10), true)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ReceiverMirrorCodec.config(ReceiverSdrFixtures.hvcc(depth = 10), true)
        }
        val invalid = ReceiverSdrFixtures.avcc().copyOf().apply { this[8] = 0x7f }
        assertThrows(IllegalArgumentException::class.java) { ReceiverMirrorCodec.config(invalid, false) }
    }

    @Test fun hdrCannotEnterThroughInBandParameterSetsOrSupplementalMetadata() {
        val prefix = byteArrayOf(0, 0, 0, 1)
        ReceiverMirrorCodec.requireSdrFrame(prefix + byteArrayOf(0x65, 1, 2), VideoCodec.H264)
        ReceiverMirrorCodec.requireSdrFrame(prefix + byteArrayOf(0x26, 1, 2), VideoCodec.H265)
        for (transfer in listOf(16, 18)) {
            assertThrows(IllegalArgumentException::class.java) {
                ReceiverMirrorCodec.requireSdrFrame(prefix + ReceiverSdrFixtures.avcSps(transfer), VideoCodec.H264)
            }
            assertThrows(IllegalArgumentException::class.java) {
                ReceiverMirrorCodec.requireSdrFrame(prefix + ReceiverSdrFixtures.hevcSps(transfer), VideoCodec.H265)
            }
        }
        for (type in listOf(137, 144)) {
            val sei = byteArrayOf(type.toByte(), 1, 1, 0x80.toByte())
            assertThrows(IllegalArgumentException::class.java) {
                ReceiverMirrorCodec.requireSdrFrame(prefix + byteArrayOf(6) + sei, VideoCodec.H264)
            }
            assertThrows(IllegalArgumentException::class.java) {
                ReceiverMirrorCodec.requireSdrFrame(prefix + byteArrayOf(0x4e, 1) + sei, VideoCodec.H265)
            }
        }
        assertThrows(IllegalArgumentException::class.java) {
            ReceiverMirrorCodec.requireSdrFrame(prefix + byteArrayOf(0x7c, 1, 0x19), VideoCodec.H265)
        }
        for (metadata in listOf(byteArrayOf(0xb5.toByte(), 0, 0x3b, 0, 0, 8, 0),
                byteArrayOf(0xb5.toByte(), 0, 0x3c, 0, 1, 4))) assertThrows(IllegalArgumentException::class.java) {
            ReceiverMirrorCodec.requireSdrFrame(prefix + byteArrayOf(0x4e, 1, 4, metadata.size.toByte()) +
                metadata + byteArrayOf(0x80.toByte()), VideoCodec.H265)
        }
        // Registered caption user data is not Dolby/HDR metadata.
        ReceiverMirrorCodec.requireSdrFrame(prefix + byteArrayOf(6, 4, 3, 0xb5.toByte(), 0, 0x31, 0x80.toByte()), VideoCodec.H264)
    }

    @Test fun dolbyVisionSampleEntryExtensionIsRejectedInsteadOfDiscarded() {
        val record = hevc()
        val entry = ByteArray(94) + record + ByteBuffer.allocate(12).putInt(12).put("dvcC".toByteArray()).putInt(0).array()
        ByteBuffer.wrap(entry).putInt(entry.size)
        "hvc1".toByteArray().copyInto(entry, 4)
        ByteBuffer.wrap(entry, 86, 4).putInt(record.size + 8)
        "hvcC".toByteArray().copyInto(entry, 90)
        assertThrows(IllegalArgumentException::class.java) { ReceiverMirrorCodec.config(entry, true) }
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
