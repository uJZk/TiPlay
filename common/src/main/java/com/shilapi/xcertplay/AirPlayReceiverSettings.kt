package com.shilapi.xcertplay

import android.content.Context
import android.content.Intent

/** Immediate receiver opt-out, independent of CarPlay connection drafts and pairing identity. */
internal object AirPlayReceiverSettings {
    private const val PREFS = "tiplay_airplay_receiver"
    private const val DISABLED = "disabled"

    fun isDisabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(DISABLED, false)

    fun setDisabled(context: Context, disabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(DISABLED, disabled).apply()
        if (disabled) context.stopService(Intent(context, AirPlayReceiverService::class.java))
    }
}
