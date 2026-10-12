package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.RtspMessage
import org.junit.Assert.*
import org.junit.Test

class ReceiverMetadataTest {
    private fun request(type: String, body: ByteArray) =
        RtspMessage.Request("SET_PARAMETER", "/", "RTSP/1.0", mapOf("content-type" to type), body)

    @Test fun dmapIsBoundedAndDiagnosticDoesNotContainTheTrackText() {
        val text = "private track name".toByteArray()
        val field = "minm".toByteArray() + java.nio.ByteBuffer.allocate(4).putInt(text.size).array() + text
        val logs = mutableListOf<String>()
        assertNull(ReceiverMetadata.receive(request("application/x-dmap-tagged", field), logs::add).status)
        assertEquals(listOf("metadata kind=DMAP fields=1 bodyBytes=${field.size}"), logs)
        assertThrows(IllegalArgumentException::class.java) {
            ReceiverMetadata.receive(request("application/x-dmap-tagged", field.copyOf(field.size - 1))) {}
        }
    }

    @Test fun progressAcceptsWrappedRtpCountersButRejectsInvalidSamplesAndUnknownParameters() {
        val logs = mutableListOf<String>()
        assertNull(ReceiverMetadata.receive(request("text/parameters", "progress: 4294967295/0/1\r\n".toByteArray()), logs::add).status)
        assertEquals(listOf("metadata kind=PROGRESS"), logs)
        assertThrows(IllegalArgumentException::class.java) {
            ReceiverMetadata.receive(request("text/parameters", "progress: 0/NaN/1".toByteArray())) {}
        }
        assertEquals(451, ReceiverMetadata.receive(request("text/parameters", "unknown: 1".toByteArray())) {}.status)
    }
}
