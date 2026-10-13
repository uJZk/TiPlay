package com.shilapi.xcertplay

/** Separates encoder transport identity from optional source timing, including timeline resets. */
internal class AirPlayCastSubmissions {
    data class Frame(val sourceNanos: Long?)
    private val pending = linkedMapOf<Long, Frame>()
    private var lastUs = 0L

    @Synchronized fun submit(nowNanos: Long, sourceNanos: Long?): Long {
        val transportUs = maxOf(nowNanos / 1000, lastUs + 1)
        lastUs = transportUs
        pending[transportUs] = Frame(sourceNanos)
        while (pending.size > 120) pending.remove(pending.keys.first())
        return transportUs * 1000
    }

    @Synchronized fun take(encoderUs: Long): Frame? = pending.remove(encoderUs)
    @Synchronized fun peek(encoderUs: Long): Frame? = pending[encoderUs]
    @Synchronized fun clear() = pending.clear()
}
