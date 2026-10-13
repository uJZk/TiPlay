package com.shilapi.xcertplay

import com.shilapi.xcertplay.orchestration.CarPlayRunMode
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class BrowserSettingsPolicyTest {
    @Test fun openingSettingsKeepsAnExplicitCarPlayAudioOptOut() {
        val context = RuntimeEnvironment.getApplication()
        BrowserCarPlayAudioSettings.saveDisabled(context, true)
        try {
            BrowserSettingsPolicy.activate(context)
            assertTrue(BrowserCarPlayAudioSettings.disabled(context))
        } finally { BrowserCarPlayAudioSettings.saveDisabled(context, false) }
    }
    @Test fun openingTheProductMigratesOldChoicesWithoutChangingManualCredentials() {
        val context = RuntimeEnvironment.getApplication()
        AirPlayPersistence.saveRunMode(context, CarPlayRunMode.HEAD_UNIT)
        CarBluetoothAudio.save(context, CarBluetoothAudio.OFF)
        AirPlayPersistence.saveCarPlayNightMode(context, CarPlayNightMode.SCHEDULE)
        AirPlayPersistence.saveLocationReportingEnabled(context, true)
        AirPlayPersistence.saveManualHotspotSsid(context, "Manual phone hotspot")
        AirPlayPersistence.saveManualHotspotPassphrase(context, "manual123")
        SplitScreenSettings.setEnabled(context, false)
        AirPlayPersistence.saveManualHotspotBand(context, com.shilapi.xcertplay.orchestration.ManualHotspotBand.GHZ_5)
        AirPlayPersistence.saveManualHotspotChannel(context, 149)
        BrowserSettingsPolicy.activate(context)
        assertEquals(CarPlayRunMode.PHONE_BROWSER, AirPlayPersistence.loadRunMode(context))
        assertEquals(CarBluetoothAudio.OFF, CarBluetoothAudio.load(context))
        assertFalse(BrowserCarPlayAudioSettings.disabled(context))
        assertEquals(CarPlayNightMode.SYSTEM, AirPlayPersistence.loadCarPlayNightMode(context))
        assertTrue(SplitScreenSettings.enabled(context))
        assertFalse(AirPlayPersistence.loadLocationReportingEnabled(context))
        assertEquals(com.shilapi.xcertplay.orchestration.ManualHotspotBand.AUTO, AirPlayPersistence.loadManualHotspotBand(context))
        assertEquals(0, AirPlayPersistence.loadManualHotspotChannel(context))
        assertEquals("Manual phone hotspot", AirPlayPersistence.loadManualHotspotSsid(context))
        assertEquals("manual123", AirPlayPersistence.loadManualHotspotPassphrase(context))
    }
    @Test fun browserHevcDefaultsOnButKeepsAnExplicitCompatibilityChoice() {
        val context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences("xcertplay_airplay", 0).edit().clear().commit()
        BrowserSettingsPolicy.activate(context)
        assertTrue(AirPlayPersistence.loadHevcEnabled(context))
        AirPlayPersistence.saveHevcEnabled(context, false)
        BrowserSettingsPolicy.activate(context)
        assertFalse(AirPlayPersistence.loadHevcEnabled(context))
    }

    @Test fun oldUsbLaunchPreferenceBecomesTheSingleSavedConnectionMode() {
        val context = RuntimeEnvironment.getApplication()
        AirPlayPersistence.saveWirelessEnabled(context, true)
        DiPlayPreferences.saveDefaultConnectionMode(context, DefaultConnectionMode.USB)
        BrowserSettingsPolicy.activate(context)
        assertFalse(AirPlayPersistence.loadWirelessEnabled(context))
        assertFalse(DiPlayPreferences.autoConnectWireless(context))
        assertEquals(DefaultConnectionMode.LAST_USED, DiPlayPreferences.defaultConnectionMode(context))
        AirPlayPersistence.saveWirelessEnabled(context, true)
        BrowserSettingsPolicy.activate(context)
        assertTrue(DiPlayPreferences.autoConnectWireless(context))
    }

}
