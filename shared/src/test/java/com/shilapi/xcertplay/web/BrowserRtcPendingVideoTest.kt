package com.shilapi.xcertplay.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BrowserRtcPendingVideoTest {
    private fun frame(sequence: Int, key: Boolean = false, epoch: Int = 1, size: Int = 1) =
        WebVideoRecord(WebVideoRecords.KIND_FRAME, if (key) WebVideoRecords.FLAG_KEY_FRAME else 0,
            WebVideoRecords.CODEC_H264, sequence, epoch, sequence.toLong(), ByteArray(size))

    @Test fun retainsKeyAndDependentFramesInOrder() {
        val pending = BrowserRtcPendingVideo()
        pending.offer(frame(0))
        pending.offer(frame(1, key = true))
        pending.offer(frame(2))
        assertEquals(1, pending.poll(1)?.sequence)
        assertEquals(2, pending.poll(1)?.sequence)
        assertNull(pending.poll(1))
    }

    @Test fun overflowDiscardsWholeChainUntilNextKey() {
        val pending = BrowserRtcPendingVideo(maxFrames = 2, maxBytes = 4)
        pending.offer(frame(1, key = true, size = 2))
        pending.offer(frame(2, size = 2))
        pending.offer(frame(3))
        pending.offer(frame(4))
        assertNull(pending.poll(1))
        pending.offer(frame(5, key = true))
        assertEquals(5, pending.poll(1)?.sequence)
    }

    @Test fun replacesOlderKeyAndRejectsStaleEpoch() {
        val pending = BrowserRtcPendingVideo()
        pending.offer(frame(1, key = true))
        pending.offer(frame(2, key = true))
        assertNull(pending.poll(2))
        pending.offer(frame(3, key = true, epoch = 2))
        assertEquals(3, pending.poll(2)?.sequence)
    }
}
