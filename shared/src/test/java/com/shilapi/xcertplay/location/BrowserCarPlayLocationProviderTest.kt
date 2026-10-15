package com.shilapi.xcertplay.location

import android.Manifest
import android.content.Context
import android.location.Location
import android.location.LocationManager
import android.os.SystemClock
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], manifest = Config.NONE)
class BrowserCarPlayLocationProviderTest {
    private lateinit var context: Context
    private lateinit var manager: LocationManager
    private lateinit var provider: BrowserCarPlayLocationProvider

    @Before fun setup() {
        context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences("xcertplay_airplay", 0).edit().clear().commit()
        manager = context.getSystemService(LocationManager::class.java)
        shadowOf(manager).setLocationEnabled(true)
        shadowOf(manager).setProviderEnabled(LocationManager.GPS_PROVIDER, true)
        provider = BrowserCarPlayLocationProvider(context)
    }
    @After fun cleanup() { provider.stop() }

    @Test fun precisePermissionStartsGpsAndForwardsItBeforeBrowserConfirmation() {
        shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(
            Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)
        assertTrue(provider.start())
        assertEquals(1, shadowOf(manager).getLocationRequests(LocationManager.GPS_PROVIDER).size)
        assertTrue(shadowOf(manager).getLocationRequests(LocationManager.NETWORK_PROVIDER).isEmpty())
        val fix = Location(LocationManager.GPS_PROVIDER).apply {
            latitude = 39.9; longitude = 116.4; accuracy = 8f
            time = System.currentTimeMillis(); elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
        }
        shadowOf(manager).simulateLocation(fix)
        ShadowLooper.idleMainLooper()
        assertTrue(provider.latestNmea()!!.contains("3954.0000"))
        provider.stop()
        assertTrue(shadowOf(manager).getLocationRequests(LocationManager.GPS_PROVIDER).isEmpty())
        assertNull(provider.latestNmea())
    }

    @Test fun approximateOnlyGrantDoesNotStartGpsAndOptOutBlocksTheProvider() {
        shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.ACCESS_COARSE_LOCATION)
        assertTrue(provider.start()) // A browser with a cached datum remains usable.
        assertTrue(shadowOf(manager).getLocationRequests(LocationManager.GPS_PROVIDER).isEmpty())
        assertNull(provider.latestNmea())
        provider.stop()
        BrowserLocationSettings.setDisabled(context, true)
        assertFalse(provider.start())
    }
}
