package com.shilapi.xcertplay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.ContextCompat

/** Applies saved browser settings without changing the page the driver is using. */
internal object BrowserSettingsChanges {
    private const val ACTION = "com.ujzk.tiplay.BROWSER_SETTINGS_CHANGED"

    fun apply(context: Context) {
        context.sendBroadcast(Intent(ACTION).setPackage(context.packageName))
    }

    fun listen(context: Context, changed: () -> Unit): AutoCloseable {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) { changed() }
        }
        ContextCompat.registerReceiver(context, receiver, IntentFilter(ACTION), ContextCompat.RECEIVER_NOT_EXPORTED)
        return AutoCloseable { context.unregisterReceiver(receiver) }
    }
}
