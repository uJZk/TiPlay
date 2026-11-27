package com.shilapi.xcertplay

import android.annotation.SuppressLint
import android.content.Context
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Process
import android.os.SystemClock
import android.os.Build
import android.os.PowerManager
import android.util.Log

/**
 * Phone + browser mode (integration E3): while a phone/browser transport session is active, the CPU stays awake and Wi-Fi stays in its
 * low-latency mode (high-performance before Android 10), so the car's browser keeps getting video and the iPhone's
 * session keeps running with the phone's screen off. Head-unit mode holds neither lock.
 *
 * Both locks are not reference counted, so [hold] and [release] are idempotent; every stop path of the service
 * calls [release].
 */
internal class PhoneBrowserLocks(private val context: Context) {
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    val held: Boolean get() = wakeLock?.isHeld == true || wifiLock?.isHeld == true

    /** Hold both transport locks during an active session and release them on idle. */
    fun update(phoneBrowser: Boolean) {
        if (phoneBrowser) hold() else release()
    }

    // The session has no fixed length; ACTION_STOP, onTaskRemoved and onDestroy release the lock.
    @SuppressLint("WakelockTimeout")
    fun hold() {
        val previouslyHeld = held
        try {
            if (wakeLock?.isHeld != true) {
                wakeLock = context.getSystemService(PowerManager::class.java)
                    ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
                    ?.apply { setReferenceCounted(false); acquire() }
            }
            if (wifiLock?.isHeld != true) {
                val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                wifiLock = wifi?.createWifiLock(wifiMode(Build.VERSION.SDK_INT), WIFI_LOCK_TAG)
                    ?.apply { setReferenceCounted(false); acquire() }
            }
        } catch (error: RuntimeException) {
            // A missing lock costs smoothness with the screen off, never the session.
            Log.w(TAG, "could not hold the phone + browser locks", error)
        }
        if (!previouslyHeld && held) logLockTransition("acquired")
    }

    private fun logLockTransition(event: String) {
        DiagnosticLogs.append(powerSample(context, "${context.javaClass.simpleName}-$event") +
            " cpuLock=${wakeLock?.isHeld == true} wifiLock=${wifiLock?.isHeld == true}")
    }

    fun release() {
        val previouslyHeld = held
        wakeLock?.let { lock -> runCatching { if (lock.isHeld) lock.release() } }
        wifiLock?.let { lock -> runCatching { if (lock.isHeld) lock.release() } }
        wakeLock = null
        wifiLock = null
        if (previouslyHeld) logLockTransition("released")
    }

    internal companion object {
        private const val TAG = "TiPlayLocks"
        private const val WAKE_LOCK_TAG = "TiPlay:browser-link"
        private const val WIFI_LOCK_TAG = "TiPlay:browser-link"

        /** Device battery counters and process CPU are sampled only on existing lifecycle/export events. */
        fun powerSample(context: Context, event: String): String = runCatching {
            val battery = context.getSystemService(BatteryManager::class.java)
            val charge = battery?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER)?.takeIf { it > 0 }
            val percent = battery?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.takeIf { it in 0..100 }
            val interactive = context.getSystemService(PowerManager::class.java)?.isInteractive
            "ANDROID_POWER event=$event pid=${Process.myPid()} elapsedMs=${SystemClock.elapsedRealtime()} " +
                "processCpuMs=${Process.getElapsedCpuTime()} deviceChargeUah=${charge ?: "unknown"} " +
                "devicePercent=${percent ?: "unknown"} charging=${battery?.isCharging} interactive=$interactive"
        }.getOrElse { "ANDROID_POWER event=$event unavailable=true" }

        /** Low latency from Android 10; high performance before it (deprecated later, but the only mode there). */
        @Suppress("DEPRECATION")
        fun wifiMode(sdk: Int): Int =
            if (sdk >= Build.VERSION_CODES.Q) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
    }
}
