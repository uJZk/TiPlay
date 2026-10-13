package com.shilapi.xcertplay

import android.content.Context
import com.shilapi.xcertplay.orchestration.CarPlayController

/** Car Bluetooth sound (docs/todo.md): CarPlay sound plays through TiPlay, or stays on the iPhone's Bluetooth link to the car. */
internal enum class CarBluetoothAudio {
    OFF,
    /** Like Carlinkit's BtAudio=1: /info leaves out only audioFormats. */
    ON,
    /** Also leaves out audioLatencies and the audio feature bits (AirPlayConfig.disableAudioOutput). */
    ALTERNATIVE,
    ;

    companion object {
        private const val PREFS = "xcertplay_airplay"
        private const val KEY = "tiplay_car_bluetooth_audio"
        private const val LEGACY_KEY = "car_bluetooth_audio"

        /** Migrate TiPlay's former string key before the upstream Boolean setting reads it. */
        fun load(context: Context): CarBluetoothAudio {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val saved = prefs.getString(KEY, null)
            if (saved != null) return entries.firstOrNull { it.name == saved } ?: OFF
            val legacy = prefs.all[LEGACY_KEY] as? String ?: return OFF
            val mode = entries.firstOrNull { it.name == legacy } ?: OFF
            prefs.edit().putString(KEY, mode.name).remove(LEGACY_KEY).apply()
            return mode
        }

        fun save(context: Context, mode: CarBluetoothAudio) {
            load(context)
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, mode.name).apply()
        }

        /**
         * The car Bluetooth sound a connection uses: the saved choice in phone + browser mode only, where the car's
         * browser shows the picture and the car plays the sound over the iPhone's Bluetooth. A head unit plays the
         * sound itself, so a choice saved in phone mode can never silence it. A running [session] keeps the mode it
         * connected with ([AirPlayPersistence.isPhoneBrowserMode]); without one, the saved mode applies.
         */
        fun effective(context: Context, session: CarPlayController?): CarBluetoothAudio =
            if (AirPlayPersistence.isPhoneBrowserMode(context, session)) load(context) else OFF
    }
}
