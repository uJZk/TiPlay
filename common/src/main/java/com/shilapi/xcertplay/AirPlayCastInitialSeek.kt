package com.shilapi.xcertplay

import com.shilapi.xcertplay.receiver.ReceiverPlay

/** Apply absolute resume positions before loading, and never replay an already applied iPhone seek. */
internal class AirPlayCastInitialSeek {
    private var appliedMillis: Long? = null

    fun preparationMillis(item: ReceiverPlay, requestedSeconds: Double?): Long {
        val position = millis(requestedSeconds ?: if (item.fraction) 0.0 else item.start)
        appliedMillis = position
        return position
    }

    fun afterReadyMillis(item: ReceiverPlay, durationMillis: Long, requestedSeconds: Double?): Long? {
        val seconds = requestedSeconds ?: if (item.fraction && durationMillis > 0) {
            item.start.coerceAtMost(1.0) * durationMillis / 1000.0
        } else if (!item.fraction) item.start else 0.0
        val position = millis(seconds)
        if (position == appliedMillis) return null
        appliedMillis = position
        return position
    }

    fun applied(seconds: Double) { appliedMillis = millis(seconds) }
    fun reset() { appliedMillis = null }

    private fun millis(seconds: Double): Long = (seconds * 1000).toLong().coerceAtLeast(0)
}
