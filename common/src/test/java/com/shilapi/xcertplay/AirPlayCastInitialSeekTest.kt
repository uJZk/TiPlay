package com.shilapi.xcertplay

import com.shilapi.xcertplay.receiver.ReceiverPlay
import org.junit.Assert.*
import org.junit.Test

class AirPlayCastInitialSeekTest {
    private val absolute = ReceiverPlay("https://example.org/video.mp4", 90.0, false)
    private val fraction = absolute.copy(start = 0.25, fraction = true)

    @Test fun absoluteResumeIsAppliedBeforeLoadingAndNotRepeatedAtFirstReady() {
        val seek = AirPlayCastInitialSeek()
        assertEquals(90_000L, seek.preparationMillis(absolute, null))
        assertNull(seek.afterReadyMillis(absolute, 600_000, null))
    }

    @Test fun fractionalResumeWaitsForDurationAndDoesNotReplaceAnIphoneSeek() {
        val seek = AirPlayCastInitialSeek()
        assertEquals(0L, seek.preparationMillis(fraction, null))
        assertEquals(150_000L, seek.afterReadyMillis(fraction, 600_000, null))
        seek.reset()
        assertEquals(0L, seek.preparationMillis(fraction, null))
        seek.applied(45.0)
        assertNull(seek.afterReadyMillis(fraction, 600_000, 45.0))
    }

    @Test fun latestPendingSeekWinsIncludingSeekingToZero() {
        val seek = AirPlayCastInitialSeek()
        assertEquals(80_000L, seek.preparationMillis(absolute, 80.0))
        assertEquals(0L, seek.afterReadyMillis(absolute, 600_000, 0.0))
        assertNull(seek.afterReadyMillis(absolute, 600_000, 0.0))
    }
}
