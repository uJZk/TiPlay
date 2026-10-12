package com.shilapi.xcertplay.airplay

/** Ordinary AirPlay wire timestamps stay local even when media mapping follows the peer clock. */
class NtpWireTimeline {
    private var localOffsetNanos: Long? = null

    @Synchronized
    fun offset(initialOffsetNanos: Long): Long =
        localOffsetNanos ?: initialOffsetNanos.also { localOffsetNanos = it }

    fun correction(sampledOffsetSeconds: Double, mediaOffsetNanos: Long): Double =
        sampledOffsetSeconds - (mediaOffsetNanos - offset(mediaOffsetNanos)).toDouble() / 1e9
}
