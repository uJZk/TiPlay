package com.shilapi.xcertplay

/** A working session or Bluetooth arrival earns one bounded recovery burst. */
internal class BrowserCarPlayRetry {
    private var burst = false
    private var attempt = 0
    fun bluetoothConnected() {
        if (burst) return
        burst = true
        attempt = 0
    }
    // A lost working session can recover while the selected iPhone is still reachable;
    // do not wait for another ACL edge after the Wi-Fi handoff released Bluetooth.
    fun sessionConnected() { burst = true; attempt = 0 }
    fun nextDelayMillis(): Long {
        if (!burst) return 16_000L
        return DELAYS[attempt.coerceAtMost(DELAYS.lastIndex)].also {
            if (attempt < DELAYS.lastIndex) attempt++
        }
    }
    companion object {
        private val DELAYS = longArrayOf(1_000, 2_000, 4_000, 8_000, 16_000)
    }
}
