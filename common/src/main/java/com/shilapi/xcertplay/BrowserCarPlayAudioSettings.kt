package com.shilapi.xcertplay

import android.content.Context
import android.widget.LinearLayout
import com.shilapi.xcertplay.host.R

/** Browser audio is opt-out. Old fixed Bluetooth defaults are not user choices for this control. */
internal object BrowserCarPlayAudioSettings {
    private const val PREFS = "tiplay_browser_audio"
    private const val DISABLED = "carplay_audio_disabled"

    fun disabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(DISABLED, false)

    fun saveDisabled(context: Context, disabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(DISABLED, disabled).apply()
        CarBluetoothConnection.selectionChanged(context)
    }

    fun addControls(context: Context, parent: LinearLayout,
        toggle: (LinearLayout, String, String, Boolean, (Boolean) -> Unit) -> Unit,
        changed: () -> Unit,
    ) {
        toggle(parent, context.getString(R.string.settings_disable_carplay_audio),
            context.getString(R.string.settings_disable_carplay_audio_description), disabled(context)) {
            saveDisabled(context, it)
            changed()
        }
    }
}
