package com.shilapi.xcertplay.location

import android.content.Context

object BrowserLocationSettings {
    private const val KEY = "browser_location_disabled"
    fun disabled(context: Context): Boolean = context.getSharedPreferences("xcertplay_airplay", Context.MODE_PRIVATE)
        .getBoolean(KEY, false)
    fun setDisabled(context: Context, disabled: Boolean) {
        context.getSharedPreferences("xcertplay_airplay", Context.MODE_PRIVATE).edit().putBoolean(KEY, disabled).apply()
        if (disabled) BrowserLocationRelay.clear()
    }
}
