package com.shilapi.xcertplay

import android.bluetooth.BluetoothAdapter
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.core.content.ContextCompat

/** Refresh visible settings independently of connection recovery or session activity. */
internal class BrowserSettingsStatusWatch(
    private val view: View,
    private val refresh: () -> Unit,
) : AutoCloseable, View.OnAttachStateChangeListener {
    private val handler = Handler(Looper.getMainLooper())
    private var registered = false
    private var closed = false
    private val tick = object : Runnable {
        override fun run() {
            if (!registered || closed) return
            if (view.isShown && view.windowVisibility == View.VISIBLE) refresh()
            handler.postDelayed(this, 1_000L)
        }
    }
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            // Re-read platform state; broadcast extras are never permission or connection evidence.
            handler.removeCallbacks(tick)
            handler.post(tick)
        }
    }
    init {
        view.addOnAttachStateChangeListener(this)
        if (view.isAttachedToWindow) onViewAttachedToWindow(view)
    }
    override fun onViewAttachedToWindow(v: View) {
        if (registered || closed) return
        ContextCompat.registerReceiver(view.context, receiver, IntentFilter().apply {
            addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
            addAction(WifiManager.WIFI_STATE_CHANGED_ACTION)
            addAction(WifiManager.NETWORK_STATE_CHANGED_ACTION)
            addAction("android.net.wifi.WIFI_AP_STATE_CHANGED")
        }, ContextCompat.RECEIVER_EXPORTED)
        registered = true
        handler.post(tick)
    }
    override fun onViewDetachedFromWindow(v: View) {
        handler.removeCallbacks(tick)
        if (registered) view.context.unregisterReceiver(receiver)
        registered = false
    }
    override fun close() {
        closed = true
        onViewDetachedFromWindow(view)
        view.removeOnAttachStateChangeListener(this)
    }
}
