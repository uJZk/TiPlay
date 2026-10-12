package com.shilapi.xcertplay.transport

import android.content.Context
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.IBinder
import com.shilapi.xcertplay.network.ShizukuSystem
import rikka.shizuku.ShizukuBinderWrapper
import rikka.shizuku.SystemServiceHelper

/** Best effort using an existing Shizuku grant; a ROM denial leaves the normal USB dialog intact. */
internal object PrivilegedUsbPermission {
    fun grant(context: Context, manager: UsbManager, device: UsbDevice): Boolean = runCatching {
        if (context.getSharedPreferences("tiplay_hotspot_address", Context.MODE_PRIVATE)
                .getString("hotspot_address_method", "NORMAL") != "SHIZUKU") return@runCatching false
        if (!ShizukuSystem.running() || !ShizukuSystem.permissionGranted()) return@runCatching false
        val binder = SystemServiceHelper.getSystemService("usb") ?: return@runCatching false
        val stub = Class.forName("android.hardware.usb.IUsbManager\$Stub")
        val service = stub.getMethod("asInterface", IBinder::class.java).invoke(null, ShizukuBinderWrapper(binder))
        service.javaClass.getMethod("grantDevicePermission", UsbDevice::class.java, Int::class.javaPrimitiveType)
            .invoke(service, device, context.applicationInfo.uid)
        manager.hasPermission(device)
    }.getOrDefault(false)
}
