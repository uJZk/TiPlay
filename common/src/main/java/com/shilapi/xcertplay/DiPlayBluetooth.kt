package com.shilapi.xcertplay

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.provider.Settings
import com.shilapi.xcertplay.hud.BydBluetoothSuspend
import com.shilapi.xcertplay.transport.BluetoothRadioCheck

internal object DiPlayBluetooth {
    /** Unknown/denied state is not a radio-off observation; permission gates own that case. */
    fun radioOff(context: Context): Boolean = runCatching {
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
            ?: BluetoothAdapter.getDefaultAdapter()
        BluetoothRadioCheck.blocker(adapter != null, adapter?.isEnabled == true,
            BydBluetoothSuspend.isSuspendedByUs(context)) == BluetoothRadioCheck.RADIO_OFF
    }.getOrDefault(false)

    fun localAddress(context: Context): String? {
        val adapter = runCatching { (context.getSystemService(BluetoothManager::class.java)?.adapter ?: BluetoothAdapter.getDefaultAdapter())?.address }.getOrNull()
        val setting = runCatching { Settings.Secure.getString(context.contentResolver, "bluetooth_address") }.getOrNull()
        return listOfNotNull(adapter, setting).firstOrNull {
            Regex("(?i)([0-9a-f]{2}:){5}[0-9a-f]{2}").matches(it) &&
                !it.startsWith("02:00:00:00:00:") && it != "00:00:00:00:00:00"
        }
    }
}
