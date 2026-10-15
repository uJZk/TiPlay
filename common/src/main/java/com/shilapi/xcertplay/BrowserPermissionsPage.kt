package com.shilapi.xcertplay

import android.Manifest
import android.app.Activity
import android.bluetooth.BluetoothManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import com.shilapi.xcertplay.host.R

/** Permission rows report Android's current state; grants never come from a cached UI preference. */
internal class BrowserPermissionsPage(
    private val activity: Activity,
    parent: LinearLayout,
    private val request: (Array<String>) -> Unit,
) {
    private data class Row(val button: Button, val label: Int, val granted: () -> Boolean)
    private var locationViews: List<View> = emptyList()
    private val rows = mutableListOf<Row>()
    private val requested = activity.getSharedPreferences("tiplay_permission_requests", Activity.MODE_PRIVATE)
    private fun granted(permission: String) = activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    private fun appSettings() = open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${activity.packageName}")))
    private fun open(intent: Intent) { runCatching { activity.startActivity(intent) }.onFailure { runCatching { activity.startActivity(Intent(Settings.ACTION_SETTINGS)) } } }

    init {
        fun add(label: Int, state: () -> Boolean, action: () -> Unit) {
            val button = Button(activity).apply {
                minHeight = TiPlayNativeUi(activity).dp(48)
                setOnClickListener { action(); refresh() }
            }
            parent.addView(button, LinearLayout.LayoutParams(-1, -2).apply { topMargin = TiPlayNativeUi(activity).dp(8) })
            rows += Row(button, label, state)
        }
        fun permission(label: Int, permissions: List<String>) {
            add(label, { permissions.all(::granted) }) { authorize(permissions) }
        }
        add(R.string.settings_permission_bluetooth, {
            runCatching { activity.getSystemService(BluetoothManager::class.java)?.adapter?.isEnabled == true }.getOrDefault(false)
        }) {
            if (Build.VERSION.SDK_INT >= 31 && !granted(Manifest.permission.BLUETOOTH_CONNECT))
                authorize(listOf(Manifest.permission.BLUETOOTH_CONNECT))
            else open(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
        }
        if (Build.VERSION.SDK_INT >= 33) permission(R.string.nearby_devices,
            listOf(Manifest.permission.NEARBY_WIFI_DEVICES, Manifest.permission.BLUETOOTH_CONNECT))
        else if (Build.VERSION.SDK_INT >= 31) permission(R.string.nearby_devices,
            listOf(Manifest.permission.BLUETOOTH_CONNECT))
        permission(R.string.settings_permission_microphone, listOf(Manifest.permission.RECORD_AUDIO))
        permission(R.string.settings_permission_location, listOf(Manifest.permission.ACCESS_FINE_LOCATION))
        val locationRow = rows.last().button
        locationRow.contentDescription = activity.getString(R.string.settings_browser_location_permission_reason)
        val reason = TiPlayNativeUi(activity).label(activity.getString(R.string.settings_browser_location_permission_reason))
        parent.addView(reason)
        locationViews = listOf(locationRow, reason)
        if (Build.VERSION.SDK_INT >= 33) permission(R.string.settings_permission_notifications,
            listOf(Manifest.permission.POST_NOTIFICATIONS))
        if (LocalNetworkPermission.applies(activity)) permission(R.string.settings_permission_local_network,
            listOf(LocalNetworkPermission.PERMISSION))
        add(R.string.settings_ignore_battery_optimization, {
            activity.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(activity.packageName) == true
        }) { open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        refresh()
    }

    private fun authorize(permissions: List<String>) {
        val denied = permissions.filterNot(::granted)
        if (denied.isEmpty() || denied.any { requested.getBoolean(it, false) && !activity.shouldShowRequestPermissionRationale(it) }) {
            appSettings()
            return
        }
        requested.edit().apply { denied.forEach { putBoolean(it, true) } }.apply()
        // Android 12+ requires coarse and fine together even when upgrading an approximate grant.
        val batch = if (Build.VERSION.SDK_INT >= 31 && Manifest.permission.ACCESS_FINE_LOCATION in denied)
            listOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION) else denied
        request(batch.toTypedArray())
    }

    fun refresh() {
        val hidden = com.shilapi.xcertplay.location.BrowserLocationSettings.disabled(activity)
        locationViews.forEach { it.visibility = if (hidden) View.GONE else View.VISIBLE }
        rows.forEach { it.button.text = activity.getString(it.label) + " " + if (it.granted()) "✓" else "✕" }
    }
}
