package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class BrowserRtcProtocolTest {
    @Test fun fragmentsBoundLargeKeyframeAndPreserveExactBytes() {
        val original = ByteArray(200_003) { (it * 31).toByte() }
        val rebuilt = ByteArray(original.size)
        var offset = 0
        while (offset < original.size) {
            val packet = BrowserRtcProtocol.fragment(123, 42, original, offset, 16 * 1024)
            assertTrue(packet.size <= 16 * 1024)
            val header = ByteBuffer.wrap(packet).order(ByteOrder.LITTLE_ENDIAN)
            assertEquals(BrowserRtcProtocol.MAGIC, header.int)
            assertEquals(123, header.int)
            assertEquals(42, header.int)
            assertEquals(original.size, header.int)
            assertEquals(offset, header.int)
            val size = header.int
            assertEquals(packet.size - 24, size)
            header.get(rebuilt, offset, size)
            offset += size
        }
        assertArrayEquals(original, rebuilt)
    }

    @Test fun creditOnlyReturnsForCompleteRecordsAndCannotGrowBeyondWindow() {
        val credit = BrowserRtcCredit(1000)
        assertFalse(credit.reserve(1))
        credit.initialize(100)
        assertTrue(credit.reserve(60, 10))
        assertTrue(credit.reserve(40, 20))
        assertFalse(credit.reserve(1))
        assertThrows(IllegalArgumentException::class.java) { credit.acknowledge(59) }
        assertThrows(IllegalArgumentException::class.java) { credit.acknowledge(101) }
        assertEquals(10L, credit.oldestNanos)
        credit.acknowledge(60)
        assertEquals(20L, credit.oldestNanos)
        assertTrue(credit.reserve(60, 30))
        credit.acknowledge(160)
        assertNull(credit.oldestNanos)
        assertEquals(160L, credit.consumed)
        assertThrows(IllegalArgumentException::class.java) { credit.acknowledge(60) }
        assertThrows(IllegalArgumentException::class.java) { credit.initialize(100) }
    }

    @Test fun negotiatedMessageSizeIncludesHeaderAndHandlesUnlimited() {
        assertEquals(16384, BrowserRtcProtocol.messageLimit("v=0\r\n"))
        assertEquals(16384, BrowserRtcProtocol.messageLimit("a=max-message-size:0\r\n"))
        assertEquals(4096, BrowserRtcProtocol.messageLimit("a=max-message-size:4096\r\n"))
        assertThrows(IllegalArgumentException::class.java) { BrowserRtcProtocol.messageLimit("a=max-message-size:24\r\n") }
        assertThrows(IllegalArgumentException::class.java) { BrowserRtcProtocol.messageLimit("a=max-message-size:4096\r\na=max-message-size:4096\r\n") }
        assertThrows(IllegalArgumentException::class.java) { BrowserRtcProtocol.fragment(1, 1, byteArrayOf(1), 0, 24) }
    }

    @Test fun controlBatchesUseSeparateBoundWithinRemoteSctpMessageLimit() {
        assertEquals(65536, BrowserRtcProtocol.controlLimit("v=0\r\n"))
        assertEquals(65536, BrowserRtcProtocol.controlLimit("a=max-message-size:0\r\n"))
        assertEquals(65536, BrowserRtcProtocol.controlLimit("a=max-message-size:262144\r\n"))
        assertEquals(32768, BrowserRtcProtocol.controlLimit("a=max-message-size:32768\r\n"))
        assertEquals(16384, BrowserRtcProtocol.messageLimit("a=max-message-size:32768\r\n"))
        assertThrows(IllegalArgumentException::class.java) { BrowserRtcProtocol.controlLimit("a=max-message-size:24\r\n") }
        assertThrows(IllegalArgumentException::class.java) {
            BrowserRtcProtocol.controlLimit("a=max-message-size:9999999999999999999999999\r\n")
        }
    }
}
