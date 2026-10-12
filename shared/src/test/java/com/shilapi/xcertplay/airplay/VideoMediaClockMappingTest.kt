package com.shilapi.xcertplay.airplay

import org.junit.Assert.assertEquals
import org.junit.Test

class VideoMediaClockMappingTest {
    @Test fun capturedTimingDomainAndScreenHeaderDomainMapToTheSameLocalClock() {
        // The real timing peer uses ~2209860263 s: 1900 epoch + 871463 s of source clock.
        val timingNanos = 2_209_860_263_125_000_000L
        val localNanos = 600_000_000_000L
        val offset = timingNanos - localNanos
        assertEquals(localNanos - 62_500_000L,
            VideoMediaClockMapping.toMonotonic(screenTimestamp(0x1000_0000L), offset))
        // A source presentation timestamp may be ahead of now; retain it, never clamp to arrival time.
        assertEquals(localNanos + 62_500_000L,
            VideoMediaClockMapping.toMonotonic(screenTimestamp(0x3000_0000L), offset))
    }

    private fun screenTimestamp(fraction: Long): Long {
        val header = ByteArray(128)
        val timestamp = (871_463L shl 32) or fraction
        for (index in 0..7) header[8 + index] = (timestamp ushr (index * 8)).toByte()
        return ScreenCodec.senderNanos(header)
    }
}
