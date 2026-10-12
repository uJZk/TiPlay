package com.shilapi.xcertplay

import android.bluetooth.BluetoothDevice
import androidx.core.content.IntentCompat
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbManager
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat

/** USB changes are event driven; idle recovery runs every 16 seconds and holds no wake lock. */
internal class BrowserCarPlayWatch(context: Context, private val bluetoothConnected: () -> Unit, private val check: () -> Unit) : AutoCloseable {
    private val app = context.applicationContext
    private val handler = Handler(Looper.getMainLooper())
    private var closed = false
    private val tick = object : Runnable {
        override fun run() {
            if (closed) return
            check()
            handler.postDelayed(this, 16_000L)
        }
    }
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == BluetoothDevice.ACTION_ACL_CONNECTED) {
                val device = IntentCompat.getParcelableExtra(intent, BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                if (runCatching { device != null && device.address == DiPlayPreferences.phoneAddress(app) }.getOrDefault(false) != true) return
                bluetoothConnected()
            }
            handler.removeCallbacks(tick)
            // Allow the USB device list to settle after attach/detach.
            handler.postDelayed(tick, if (intent.action == BluetoothDevice.ACTION_ACL_CONNECTED) 1_000L else 500L)
        }
    }
    init {
        ContextCompat.registerReceiver(app, receiver, IntentFilter().apply {
            addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }, ContextCompat.RECEIVER_EXPORTED)
        handler.postDelayed(tick, 16_000L)
    }
    override fun close() {
        closed = true
        handler.removeCallbacks(tick)
        app.unregisterReceiver(receiver)
    }
}
