package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteOrder

class BrowserRtcProtocolTest {
    @Test fun progressingAcknowledgementsDoNotTreatOldRecordAgeAsAStall() {
        val credit = BrowserRtcCredit(100)
        credit.sent(0, 50, 0)
        credit.sent(1, 50, 1_000_000)
        assertTrue(credit.acknowledge(0, 50, 5_000_000_000))
        assertEquals(6_999L, credit.oldestAgeMillis(7_000_000_000))
        assertEquals(2_000L, credit.noProgressMillis(7_000_000_000))
        assertEquals(6_001L, credit.noProgressMillis(11_001_000_000))
        assertTrue(credit.acknowledge(1, 50, 11_002_000_000))
        assertEquals(0L, credit.noProgressMillis(99_000_000_000))
        assertEquals(100L, credit.consumedBytes)
    }
    @Test fun unsignedSequenceWrapRetainsTheWireBitsAndRejectsInvalidNumbers() {
        assertEquals(Int.MAX_VALUE, BrowserRtcProtocol.unsignedInt(0x7fff_ffffL))
        assertEquals(Int.MIN_VALUE, BrowserRtcProtocol.unsignedInt(0x8000_0000L))
        assertEquals(-1, BrowserRtcProtocol.unsignedInt(0xffff_ffffL))
        assertEquals(0, BrowserRtcProtocol.unsignedInt(0L))
        assertNull(BrowserRtcProtocol.unsignedInt(-1))
        assertNull(BrowserRtcProtocol.unsignedInt(0x1_0000_0000L))
        assertNull(BrowserRtcProtocol.unsignedInt(0.5))
        assertNull(BrowserRtcProtocol.unsignedInt(Double.NaN))
    }

    @Test fun scatterFragmentsNeverNeedASecondFullAccessUnitCopy() {
        val record = WebVideoRecord(2, 5, 1, 123, 2, 99_111L,
            ByteArray(32_000) { it.toByte() }, prefix = byteArrayOf(1, 2, 3, 4))
        val source = BrowserRtcRecord.video(record)
        val expected = WebVideoRecords.encode(record)
        val restored = ByteArray(source.size)
        var offset = 0
        while (offset < source.size) {
            val packet = BrowserRtcProtocol.fragment(1, 1, source, offset)
            packet.position(BrowserRtcProtocol.HEADER)
            val count = packet.remaining()
            packet.get(restored, offset, count)
            offset += count
        }
        assertArrayEquals(expected, restored)
    }

    @Test fun largeRecordFragmentsPreserveBytesAndIncludeAllBounds() {
        val bytes = ByteArray(70_000) { (it * 17).toByte() }
        val restored = ByteArray(bytes.size)
        var offset = 0
        var count = 0
        while (offset < bytes.size) {
            val packet = BrowserRtcProtocol.fragment(71, 26, bytes, offset).order(ByteOrder.LITTLE_ENDIAN)
            assertTrue(packet.remaining() <= 16 * 1024)
            assertEquals(BrowserRtcProtocol.MAGIC, packet.int)
            assertEquals(71, packet.int)
            assertEquals(26, packet.int)
            assertEquals(bytes.size, packet.int)
            assertEquals(offset, packet.int)
            val size = packet.int
            assertEquals(size, packet.remaining())
            packet.get(restored, offset, size)
            offset += size; count++
        }
        assertTrue(count > 1)
        assertArrayEquals(bytes, restored)
    }

    @Test fun creditRequiresExactFifoConsumptionAndNeverOverflows() {
        val credit = BrowserRtcCredit(100)
        credit.sent(0, 60, 1_000_000)
        credit.sent(1, 40, 2_000_000)
        assertFalse(credit.canSend(1))
        assertFalse(credit.acknowledge(1, 40))
        assertFalse(credit.acknowledge(0, 59))
        assertEquals(100, credit.bytes)
        assertEquals(4L, credit.oldestAgeMillis(5_000_000))
        assertTrue(credit.acknowledge(0, 60))
        assertFalse(credit.acknowledge(0, 60))
        assertEquals(40, credit.bytes)
        assertTrue(credit.canSend(60))
        assertFalse(credit.canSend(61))
        assertTrue(credit.acknowledge(1, 40))
        assertEquals(0, credit.bytes)
        assertFalse(credit.canSend(0))
        assertFalse(credit.canSend(Int.MAX_VALUE))
    }
}
