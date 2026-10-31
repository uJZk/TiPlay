package com.shilapi.xcertplay

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.widget.Toast
import com.shilapi.xcertplay.host.R

internal object CarBluetoothPreference {
    private const val PREFS = "tiplay_car_bluetooth"
    fun address(context: Context): String? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("address", null)
    fun name(context: Context): String? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("name", null)
    fun save(context: Context, address: String?, name: String?, retrySelected: Boolean = false) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("address", address).putString("name", name).apply()
        CarBluetoothConnection.selectionChanged(context, forceRetry = retrySelected)
    }
}

/** Selects a device paired from the car; selecting never scans or starts pairing. */
@SuppressLint("MissingPermission")
internal class CarBluetoothSelection(
    private val activity: Activity,
    private val changed: () -> Unit,
) {
    private fun permitted() = Build.VERSION.SDK_INT < 31 ||
        activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    fun select(address: String) {
        if (!permitted()) { message(R.string.settings_car_bluetooth_permission); return }
        if (address.equals(DiPlayPreferences.phoneAddress(activity), true)) {
            message(R.string.settings_car_bluetooth_not_iphone); return
        }
        val adapter = activity.getSystemService(BluetoothManager::class.java)?.adapter
        if (runCatching { adapter?.isEnabled }.getOrNull() != true) {
            message(R.string.settings_car_bluetooth_enable); return
        }
        val selection = runCatching {
            val device = adapter?.bondedDevices?.firstOrNull { it.address.equals(address, true) }
                ?.takeIf { it.bondState == BluetoothDevice.BOND_BONDED } ?: return@runCatching null
            device.address to device.name.orEmpty().ifBlank { activity.getString(R.string.paired_device) }
        }.getOrNull()
        if (selection == null) {
            message(if (permitted()) R.string.settings_car_bluetooth_pair_first else R.string.settings_car_bluetooth_permission)
            return
        }
        // Re-selecting the same paired car is an explicit retry, even when the
        // platform accepted the earlier request without ever connecting it.
        CarBluetoothPreference.save(activity, selection.first, selection.second, retrySelected = true)
        changed()
    }

    private fun message(id: Int) {
        if (!activity.isDestroyed) Toast.makeText(activity, id, Toast.LENGTH_LONG).show()
    }
}
