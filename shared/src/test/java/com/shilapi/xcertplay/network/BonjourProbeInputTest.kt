package com.shilapi.xcertplay.network

import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.net.SocketTimeoutException
import org.junit.Assert.*
import org.junit.Test

class BonjourProbeInputTest {
    @Test fun acceptsOneBoundedStatusAndRejectsOversizedOrIncompleteLines() {
        assertEquals("HTTP/1.1 200 OK", readBonjourStatusLine(ByteArrayInputStream("HTTP/1.1 200 OK\r\nheader: x\r\n".toByteArray()), 3_000, {}))
        assertThrows(IOException::class.java) { readBonjourStatusLine(ByteArrayInputStream(ByteArray(1025) { 65 }), 3_000, {}) }
        assertThrows(IOException::class.java) { readBonjourStatusLine(ByteArrayInputStream("HTTP/1.1".toByteArray()), 3_000, {}) }
    }
    @Test fun slowDripBytesCannotRenewTheWholeOperationDeadline() {
        var now = 0L
        val timeouts = mutableListOf<Int>()
        val source = object : InputStream() {
            override fun read(): Int = error("Must use bounded block reads")
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                now += 1_000_000_000L; buffer[offset] = 65; return 1
            }
        }
        assertThrows(SocketTimeoutException::class.java) {
            readBonjourStatusLine(source, 3_000, timeouts::add, nanoTime = { now })
        }
        assertEquals(listOf(3_000, 2_000, 1_000), timeouts)
    }
    @Test fun namesExpireAndNeverGrowBeyondTheirBudget() {
        var now = 0L
        val names = BonjourServiceNames(2, 10, { now })
        assertTrue(names.add("a")); assertFalse(names.add("a")); assertTrue(names.add("b"))
        assertTrue(names.add("c")); assertEquals(2, names.size())
        now = 11; assertTrue(names.add("b")); assertEquals(1, names.size())
    }
}
