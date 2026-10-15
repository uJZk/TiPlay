package com.shilapi.xcertplay.location

import android.os.SystemClock
import com.shilapi.xcertplay.transport.CarPlayLocationFix
import com.shilapi.xcertplay.transport.NmeaLocationEncoder
import com.shilapi.xcertplay.location.BrowserCoordinateDetector.Datum
import com.shilapi.xcertplay.location.BrowserCoordinateDetector.Point
import com.shilapi.xcertplay.location.BrowserCoordinateDetector.Sample
import uniffi.geocoordinates_ffi.Gcj02
import uniffi.geocoordinates_ffi.gcj02ToWgs84Refined
import uniffi.geocoordinates_ffi.outOfChina

/** Process-local bridge; raw coordinates are neither logged nor persisted on Android. */
object BrowserLocationRelay {
    private val state by lazy { BrowserLocationState(SystemClock::elapsedRealtime, System::currentTimeMillis,
        object : BrowserCoordinateConversion {
            override fun outside(point: Point) = outOfChina(point.latitude, point.longitude)
            override fun refined(point: Point): Point {
                val result = gcj02ToWgs84Refined(Gcj02(point.latitude, point.longitude))
                return Point(result.lat, result.lon)
            }
        }) }
    fun start(owner: Any) = state.start(owner)
    fun stop(owner: Any) = state.stop(owner)
    fun clear() = state.clear()
    fun leave(session: String) = state.leave(session)
    fun claim(session: String) = state.claim(session)
    internal fun reference(sample: Sample, fix: CarPlayLocationFix) = state.reference(sample, fix)
    fun needsReference() = state.needsReference()
    fun status(session: String) = state.status(session)
    fun accept(session: String, fields: Map<*, *>) = state.accept(session, fields)
    fun latestNmea() = state.latestNmea()
}

internal interface BrowserCoordinateConversion {
    fun outside(point: Point): Boolean
    fun refined(point: Point): Point
}

/** Pure session state, with injectable clocks and native conversion boundary. */
internal class BrowserLocationState(
    private val clock: () -> Long,
    private val wall: () -> Long,
    private val conversion: BrowserCoordinateConversion,
) {
    private var owner: Any? = null
    private var session: String? = null
    private var detector = BrowserCoordinateDetector(clock())
    private var reference: Sample? = null
    private var referenceFix: CarPlayLocationFix? = null
    private var confirmed: Datum? = null
    private var cached: Datum? = null
    private var latest: CarPlayLocationFix? = null
    private var latestAt = 0L
    private var sequence = -1.0
    private var sourceTime: Double? = null
    private var previous: Sample? = null
    private var settledSince = 0L
    private var stableCount = 0

    @Synchronized fun start(owner: Any) {
        if (this.owner === owner) return
        this.owner = owner
        resetSession(null)
    }
    @Synchronized fun stop(owner: Any) { if (this.owner === owner) { this.owner = null; resetSession(null) } }
    @Synchronized fun clear() { resetSession(null) }
    @Synchronized fun leave(session: String) { if (this.session == session) resetSession(null) }
    @Synchronized internal fun reference(sample: Sample, fix: CarPlayLocationFix) {
        if (owner == null) return
        reference = sample
        referenceFix = fix
    }
    @Synchronized fun needsReference(): Boolean = owner != null &&
        ((confirmed == null && cached == null) || browserFix() == null)
    @Synchronized fun status(session: String): Map<String, Any?> = mapOf(
        "active" to (owner != null),
        "datum" to confirmed?.takeIf { this.session == session }?.name,
    )

    private fun resetSession(session: String?) {
        this.session = session
        detector = BrowserCoordinateDetector(clock())
        reference = null; referenceFix = null; confirmed = null; cached = null; latest = null; previous = null
        latestAt = 0; sequence = -1.0; sourceTime = null; settledSince = 0; stableCount = 0
    }

    @Synchronized fun claim(session: String) {
        if (this.session != session) {
            val freshReference = reference
            val freshFix = referenceFix
            resetSession(session)
            reference = freshReference
            referenceFix = freshFix
        }
    }

    @Synchronized fun accept(session: String, fields: Map<*, *>) {
        if (owner == null || this.session != session) return
        fun number(key: String) = (fields[key] as? Number)?.toDouble()?.takeIf { it.isFinite() }
        val id = number("id") ?: return
        val source = number("timestamp") ?: return
        val age = number("age")?.takeIf { it in 0.0..3_000.0 } ?: return
        val latitude = number("lat")?.takeIf { it in -90.0..90.0 } ?: return
        val longitude = number("lon")?.takeIf { it in -180.0..180.0 } ?: return
        val accuracy = number("accuracy")?.takeIf { it in 0.1..100.0 } ?: return
        if (id <= sequence || source == sourceTime) return
        sequence = id; sourceTime = source
        cached = (fields["datum"] as? String)?.let { name -> Datum.entries.find { it.name == name } }
        val now = clock()
        val sample = Sample(Point(latitude, longitude), accuracy, now - age.toLong())
        val before = previous
        previous = sample
        if (before == null || sample.elapsed <= before.elapsed || sample.elapsed - before.elapsed > 10_000 ||
            BrowserCoordinateDetector.distance(sample.point, before.point) >
                70.0 * (sample.elapsed - before.elapsed) / 1000 + accuracy + before.accuracy) {
            settledSince = now; stableCount = 0; latest = null
            if (before != null) return
        } else stableCount++
        try {
            val known = confirmed ?: cached
            val outside = known != Datum.WGS84 && conversion.outside(sample.point)
            val converted = if (!outside && known != Datum.WGS84) {
                conversion.refined(sample.point)
            } else sample.point
            if (!outside && known == null) {
                val ref = reference ?: return
                confirmed = detector.observe(sample, ref, converted)
            }
            val datum = confirmed ?: cached
            // Cached/WGS fixes settle after a new watch; a newly proved GCJ02 pair is immediate.
            if (confirmed != Datum.GCJ02 && (now - settledSince < 5_000 || stableCount < 3)) return
            // Outside the library's fence both transforms are identity. Do not cache a global WGS verdict.
            if (!outside && datum == null) return
            val point = if (outside || datum == Datum.WGS84) sample.point else converted
            latest = CarPlayLocationFix(point.latitude, point.longitude,
                altitudeMeters = number("altitude"),
                bearingDegrees = number("heading")?.takeIf { it in 0.0..360.0 },
                speedMetersPerSecond = number("speed")?.takeIf { it >= 0 },
                accuracyMeters = accuracy,
                // Browser source timestamp may not be Unix milliseconds; never turn it into NMEA UTC.
                timestampMillis = wall() - age.toLong())
            latestAt = sample.elapsed
        } catch (_: Exception) {
            latest = null // A conversion failure must not fall through as WGS84.
        } catch (_: LinkageError) {
            latest = null
        }
    }

    private fun browserFix(): CarPlayLocationFix? = latest?.takeIf {
        owner != null && clock() - latestAt in 0..5_000
    }

    @Synchronized fun latestNmea(): String? {
        if (owner == null) return null
        val fix = browserFix() ?: referenceFix?.takeIf {
            reference?.let { clock() - it.elapsed in 0..10_000 } == true
        } ?: return null
        return NmeaLocationEncoder.encode(fix)
    }
}
