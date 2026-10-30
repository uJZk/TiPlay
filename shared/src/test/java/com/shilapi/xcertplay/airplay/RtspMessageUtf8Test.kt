package com.shilapi.xcertplay.airplay

import org.junit.Assert.*
import org.junit.Test

class RtspMessageUtf8Test {
    @Test fun utf8HeaderValuesPreserveFramingAcrossSplitMessages() {
        val firstHeader = "POST /play HTTP/1.1\r\nX-Apple-Client-Name: Alex’s Phone\r\nCSeq: 7\r\nContent-Length: 3\r\n\r\n".toByteArray(Charsets.UTF_8)
        val firstBody = byteArrayOf(0, 0x80.toByte(), 0xff.toByte())
        val next = "GET /info RTSP/1.0\r\nContent-Length: 0\r\n\r\n".toByteArray(Charsets.US_ASCII)
        val all = firstHeader + firstBody + next
        val split = firstHeader.indexOf(0xe2.toByte()) + 1
        val partial = RtspMessage.parseMessages(all.copyOfRange(0, split))
        assertTrue(partial.messages.isEmpty())
        val parsed = RtspMessage.parseMessages(partial.rest + all.copyOfRange(split, all.size))
        assertEquals(2, parsed.messages.size)
        assertEquals("POST", parsed.messages[0].method)
        assertEquals("/play", parsed.messages[0].path)
        assertEquals("Alex’s Phone", parsed.messages[0].headers["x-apple-client-name"])
        assertEquals("7", parsed.messages[0].headers["cseq"])
        assertArrayEquals(firstBody, parsed.messages[0].body)
        assertEquals("GET", parsed.messages[1].method)
        assertTrue(parsed.rest.isEmpty())
    }

    @Test fun malformedUtf8UsesReplacementWithoutAffectingAsciiHeaders() {
        val prefix = "GET /info RTSP/1.0\r\nX-Apple-Client-Name: A".toByteArray(Charsets.US_ASCII)
        val suffix = "B\r\nCSeq: 4\r\nContent-Length: 0\r\n\r\n".toByteArray(Charsets.US_ASCII)
        val parsed = RtspMessage.parseMessages(prefix + byteArrayOf(0xff.toByte()) + suffix).messages.single()
        assertEquals("A\uFFFDB", parsed.headers["x-apple-client-name"])
        assertEquals("4", parsed.headers["cseq"])
        assertEquals("RTSP/1.0", parsed.protocol)
    }
}
