package com.shilapi.xcertplay

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import com.shilapi.xcertplay.host.R
import com.shilapi.xcertplay.location.BrowserLocationSettings
import com.shilapi.xcertplay.network.CarPlayVpnService

/** Current checklist requirements, shared by the checklist and the main-page reminder. */
internal object BrowserPermissionStatus {
    data class Group(val label: Int, val permissions: List<String>, val enabled: () -> Boolean = { true })
    fun needsLocation(context: Context) = !BrowserLocationSettings.disabled(context) ||
        (Build.VERSION.SDK_INT <= 32 && BrowserCarPlaySettings.mode(context) != BrowserCarPlaySettings.Mode.USB)

    fun runtimeGroups(context: Context): List<Group> = buildList {
        if (Build.VERSION.SDK_INT >= 31) add(Group(R.string.nearby_devices, buildList {
            add(Manifest.permission.BLUETOOTH_CONNECT)
            if (!AirPlayReceiverSettings.isDisabled(context)) add(Manifest.permission.BLUETOOTH_ADVERTISE)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.NEARBY_WIFI_DEVICES)
        }))
        add(Group(R.string.settings_permission_microphone, listOf(Manifest.permission.RECORD_AUDIO),
            { !BrowserCarPlayAudioSettings.disabled(context) }))
        add(Group(R.string.settings_permission_location,
            listOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION), { needsLocation(context) }))
        if (Build.VERSION.SDK_INT >= 33) add(Group(R.string.settings_permission_notifications, listOf(Manifest.permission.POST_NOTIFICATIONS)))
        if (LocalNetworkPermission.applies(context)) add(Group(R.string.settings_permission_local_network, listOf(LocalNetworkPermission.PERMISSION)))
    }
    fun batteryAllowed(context: Context) =
        context.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(context.packageName) == true

    fun missingLabels(context: Context): List<Int> = buildList {
        runtimeGroups(context).filter { it.enabled() }.forEach { group ->
            if (group.permissions.any { context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }) add(group.label)
        }
        if (!batteryAllowed(context)) add(R.string.settings_ignore_battery_optimization)
        if (BrowserCarPlaySettings.mode(context) != BrowserCarPlaySettings.Mode.WIRELESS &&
            runCatching { CarPlayVpnService.prepare(context) != null }.getOrDefault(true)) add(R.string.onboarding_usb_vpn)
    }
}
