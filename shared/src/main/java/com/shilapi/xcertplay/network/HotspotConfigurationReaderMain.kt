package com.shilapi.xcertplay.network

import android.os.IBinder
import android.os.Process
import kotlin.system.exitProcess

/** app_process entry point. Only reads IWifiManager; no hotspot writes or filesystem output. */
object HotspotConfigurationReaderMain {
    @JvmStatic fun main(args: Array<String>) {
        val record = runCatching {
            require(args.isEmpty() && Process.myUid() in setOf(0, 2000))
            val binder = Class.forName("android.os.ServiceManager")
                .getMethod("getService", String::class.java).invoke(null, "wifi") as IBinder
            val wifi = Class.forName("android.net.wifi.IWifiManager\$Stub")
                .getMethod("asInterface", IBinder::class.java).invoke(null, binder)
            val config = wifi.javaClass.getMethod("getSoftApConfiguration").invoke(wifi) ?: return@runCatching null
            val ssid = config.javaClass.getMethod("getSsid").invoke(config) as? String ?: return@runCatching null
            val password = config.javaClass.getMethod("getPassphrase").invoke(config) as? String
            HotspotConfigurationReader.format(ssid, password)
        }.getOrNull()
        if (record != null) println(record)
        exitProcess(if (record == null) 1 else 0)
    }
}
