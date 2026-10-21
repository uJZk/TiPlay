package com.shilapi.xcertplay.receiver

import org.junit.Assert.*
import org.junit.Test
import java.io.InputStream

class ReceiverRequestBodyTest {
    /** Generate the payload on demand so the fixture does not allocate a second 32 MiB body. */
    private class ActionInput(target: String, private val size: Int, private val rejectPayloadReads: Boolean = false) : InputStream() {
        private val header = "POST $target HTTP/1.1\r\nCSeq: 42\r\nContent-Length: $size\r\n\r\n".toByteArray()
        private val following = "GET /info HTTP/1.1\r\nCSeq: 43\r\nContent-Length: 0\r\n\r\n".toByteArray()
        private var headerOffset = 0
        private var followingOffset = 0
        var payloadBytesRead = 0
            private set

        override fun read(): Int {
            if (headerOffset < header.size) return header[headerOffset++].toInt() and 255
            if (payloadBytesRead < size) {
                check(!rejectPayloadReads) { "Oversized action payload was read" }
                payloadBytesRead++; return 90
            }
            return if (followingOffset < following.size) following[followingOffset++].toInt() and 255 else -1
        }

        override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
            if (length == 0) return 0
            if (headerOffset < header.size) {
                val count = minOf(length, header.size - headerOffset)
                header.copyInto(bytes, offset, headerOffset, headerOffset + count)
                headerOffset += count; return count
            }
            if (payloadBytesRead < size) {
                check(!rejectPayloadReads) { "Oversized action payload was read" }
                val count = minOf(length, size - payloadBytesRead)
                java.util.Arrays.fill(bytes, offset, offset + count, 90.toByte())
                payloadBytesRead += count; return count
            }
            if (followingOffset < following.size) {
                val count = minOf(length, following.size - followingOffset)
                following.copyInto(bytes, offset, followingOffset, followingOffset + count)
                followingOffset += count; return count
            }
            return -1
        }
    }

    @Test fun actionBodyAcceptsTheExactEndpointLimitAndLeavesTheNextRequestUntouched() {
        val limit = 32 * 1024 * 1024
        for (size in listOf(limit - 1, limit)) {
            val target = if (size == limit) "/action?source=synthetic" else "http://receiver:7000/action?source=synthetic"
            val input = ActionInput(target, size)
            val request = readReceiverRequest(input)!!
            assertEquals("POST", request.method)
            assertEquals(target, request.path)
            assertEquals("42", request.headers["cseq"])
            assertEquals(size, request.body.size)
            assertEquals(90.toByte(), request.body.first())
            assertEquals(90.toByte(), request.body.last())
            assertEquals(size, input.payloadBytesRead)
            val following = readReceiverRequest(input)!!
            assertEquals("GET", following.method)
            assertEquals("/info", following.path)
            assertEquals("43", following.headers["cseq"])
            assertEquals(0, following.body.size)
            assertNull(readReceiverRequest(input))
        }
    }

    @Test fun oversizedActionBodyIsRejectedFromHeadersBeforeAnyPayloadIsRead() {
        val size = 32 * 1024 * 1024 + 1
        for (target in listOf("/action?source=synthetic", "http://receiver:7000/action?source=synthetic")) {
            val input = ActionInput(target, size, rejectPayloadReads = true)
            val failure = assertThrows(ReceiverRequestBodyTooLarge::class.java) { readReceiverRequest(input) }
            assertEquals("POST", failure.request.method)
            assertEquals(target, failure.request.path)
            assertEquals("HTTP/1.1", failure.request.protocol)
            assertEquals("42", failure.request.headers["cseq"])
            assertEquals("0", failure.request.headers["content-length"])
            assertEquals(0, failure.request.body.size)
            assertEquals(0, input.payloadBytesRead)
        }
    }
}
