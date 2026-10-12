package com.shilapi.xcertplay.receiver

import org.junit.Assert.*
import org.junit.Test

class ReceiverPhotosTest {
    private val jpeg = byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 0xd9.toByte())

    @Test fun cacheOnlyDoesNotDisplayAndCachedDataCannotBeMutatedByTheSender() {
        val cache = ReceiverPhotos()
        val source = jpeg.copyOf()
        assertNull(cache.receive("cacheOnly", "image", source))
        source[0] = 0
        assertArrayEquals(jpeg, cache.receive("displayCached", "image", ByteArray(0)))
        assertArrayEquals(jpeg, cache.receive(null, null, jpeg))
    }

    @Test fun oldImagesAreEvictedAndInvalidContentIsRejected() {
        val cache = ReceiverPhotos()
        repeat(9) { cache.receive("cacheOnly", "$it", jpeg) }
        rejected { cache.receive("displayCached", "0", ByteArray(0)) }
        rejected { cache.receive(null, null, ByteArray(20)) }
        rejected { cache.receive("cacheOnly", null, jpeg) }
        rejected { cache.receive("slideshow", "1", jpeg) }
        rejected { cache.receive(null, null, ByteArray(ReceiverPhotos.MAX_IMAGE_BYTES + 1)) }
    }

    private fun rejected(block: () -> Unit) {
        try { block(); fail("invalid photo accepted") } catch (_: IllegalArgumentException) {}
    }
}
