package com.shilapi.xcertplay

import android.content.Context
import android.hardware.usb.UsbManager

/** Product policy, separate from upstream's two transport runtime configurations. */
internal object BrowserCarPlaySettings {
    enum class Mode { ALL, WIRELESS, USB }
    private fun prefs(context: Context) = context.getSharedPreferences("tiplay_carplay", Context.MODE_PRIVATE)
    fun disabled(context: Context) = prefs(context).getBoolean("disabled", false)
    fun setDisabled(context: Context, disabled: Boolean) {
        prefs(context).edit().putBoolean("disabled", disabled).apply()
        BrowserSettingsChanges.apply(context)
    }
    fun mode(context: Context): Mode = if (prefs(context).getBoolean("all", false)) Mode.ALL
        else if (AirPlayPersistence.loadWirelessEnabled(context)) Mode.WIRELESS else Mode.USB
    fun saveMode(context: Context, mode: Mode) {
        prefs(context).edit().putBoolean("all", mode == Mode.ALL).apply()
        AirPlayPersistence.saveWirelessEnabled(context, mode != Mode.USB)
    }
    fun usbAttached(context: Context): Boolean = runCatching {
        context.getSystemService(UsbManager::class.java)?.deviceList?.values?.any { it.vendorId == 0x05ac } == true
    }.getOrDefault(false)
    fun wireless(context: Context): Boolean = when (mode(context)) {
        Mode.ALL -> !usbAttached(context)
        Mode.WIRELESS -> true
        Mode.USB -> false
    }
}
