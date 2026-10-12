package com.shilapi.xcertplay.airplay

/** Screen headers omit the NTP epoch that the timing-port timestamps include. */
internal object VideoMediaClockMapping {
    const val NTP_EPOCH_NANOS = 2_208_988_800_000_000_000L

    fun toMonotonic(senderNanos: Long, ntpOffsetNanos: Long): Long =
        senderNanos + NTP_EPOCH_NANOS - ntpOffsetNanos
}
