package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayIdentity
import org.junit.Assert.*
import org.junit.Test

class ReceiverHandshakeTest {
    @Test fun validPublicHeadersRouteBothFairPlayStepsToTheResponder() {
        for (size in listOf(16, 164)) {
            val body = request(size)
            val response = ReceiverHandshake.fairPlay(body) {
                assertArrayEquals(body, it)
                ByteArray(if (size == 16) 142 else 32)
            }
            assertEquals(200, response.status)
            assertEquals("application/octet-stream", response.headers["Content-Type"])
            assertEquals(if (size == 16) 142 else 32, response.body.size)
        }
    }

    @Test fun unsupportedVersionIsDistinctFromDamagedFramingWithoutCallingNativeCode() {
        val unsupported = request(16).apply { this[4] = 2 }
        assertEquals(501, ReceiverHandshake.fairPlay(unsupported) { fail("Unsupported version reached responder"); null }.status)
        val malformed = listOf(
            ByteArray(16), request(16).apply { this[0] = 0 },
            request(16).apply { this[5] = 2 }, request(16).apply { this[6] = 3 },
            request(16).apply { this[7] = 1 }, request(16).apply { this[11] = 5 },
            request(16).apply { this[14] = 4 }, request(164).apply { this[12] = 4 },
            unsupported.copyOf().apply { this[0] = 0 },
        )
        for (body in malformed) {
            assertEquals(400, ReceiverHandshake.fairPlay(body) { fail("Damaged framing reached responder"); null }.status)
        }
    }

    @Test fun missingOrInvalidNativeReplyCannotBecomeSuccessfulHandshake() {
        assertEquals(400, ReceiverHandshake.fairPlay(request(16)) { null }.status)
        assertEquals(400, ReceiverHandshake.fairPlay(request(164)) { ByteArray(142) }.status)
    }

    @Test fun pairingFailureAsksTheControlLoopToCloseAfterReplying() {
        val receiver = ReceiverPairing(AirPlayIdentity.generate())
        val response = ReceiverHandshake.pairing { receiver.verify(ByteArray(68)) }
        assertEquals(400, response.status)
        assertEquals("close", response.headers["Connection"])
        assertTrue(response.body.isEmpty())
        assertNull(receiver.sharedSecret)
    }

    private fun request(size: Int): ByteArray = ByteArray(size).apply {
        byteArrayOf(0x46, 0x50, 0x4c, 0x59).copyInto(this)
        this[4] = 3
        this[5] = 1
        this[6] = if (size == 16) 1 else 3
        this[11] = (size - 12).toByte()
    }
}
