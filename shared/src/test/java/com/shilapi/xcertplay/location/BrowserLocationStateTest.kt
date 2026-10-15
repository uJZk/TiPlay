package com.shilapi.xcertplay.location

import com.shilapi.xcertplay.location.BrowserCoordinateDetector.*
import com.shilapi.xcertplay.transport.CarPlayLocationFix
import org.junit.Assert.*
import org.junit.Test

class BrowserLocationStateTest {
    private var now = 0L
    private var conversions = 0
    private var outside = false
    private var failed = false
    private val owner = Any()
    private val state = BrowserLocationState({ now }, { 1_800_000_000_000 + now }, object : BrowserCoordinateConversion {
        override fun outside(point: Point) = outside
        override fun refined(point: Point): Point {
            conversions++
            check(!failed)
            return Point(point.latitude - 0.004, point.longitude)
        }
    })
    private fun start() { state.start(owner); state.claim("page") }
    private fun reference(accuracy: Double = 10.0) {
        state.reference(Sample(Point(39.9, 116.4), accuracy, now),
            CarPlayLocationFix(39.9, 116.4, accuracyMeters = accuracy, timestampMillis = 1_800_000_000_000 + now))
    }
    private fun fields(id: Int, datum: String? = null, lat: Double = 39.904): Map<String, Any?> = mapOf(
        "id" to id, "timestamp" to id * 1000000.0, "age" to 0, "lat" to lat, "lon" to 116.4,
        "accuracy" to 10, "datum" to datum)

    @Test fun unknownUsesAndroidAndGcj02ImmediatelySwitchesToConvertedBrowser() {
        start(); now = 1000; reference()
        assertNotNull(state.latestNmea())
        state.accept("page", fields(1))
        assertEquals("GCJ02", state.status("page")["datum"])
        assertFalse(state.needsReference())
        assertTrue(state.latestNmea()!!.contains("3954.0000"))
    }

    @Test fun impreciseAndroidFixCanBeForwardedWithoutDecidingTheDatum() {
        start(); now = 1000; reference(1500.0)
        state.accept("page", fields(1))
        assertNull(state.status("page")["datum"])
        assertNotNull(state.latestNmea())
        now = 12000
        assertNull(state.latestNmea())
    }

    @Test fun cachedWgs84SkipsConversionAndSystemComparisonButWaitsForStableBrowserFixes() {
        start()
        repeat(4) { i -> now = 1000L + i * 2000; state.accept("page", fields(i + 1, "WGS84", 39.9)) }
        assertEquals(0, conversions)
        assertFalse(state.needsReference())
        assertNotNull(state.latestNmea())
        now += 6000
        assertNull(state.latestNmea())
        assertTrue(state.needsReference())
    }

    @Test fun fenceOutsideIsIdentityAndNeverStoresAGlobalWgs84Verdict() {
        start(); outside = true
        repeat(4) { i -> now = 1000L + i * 2000; state.accept("page", fields(i + 1)) }
        assertEquals(0, conversions)
        assertNull(state.status("page")["datum"])
        assertNotNull(state.latestNmea())
    }

    @Test fun retriesOldOwnersAndConversionFailuresCannotForwardRawGcj02() {
        start(); now = 1000; reference()
        state.accept("page", fields(1))
        assertNotNull(state.latestNmea())
        state.stop(Any()) // An obsolete provider cannot stop the active owner.
        assertNotNull(state.latestNmea())
        state.claim("replacement")
        now = 12000
        state.accept("page", fields(2))
        assertNull(state.latestNmea())
        failed = true
        state.accept("replacement", fields(1, "GCJ02"))
        now += 6000
        state.accept("replacement", fields(2, "GCJ02"))
        assertNull(state.latestNmea())
        state.stop(owner)
        assertEquals(false, state.status("replacement")["active"])
    }

    @Test fun expiredBrowserFixFallsBackToANewAndroidFix() {
        start(); now = 1000; reference(); state.accept("page", fields(1))
        now = 7000
        assertTrue(state.needsReference())
        state.reference(Sample(Point(39.901, 116.4), 50.0, now),
            CarPlayLocationFix(39.901, 116.4, accuracyMeters = 50.0))
        assertTrue(state.latestNmea()!!.contains("3954.0600"))
    }

    @Test fun staleAndDuplicateBrowserFixesDoNotExtendTheirLifetime() {
        start(); now = 1000; reference(); state.accept("page", fields(1))
        now = 12000
        state.accept("page", fields(1))
        assertNull(state.latestNmea())
        state.accept("page", fields(2) + mapOf("age" to 4000))
        assertNull(state.latestNmea())
    }
}
