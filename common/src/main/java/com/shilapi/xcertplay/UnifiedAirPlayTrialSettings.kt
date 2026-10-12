package com.shilapi.xcertplay

import android.content.Context
import android.provider.Settings

/** Reversible diagnostic flag, sampled when the receiver service is created. */
internal object UnifiedAirPlayTrialSettings {
    const val KEY = com.shilapi.xcertplay.receiver.UnifiedAirPlayTrial.SETTINGS_KEY

    fun enabled(context: Context): Boolean =
        Settings.Global.getInt(context.contentResolver, KEY, 0) == 1
}
