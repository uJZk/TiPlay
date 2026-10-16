package com.shilapi.xcertplay

import android.Manifest
import android.app.Activity
import android.bluetooth.BluetoothManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import com.shilapi.xcertplay.host.R

/** Permission rows report Android's current state; grants never come from a cached UI preference. */
internal class BrowserPermissionsPage(
    private val activity: Activity,
    private val parent: LinearLayout,
    private val request: (Array<String>) -> Unit,
) {
    private data class Row(val button: Button, val label: Int, val granted: () -> Boolean)
    private data class RuntimeGroup(val permissions: List<String>, val enabled: () -> Boolean)
    private val runtimeGroups = mutableListOf<RuntimeGroup>()
    private var microphoneView: View? = null
    private var locationViews: List<View> = emptyList()
    private val rows = mutableListOf<Row>()
    private val requested = activity.getSharedPreferences("tiplay_permission_requests", Activity.MODE_PRIVATE)
    private fun granted(permission: String) = activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    private fun appSettings() = open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${activity.packageName}")))
    private fun open(intent: Intent) { runCatching { activity.startActivity(intent) }.onFailure { runCatching { activity.startActivity(Intent(Settings.ACTION_SETTINGS)) } } }

    init {
        fun add(label: Int, state: () -> Boolean, action: () -> Unit) {
            val button = Button(activity).apply {
                isAllCaps = false
                minHeight = TiPlayNativeUi(activity).dp(48)
                setOnClickListener { action(); refresh() }
            }
            parent.addView(button, LinearLayout.LayoutParams(-1, -2).apply { topMargin = TiPlayNativeUi(activity).dp(8) })
            rows += Row(button, label, state)
        }
        fun permission(label: Int, permissions: List<String>, enabled: () -> Boolean = { true }) {
            runtimeGroups += RuntimeGroup(permissions, enabled)
            add(label, { !enabled() || permissions.all(::granted) }) { authorize(permissions) }
        }
        add(R.string.settings_permission_bluetooth, {
            runCatching { activity.getSystemService(BluetoothManager::class.java)?.adapter?.isEnabled == true }.getOrDefault(false)
        }) {
            if (Build.VERSION.SDK_INT >= 31 && !granted(Manifest.permission.BLUETOOTH_CONNECT))
                authorize(listOf(Manifest.permission.BLUETOOTH_CONNECT))
            else open(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
        }
        BrowserPermissionStatus.runtimeGroups(activity).forEach { group ->
            permission(group.label, group.permissions, group.enabled)
            if (group.label == R.string.settings_permission_microphone) microphoneView = rows.last().button
            if (group.label == R.string.settings_permission_location) {
                val locationRow = rows.last().button
                locationRow.contentDescription = activity.getString(R.string.settings_browser_location_permission_reason)
                val reason = TiPlayNativeUi(activity).label(activity.getString(R.string.settings_browser_location_permission_reason))
                BrowserNativeSettingsUi(activity).related(reason)
                parent.addView(reason)
                locationViews = listOf(locationRow, reason)
            }
        }
        add(R.string.settings_ignore_battery_optimization, {
            BrowserPermissionStatus.batteryAllowed(activity)
        }) { open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        refresh()
    }

    private fun needsLocation() = BrowserPermissionStatus.needsLocation(activity)

    private fun authorize(permissions: List<String>) {
        val denied = permissions.filterNot(::granted)
        val requestable = denied.filterNot { requested.getBoolean(it, false) && !activity.shouldShowRequestPermissionRationale(it) }
        if (requestable.isEmpty()) {
            appSettings()
            return
        }
        requested.edit().apply { requestable.forEach { putBoolean(it, true) } }.apply()
        if (LocalNetworkPermission.PERMISSION in requestable) LocalNetworkPermission.markRequested(activity)
        // Android 12+ requires coarse and fine together even when upgrading an approximate grant.
        val batch = if (Build.VERSION.SDK_INT >= 31 && Manifest.permission.ACCESS_FINE_LOCATION in requestable)
            (requestable + Manifest.permission.ACCESS_COARSE_LOCATION + Manifest.permission.ACCESS_FINE_LOCATION).distinct() else requestable
        request(batch.toTypedArray())
    }

    fun missingRuntimePermissions(): List<String> = runtimeGroups.filter { it.enabled() }
        .flatMap { it.permissions }.distinct().filterNot(::granted)

    fun requestMissingPermissions() {
        val missing = missingRuntimePermissions()
        if (missing.isNotEmpty()) authorize(missing)
    }

    fun allGranted(): Boolean = rows.all { it.granted() }

    fun refresh() {
        microphoneView?.visibility = if (BrowserCarPlayAudioSettings.disabled(activity)) View.GONE else View.VISIBLE
        val hidden = !needsLocation()
        locationViews.forEach { it.visibility = if (hidden) View.GONE else View.VISIBLE }
        rows.forEach { it.button.text = activity.getString(it.label) + " " + if (it.granted()) "✓" else "✕" }
        BrowserNativeSettingsUi(activity).normalizeSpacing(parent, recursive = true)
    }
}
