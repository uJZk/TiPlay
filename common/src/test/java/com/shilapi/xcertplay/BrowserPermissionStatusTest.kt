package com.shilapi.xcertplay

import android.Manifest
import android.content.Intent
import android.os.PowerManager
import com.shilapi.xcertplay.host.R
import com.shilapi.xcertplay.location.BrowserLocationSettings
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowVpnService

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class BrowserPermissionStatusTest {
    private val context get() = RuntimeEnvironment.getApplication()
    @Before fun reset() {
        context.getSharedPreferences("tiplay_airplay_receiver", 0).edit().putBoolean("disabled", false).commit()
        BrowserCarPlaySettings.saveMode(context, BrowserCarPlaySettings.Mode.USB)
        BrowserCarPlayAudioSettings.saveDisabled(context, false)
        BrowserLocationSettings.setDisabled(context, false)
        shadowOf(context).denyPermissions(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE,
            Manifest.permission.NEARBY_WIFI_DEVICES, Manifest.permission.RECORD_AUDIO,
            Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.POST_NOTIFICATIONS)
        shadowOf(context.getSystemService(PowerManager::class.java)).setIgnoringBatteryOptimizations(context.packageName, false)
        ShadowVpnService.setPrepareResult(Intent("test.VPN_CONSENT"))
    }
    @Test fun missingChecklistIncludesAllApplicableRuntimeAndSpecialAccess() {
        assertEquals(setOf(R.string.nearby_devices, R.string.settings_permission_microphone,
            R.string.settings_permission_location, R.string.settings_permission_notifications,
            R.string.settings_ignore_battery_optimization, R.string.onboarding_usb_vpn),
            BrowserPermissionStatus.missingLabels(context).toSet())
    }
    @Test fun grantsAndRevocationAreReadLiveWithoutStoredCompletionFlags() {
        BrowserPermissionStatus.runtimeGroups(context).forEach { shadowOf(context).grantPermissions(*it.permissions.toTypedArray()) }
        shadowOf(context.getSystemService(PowerManager::class.java)).setIgnoringBatteryOptimizations(context.packageName, true)
        ShadowVpnService.setPrepareResult(null)
        assertTrue(BrowserPermissionStatus.missingLabels(context).isEmpty())
        shadowOf(context).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)
        assertEquals(listOf(R.string.settings_permission_notifications), BrowserPermissionStatus.missingLabels(context))
    }
    @Test fun featureRequirementsFollowAudioLocationAndTransportChoices() {
        BrowserCarPlayAudioSettings.saveDisabled(context, true)
        BrowserLocationSettings.setDisabled(context, true)
        var missing = BrowserPermissionStatus.missingLabels(context)
        assertFalse(R.string.settings_permission_microphone in missing)
        assertFalse(R.string.settings_permission_location in missing)
        assertTrue(R.string.onboarding_usb_vpn in missing)
        BrowserCarPlaySettings.saveMode(context, BrowserCarPlaySettings.Mode.WIRELESS)
        missing = BrowserPermissionStatus.missingLabels(context)
        assertFalse(R.string.onboarding_usb_vpn in missing)
    }

    @Test fun airPlayBeaconGrantIsRequestedOnlyWhenAirPlayIsEnabled() {
        assertTrue(Manifest.permission.BLUETOOTH_ADVERTISE in BrowserPermissionStatus.runtimeGroups(context).flatMap { it.permissions })
        context.getSharedPreferences("tiplay_airplay_receiver", 0).edit().putBoolean("disabled", true).commit()
        assertFalse(Manifest.permission.BLUETOOTH_ADVERTISE in BrowserPermissionStatus.runtimeGroups(context).flatMap { it.permissions })
    }
}
