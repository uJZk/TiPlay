package com.shilapi.xcertplay

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Toast
import com.shilapi.xcertplay.host.R

/** The user chooses the battery exemption in Android settings; TiPlay never requests it directly. */
internal object BrowserBatteryOptimizationSettings {
    fun add(activity: Activity, parent: LinearLayout) {
        parent.addView(Button(activity).apply {
            setText(R.string.settings_ignore_battery_optimization)
            setOnClickListener { open(activity) }
        }, LinearLayout.LayoutParams(-1, -2))
    }

    private fun open(activity: Activity) {
        try {
            activity.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        } catch (_: ActivityNotFoundException) {
            runCatching {
                activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:${activity.packageName}")))
            }.onFailure {
                Toast.makeText(activity, R.string.settings_battery_settings_unavailable, Toast.LENGTH_LONG).show()
            }
        }
    }
}
