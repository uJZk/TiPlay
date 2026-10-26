package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test

class AirPlayPhotoPlaybackTest {
    @Test fun browserDecodeFailureBelongsToTheCurrentPhotoAndIsDeliveredOnlyOnce() {
        val events = mutableListOf<String>()
        val first = AirPlayPhotoPlayback(byteArrayOf(-1, -40, -1, -39)) { events += "first:$it" }
        val previous = AirPlayBrowserPlayback.register(
            { AirPlayBrowserPlayback.State(0.0, 0.0, false, true, false, false, "photo") }, photo = first,
        ) { _, _ -> }
        val oldId = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
        val second = AirPlayPhotoPlayback(byteArrayOf(-1, -40, -1, -39)) { events += "second:$it" }
        val current = AirPlayBrowserPlayback.register(
            { AirPlayBrowserPlayback.State(0.0, 0.0, false, true, false, false, "photo") }, photo = second,
        ) { _, _ -> }
        try {
            val id = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
            assertFalse(AirPlayBrowserPlayback.report(oldId, mapOf("failed" to true)))
            assertFalse(AirPlayBrowserPlayback.report(id, mapOf("failed" to false)))
            assertTrue(AirPlayBrowserPlayback.report(id, mapOf("failed" to true)))
            assertFalse(AirPlayBrowserPlayback.report(id, mapOf("failed" to true)))
            previous.close()
            assertSame(second, AirPlayBrowserPlayback.photo(id))
            assertEquals(listOf("second:failed"), events)
        } finally { previous.close(); current.close() }
    }

    @Test fun browserResourcesRetainOriginalBytesAndCloseRetiresOnlyTheirOwner() {
        val bytes = byteArrayOf(0xff.toByte(), 0xd8.toByte(), 1, 2, 3, 0xff.toByte(), 0xd9.toByte())
        val photo = AirPlayPhotoPlayback(bytes)
        bytes[2] = 99
        val registration = AirPlayBrowserPlayback.register(
            { AirPlayBrowserPlayback.State(0.0, 0.0, false, true, false, false, "photo") }, photo = photo,
        ) { _, _ -> }
        val id = (AirPlayBrowserPlayback.snapshot()!!["id"] as Number).toLong()
        assertEquals("photo", AirPlayBrowserPlayback.snapshot()!!["resource"])
        assertSame(photo, AirPlayBrowserPlayback.photo(id))
        photo.open(null)!!.use { resource ->
            assertEquals("image/jpeg", resource.type)
            assertArrayEquals(byteArrayOf(0xff.toByte(), 0xd8.toByte(), 1, 2, 3, 0xff.toByte(), 0xd9.toByte()), resource.body.readBytes())
        }
        photo.open("bytes=2-4")!!.use { assertEquals(206, it.status); assertArrayEquals(byteArrayOf(1, 2, 3), it.body.readBytes()) }
        photo.open("bytes=100-")!!.use { assertEquals(416, it.status) }
        registration.close()
        assertNull(AirPlayBrowserPlayback.photo(id))
        assertNull(photo.open(null))
    }
}
