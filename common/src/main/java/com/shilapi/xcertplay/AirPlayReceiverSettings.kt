package com.shilapi.xcertplay

import android.content.Context
import android.content.Intent
import android.os.Build

/** Immediate receiver opt-out, independent of CarPlay connection drafts and pairing identity. */
internal object AirPlayReceiverSettings {
    private const val PREFS = "tiplay_airplay_receiver"
    private const val DISABLED = "disabled"

    fun isDisabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(DISABLED, false)

    fun setDisabled(context: Context, disabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(DISABLED, disabled).apply()
        sync(context)
    }

    /** Called while a product activity is visible, including after network permission is granted. */
    fun sync(context: Context) {
        val service = Intent(context, AirPlayReceiverService::class.java)
        if (isDisabled(context)) {
            context.stopService(service)
        } else if (AirPlayPersistence.isPhoneBrowserMode(context) &&
            LocalNetworkPermission.state(context) != LocalNetworkPermission.State.DENIED) {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service)
            else context.startService(service)
        }
    }
}
