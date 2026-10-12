package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.RtspMessage
import org.junit.Assert.*
import org.junit.Test

class ReceiverMirrorParametersTest {
    private fun request(body: String, type: String? = "text/parameters") = RtspMessage.Request(
        "GET_PARAMETER", "/", "RTSP/1.0", type?.let { mapOf("content-type" to it) }.orEmpty(), body.toByteArray(),
    )

    @Test fun legacyVolumeQueryHasATextParameterReplyAndEmptyKeepaliveSucceeds() {
        val response = ReceiverMirrorParameters.reply(request("volume\r\n"))
        assertEquals(200, response.status ?: 200)
        assertEquals("text/parameters", response.headers["Content-Type"])
        assertEquals("volume: -144.0\r\n", response.body.toString(Charsets.US_ASCII))
        assertEquals("volume: -144.0\r\n", ReceiverMirrorParameters.reply(request("volume\r\n", null)).body.toString(Charsets.US_ASCII))
        assertTrue(ReceiverMirrorParameters.reply(request("", null)).body.isEmpty())
    }

    @Test fun malformedOrUnknownParametersAreRejectedWithoutEchoingThem() {
        for (request in listOf(request("secret", null), request("secret"), request("volume\r\nsecret\r\n"), request("volume\r\n", "application/octet-stream"))) {
            val response = ReceiverMirrorParameters.reply(request)
            assertEquals(451, response.status)
            assertTrue(response.body.isEmpty())
        }
    }
}
