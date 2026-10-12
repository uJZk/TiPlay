package com.shilapi.xcertplay

import android.content.Context
import com.shilapi.xcertplay.network.RootShell
import java.util.concurrent.atomic.AtomicBoolean

/** Only the already selected Root mode is used. A denied setup falls back to the system dialog. */
internal object PrivilegedUsbAutoConfirm {
    private val running = AtomicBoolean(false)
    private val attempted = AtomicBoolean(false)
    fun prepare(context: Context) {
        if (HotspotExtraAddressSettings.method(context) != HotspotAddressMethod.ROOT ||
            UsbAutoConfirmService.isEnabled(context) || !attempted.compareAndSet(false, true) || !running.compareAndSet(false, true)) return
        val app = context.applicationContext
        Thread({
            try {
                synchronized(UsbPermissionSetup.accessibilityLock) { RootShell.enableUsbAutoConfirm(app.packageName) }
            } finally { running.set(false) }
        }, "tiplay-usb-root-setup").start()
    }
}
