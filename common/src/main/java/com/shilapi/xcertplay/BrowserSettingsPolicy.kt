package com.shilapi.xcertplay

import android.content.Context
import com.shilapi.xcertplay.orchestration.CarPlayRunMode
import com.shilapi.xcertplay.orchestration.ManualHotspotBand

/** TiPlay is a browser receiver; head-unit configuration is retained only for upstream compatibility. */
internal object BrowserSettingsPolicy {
    /** Apply the product profile on entry. A running session keeps its negotiated configuration. */
    fun activate(context: Context) {
        CarBluetoothAudio.load(context) // Migrate the browser enum before upstream Boolean readers run.
        AirPlayPersistence.saveRunMode(context, CarPlayRunMode.PHONE_BROWSER)
        // Migrate the old independent launch-mode preference to the single saved connection choice.
        if (DiPlayPreferences.defaultConnectionMode(context) != DefaultConnectionMode.LAST_USED) {
            AirPlayPersistence.saveWirelessEnabled(context, DiPlayPreferences.autoConnectWireless(context))
            DiPlayPreferences.saveDefaultConnectionMode(context, DefaultConnectionMode.LAST_USED)
        }
        AirPlayPersistence.saveCarPlayNightMode(context, CarPlayNightMode.SYSTEM)
        AirPlayPersistence.saveLocationReportingEnabled(context, false)
        SplitScreenSettings.setEnabled(context, true)
        // The system owns phone tethering; stale radio hints must not override its current network.
        AirPlayPersistence.saveManualHotspotBand(context, ManualHotspotBand.AUTO)
        AirPlayPersistence.saveManualHotspotChannel(context, 0)
    }
    val hiddenSections = setOf(
        SettingsSection.DISPLAY_AND_PERFORMANCE, SettingsSection.EXPERIMENTAL_DISPLAY, SettingsSection.ADVANCED_MEDIA,
        SettingsSection.AUDIO_ROUTING, SettingsSection.LOCATION, SettingsSection.WHEEL_KEYS,
        SettingsSection.BYD_ADB, SettingsSection.CLUSTER_MAP, SettingsSection.BYD_NAVIGATION,
    )
    fun shows(section: SettingsSection) = section !in hiddenSections
}
