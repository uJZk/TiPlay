package com.shilapi.xcertplay.location

import com.shilapi.xcertplay.location.BrowserCoordinateDetector.*
import org.junit.Assert.*
import org.junit.Test

class BrowserCoordinateDetectorTest {
    private fun sample(latitude: Double, time: Long, accuracy: Double = 10.0) = Sample(Point(latitude, 116.4), accuracy, time)

    @Test fun gcj02IsImmediateWhenOnlyTheRefinedPointMatches() {
        val detector = BrowserCoordinateDetector(0)
        assertEquals(Datum.GCJ02, detector.observe(sample(39.904, 1000), sample(39.9, 1000), Point(39.9, 116.4)))
    }

    @Test fun wgs84RequiresWarmupMultipleIndependentReferencesAndDisplacement() {
        val detector = BrowserCoordinateDetector(0)
        repeat(20) { index ->
            val time = 16_000L + index * 3_000
            val raw = sample(39.9, time)
            assertNull(detector.observe(raw, raw, Point(39.896, 116.4)))
        }
        var result: Datum? = null
        repeat(20) { index ->
            val time = 76_000L + index * 3_000
            val latitude = 39.9 + index * 0.00025
            val raw = sample(latitude, time)
            result = detector.observe(raw, raw, Point(latitude - 0.004, 116.4))
        }
        assertEquals(Datum.WGS84, result)
    }

    @Test fun staleImpreciseAndRepeatedEvidenceCannotConfirm() {
        val d = BrowserCoordinateDetector(0)
        assertNull(d.observe(sample(39.904, 5000), sample(39.9, 1000), Point(39.9, 116.4)))
        assertNull(d.observe(sample(39.904, 5000), sample(39.9, 5000, 500.0), Point(39.9, 116.4)))
        val wgs = BrowserCoordinateDetector(0)
        repeat(30) { i ->
            val raw = sample(39.9 + i * 0.0002, 16_000)
            assertNull(wgs.observe(raw, raw, Point(raw.point.latitude - 0.004, 116.4)))
        }
    }

    @Test fun ambiguousFixesAndStartupDriftCannotCreateAWgs84Verdict() {
        val d = BrowserCoordinateDetector(0)
        repeat(10) { i ->
            val raw = sample(39.9 + i * 0.001, i * 1000L)
            assertNull(d.observe(raw, raw, Point(raw.point.latitude - 0.004, 116.4)))
        }
        repeat(30) { i ->
            val raw = sample(39.9 + i * 0.001, 16_000 + i * 1000L, 90.0)
            val reference = sample(raw.point.latitude - 0.002, raw.elapsed, 90.0)
            assertNull(d.observe(raw, reference, Point(raw.point.latitude - 0.004, 116.4)))
        }
    }
}
