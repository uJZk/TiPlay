package com.shilapi.xcertplay

import android.content.Context
import com.shilapi.xcertplay.orchestration.ManualHotspotSecurity

/** Explicit security is kept separately from the upstream SSID/password storage. */
internal object BrowserExistingWifiSettings {
    fun loadSecurity(context: Context): ManualHotspotSecurity {
        val saved = context.getSharedPreferences("tiplay_browser_network", 0).getString("externalSecurity", null)
        return ManualHotspotSecurity.entries.firstOrNull { it.name == saved }
            ?: if (AirPlayPersistence.loadExistingWifiPassphrase(context).isEmpty()) ManualHotspotSecurity.OPEN else ManualHotspotSecurity.WPA2
    }

    fun saveSecurity(context: Context, security: ManualHotspotSecurity) {
        context.getSharedPreferences("tiplay_browser_network", 0).edit().putString("externalSecurity", security.name).apply()
    }
}
