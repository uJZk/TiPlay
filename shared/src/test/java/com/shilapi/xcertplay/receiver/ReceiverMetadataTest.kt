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

    @Test fun nestedTrackMetadataPublishesTextAndDurationWithoutExposingItInLogs() {
        val body = field("mlit", field("minm", "夜曲\u0000".toByteArray()) +
            field("asar", "Artist".toByteArray()) + field("asal", "Album".toByteArray()) +
            field("astm", byteArrayOf(0, 3, 0x0d, 0x40)) + field("asgn", "Rock".toByteArray()))
        val updates = mutableListOf<ReceiverAudioMetadataUpdate>()
        val logs = mutableListOf<String>()
        assertNull(ReceiverMetadata.receive(request("application/x-dmap-tagged", body), logs::add, updates::add).status)
        assertEquals(ReceiverAudioMetadataUpdate(title = "夜曲", artist = "Artist", album = "Album",
            durationMillis = 200_000L), updates.single())
        assertFalse(logs.joinToString().contains("Artist"))
        assertFalse(logs.joinToString().contains("Album"))
        assertFalse(logs.joinToString().contains("夜曲"))

        updates.clear()
        ReceiverMetadata.receive(request("application/x-dmap-tagged", field("minm", ByteArray(0))), {}, updates::add)
        assertEquals("", updates.single().title)
        assertNull(updates.single().artist)
    }

    @Test fun artworkRetainsOriginalBytesDefensivelyAndAnExplicitClearIsObservable() {
        val updates = mutableListOf<ReceiverAudioMetadataUpdate>()
        val jpeg = byteArrayOf(0xff.toByte(), 0xd8.toByte(), 1, 2, 0xff.toByte(), 0xd9.toByte())
        ReceiverMetadata.receive(request("image/jpeg", jpeg), {}, updates::add)
        val image = requireNotNull(updates.single().artwork)
        assertEquals("image/jpeg", image.contentType)
        assertArrayEquals(jpeg, image.bytes)
        jpeg[2] = 7
        assertEquals(1, image.bytes[2].toInt())
        updates.clear()
        ReceiverMetadata.receive(request("image/none", ByteArray(0)), {}, updates::add)
        assertTrue(requireNotNull(updates.single().artwork).bytes.isEmpty())
        assertNull(updates.single().artwork?.contentType)
        updates.clear()
        ReceiverMetadata.receive(request("image/png", ByteArray(0)), {}, updates::add)
        assertTrue(requireNotNull(updates.single().artwork).bytes.isEmpty())
    }

    @Test fun progressPublishesUnsignedCoordinatesAndUnknownTrailingFieldsAreAtomic() {
        val updates = mutableListOf<ReceiverAudioMetadataUpdate>()
        ReceiverMetadata.receive(request("text/parameters", "volume: -10\r\nprogress: 4294967295/0/1\r\n".toByteArray()),
            {}, updates::add)
        assertEquals(ReceiverAudioProgress(0xffff_ffffL, 0L, 1L), updates.single().progress)
        updates.clear()
        assertEquals(451, ReceiverMetadata.receive(request("text/parameters",
            "progress: 0/1/2\r\nunsupported: yes\r\n".toByteArray()), {}, updates::add).status)
        assertTrue(updates.isEmpty())
        for (text in listOf("progress: 0/+1/2", "progress: 0/1/4294967296", "progress: 0/1/2\r\nprogress: 0/2/3")) {
            assertThrows(IllegalArgumentException::class.java) {
                ReceiverMetadata.receive(request("text/parameters", text.toByteArray()), {}, updates::add)
            }
        }
        assertTrue(updates.isEmpty())
    }

    @Test fun malformedOrExcessiveMetadataNeverPublishesPartialUpdates() {
        val updates = mutableListOf<ReceiverAudioMetadataUpdate>()
        val valid = field("minm", "valid title".toByteArray())
        var nested = valid
        repeat(9) { nested = field("mlit", nested) }
        val invalid = listOf(
            valid + field("asar", byteArrayOf(0xc3.toByte())), // malformed UTF-8
            valid + field("asal", "truncated".toByteArray()).dropLast(1),
            valid + field("minm", "duplicate".toByteArray()),
            field("astm", byteArrayOf(1, 2)),
            field("minm", ByteArray(4097) { 65 }),
            nested,
            ByteArray(1025 * 1024),
        )
        for (body in invalid) assertThrows(IllegalArgumentException::class.java) {
            ReceiverMetadata.receive(request("application/x-dmap-tagged", body), {}, updates::add)
        }
        for ((type, body) in listOf("image/jpeg" to byteArrayOf(1, 2, 3, 4),
            "image/png" to byteArrayOf(1, 2, 3, 4), "image/none" to byteArrayOf(1))) {
            assertThrows(IllegalArgumentException::class.java) {
                ReceiverMetadata.receive(request(type, body), {}, updates::add)
            }
        }
        assertTrue(updates.isEmpty())
    }

    private fun field(tag: String, bytes: ByteArray) = tag.toByteArray(Charsets.US_ASCII) +
        java.nio.ByteBuffer.allocate(4).putInt(bytes.size).array() + bytes
}
