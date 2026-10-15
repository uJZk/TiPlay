package com.shilapi.xcertplay.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import android.os.SystemClock
import com.shilapi.xcertplay.transport.Iap2LocationProvider
import com.shilapi.xcertplay.transport.CarPlayLocationFix

/** High accuracy Android GPS supplies WGS84 until the browser datum is known or when it expires. */
class BrowserCarPlayLocationProvider(context: Context) : Iap2LocationProvider {
    private val context = context.applicationContext
    private val manager = context.getSystemService(LocationManager::class.java)
    @Volatile private var started = false
    private var subscribed = false
    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            if (!started || !BrowserLocationRelay.needsReference() || location.isFromMockProvider ||
                !location.hasAccuracy() || location.accuracy !in 0.1f..5_000f ||
                !location.latitude.isFinite() || location.latitude !in -90.0..90.0 ||
                !location.longitude.isFinite() || location.longitude !in -180.0..180.0) return
            val elapsed = location.elapsedRealtimeNanos / 1_000_000
            if (SystemClock.elapsedRealtime() - elapsed !in 0..3_000) return
            BrowserLocationRelay.reference(BrowserCoordinateDetector.Sample(
                BrowserCoordinateDetector.Point(location.latitude, location.longitude), location.accuracy.toDouble(), elapsed),
                CarPlayLocationFix(location.latitude, location.longitude,
                    altitudeMeters = location.altitude.takeIf { location.hasAltitude() },
                    bearingDegrees = location.bearing.toDouble().takeIf { location.hasBearing() },
                    speedMetersPerSecond = location.speed.toDouble().takeIf { location.hasSpeed() },
                    accuracyMeters = location.accuracy.toDouble(), timestampMillis = location.time))
        }
        override fun onProviderEnabled(provider: String) = Unit
        override fun onProviderDisabled(provider: String) = Unit
        override fun onStatusChanged(provider: String, status: Int, extras: Bundle?) = Unit
    }

    @Synchronized override fun start(): Boolean {
        if (BrowserLocationSettings.disabled(context)) return false
        if (!started) { started = true; BrowserLocationRelay.start(this) }
        reconcile()
        // The browser works with a saved datum even if Android permission is denied.
        return true
    }

    @SuppressLint("MissingPermission")
    private fun reconcile() {
        val needsReference = started && BrowserLocationRelay.needsReference() && !BrowserLocationSettings.disabled(context) &&
            context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (needsReference && !subscribed) {
            try {
                manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1_000, 0f, listener, Looper.getMainLooper())
                subscribed = true
            } catch (_: SecurityException) {
                // Permission can be revoked between checking and subscribing.
            } catch (_: IllegalArgumentException) { }
        } else if (!needsReference && subscribed) {
            manager.removeUpdates(listener)
            subscribed = false
        }
    }

    @Synchronized override fun latestNmea(): String? {
        if (BrowserLocationSettings.disabled(context)) { stop(); return null }
        reconcile()
        return if (started) BrowserLocationRelay.latestNmea() else null
    }

    @Synchronized override fun stop() {
        started = false
        if (subscribed) manager.removeUpdates(listener)
        subscribed = false
        BrowserLocationRelay.stop(this)
    }
}
