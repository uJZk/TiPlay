package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test

class AirPlayCastFrameTimesTest {
    @Test fun codecMicrosecondQuantizationPreservesTheSourceClock() {
        val times = AirPlayCastFrameTimes()
        times.add(10, 100_999, 120_000)
        assertEquals(120_000L, times.take(100_000))
        times.add(20, 200_501, 220_000)
        assertEquals(220_000L, times.take(201_000))
        times.add(30, 300_000, 320_000)
        assertNull(times.take(301_000))
    }

    @Test fun coalescedSurfaceOutputKeepsTheCorrectMediaTimeForEitherSurfaceTimestampConvention() {
        val times = AirPlayCastFrameTimes()
        times.add(10, 100_000, 120_000)
        times.add(20, 200_000, 220_000)
        assertEquals(220_000L, times.take(200_000))
        assertNull(times.take(100_000))
        times.add(30, 300_000, 320_000)
        assertEquals(320_000L, times.take(30_000))
    }

    @Test fun seekClearsOldMetadataAndUnknownTimestampDoesNotInventAPresentationTime() {
        val times = AirPlayCastFrameTimes()
        times.add(10, 100_000, 120_000)
        assertNull(times.take(110_000))
        times.clear()
        assertNull(times.take(100_000))
    }
}
