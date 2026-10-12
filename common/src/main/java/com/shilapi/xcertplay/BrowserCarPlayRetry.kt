package com.shilapi.xcertplay

/** A Bluetooth arrival gets one short retry burst; repeated ACL events cannot keep resetting it. */
internal class BrowserCarPlayRetry {
    private var burst = false
    private var attempt = 0
    fun bluetoothConnected() {
        if (burst) return
        burst = true
        attempt = 0
    }
    fun sessionConnected() { burst = false; attempt = 0 }
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
