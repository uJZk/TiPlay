package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test

class AirPlayPhotoPlaybackTest {
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
