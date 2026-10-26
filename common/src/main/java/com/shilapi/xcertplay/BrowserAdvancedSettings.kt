package com.shilapi.xcertplay

import android.content.Context
import android.widget.LinearLayout
import android.widget.Toast
import com.shilapi.xcertplay.airplay.AirPlayDisplaySettings
import com.shilapi.xcertplay.host.R

/** Browser-only controls live beside the retained head-unit cards and diagnostics. */
internal object BrowserAdvancedSettings {
    val sections = setOf(
        SettingsSection.CARPLAY_CONTROLS, SettingsSection.WHEEL_KEYS, SettingsSection.BYD_ADB,
        SettingsSection.DISPLAY_AND_PERFORMANCE, SettingsSection.EXPERIMENTAL_DISPLAY,
        SettingsSection.ADVANCED_MEDIA, SettingsSection.CAR_BUTTON, SettingsSection.AUDIO_ROUTING,
        SettingsSection.LOCATION, SettingsSection.CLUSTER_MAP, SettingsSection.BYD_NAVIGATION,
        SettingsSection.PERMISSIONS_AND_HELP, SettingsSection.DIAGNOSTICS,
    )

    fun build(
        context: Context,
        card: LinearLayout,
        choice: (LinearLayout, String, List<String>, Int, (Int) -> Unit) -> Unit,
        toggle: (LinearLayout, String, String, Boolean, (Boolean) -> Unit) -> Unit,
        reconnectNeeded: () -> Unit,
    ) {
        BrowserNativeSettingsUi(context).button(card, context.getString(R.string.settings_forget_airplay_devices)) {
            AirPlayDeviceTrustStore.forgetAll(context)
            Toast.makeText(context, R.string.settings_airplay_devices_forgotten, Toast.LENGTH_SHORT).show()
        }
        toggle(card, context.getString(R.string.settings_browser_location_disable),
            context.getString(R.string.settings_browser_location_disable_description),
            com.shilapi.xcertplay.location.BrowserLocationSettings.disabled(context)) {
            com.shilapi.xcertplay.location.BrowserLocationSettings.setDisabled(context, it)
            reconnectNeeded()
        }
        BrowserCarPlayAudioSettings.addControls(context, card, toggle, reconnectNeeded)
        val rates = (AirPlayDisplaySettings.MIN_FPS..AirPlayDisplaySettings.MAX_FPS
            step AirPlayDisplaySettings.FPS_STEP).toList()
        choice(card, context.getString(R.string.frame_rate), rates.map { "$it fps" },
            rates.indexOf(AirPlayPersistence.loadFps(context))) {
            AirPlayPersistence.saveFps(context, rates[it])
            reconnectNeeded()
        }
    }
}
