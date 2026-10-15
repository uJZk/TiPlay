package com.shilapi.xcertplay.location

import kotlin.math.*

/** Pure decision logic. A browser fix with an unknown datum never reaches the iPhone. */
internal class BrowserCoordinateDetector(private val startedAt: Long) {
    enum class Datum { WGS84, GCJ02 }
    data class Point(val latitude: Double, val longitude: Double)
    data class Sample(val point: Point, val accuracy: Double, val elapsed: Long)
    var datum: Datum? = null
        private set
    private var candidate: Datum? = null
    private var anchor: Pair<Sample, Sample>? = null
    private var previous: Pair<Sample, Sample>? = null
    private var count = 0
    private var lastReference = Long.MIN_VALUE

    fun observe(web: Sample, reference: Sample, converted: Point): Datum? {
        if (datum != null) return datum
        // Ignore imprecise, unpaired and repeated Android fixes.
        if (abs(web.elapsed - reference.elapsed) > 2_000 || reference.elapsed <= lastReference ||
            web.accuracy !in 0.1..100.0 || reference.accuracy !in 0.1..100.0) return null
        lastReference = reference.elapsed
        val uncertainty = max(30.0, web.accuracy + reference.accuracy)
        val rawError = distance(web.point, reference.point)
        val correctedError = distance(converted, reference.point)
        // A fresh, precise pair that fits only the converted hypothesis confirms GCJ-02 immediately.
        if (correctedError <= uncertainty && rawError - correctedError > 2 * uncertainty) {
            datum = Datum.GCJ02
            return datum
        }
        // Only WGS84 needs warm-up and sustained movement evidence.
        if (web.elapsed - startedAt < 15_000 || reference.elapsed - startedAt < 15_000) return null
        val pair = web to reference
        val before = previous
        previous = pair
        if (before != null) {
            val seconds = (web.elapsed - before.first.elapsed) / 1000.0
            val webMove = distance(web.point, before.first.point)
            val refMove = distance(reference.point, before.second.point)
            if (seconds <= 0 || seconds > 10 ||
                max(webMove, refMove) > seconds * 70 + web.accuracy + reference.accuracy ||
                abs(webMove - refMove) > max(50.0, 2 * (web.accuracy + reference.accuracy))) {
                reset(); return null
            }
        }
        // The two hypotheses must be well separated relative to sensor uncertainty.
        val winner = when {
            rawError <= uncertainty && correctedError - rawError > 2 * uncertainty -> Datum.WGS84
            else -> null
        }
        if (winner == null) { reset(); return null }
        if (candidate != winner) { reset(); candidate = winner; anchor = pair }
        count++
        val first = anchor ?: return null
        val travel = min(distance(web.point, first.first.point), distance(reference.point, first.second.point))
        // WGS84 needs movement, not a cluster of stationary fixes with a persistent start-up offset.
        if (count >= 8 && web.elapsed - first.first.elapsed >= 20_000 &&
            travel >= max(300.0, 4 * uncertainty)) datum = winner
        return datum
    }

    private fun reset() { candidate = null; anchor = null; count = 0 }

    companion object {
        fun distance(a: Point, b: Point): Double {
            val lat = Math.toRadians(b.latitude - a.latitude)
            val lon = Math.toRadians(b.longitude - a.longitude)
            val h = sin(lat / 2).pow(2) + cos(Math.toRadians(a.latitude)) *
                cos(Math.toRadians(b.latitude)) * sin(lon / 2).pow(2)
            return 12_742_000 * asin(sqrt(h.coerceIn(0.0, 1.0)))
        }
    }
}
