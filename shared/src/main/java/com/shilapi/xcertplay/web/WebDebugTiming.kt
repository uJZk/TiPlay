package com.shilapi.xcertplay.web

import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Optional v1 extension: old clients ignore kind 5; timestamps never change the encoded video payload. */
object WebDebugTiming {
    const val KIND = 5

    fun hello(now: Long): String = WebJson.write(mapOf(
        "app" to "TiPlay", "protocol" to 1, "clockMs" to now / 1e6,
    ))

    fun record(frame: WebVideoRecord, now: Long): WebVideoRecord? {
        if (frame.kind != WebVideoRecords.KIND_FRAME) return null
        val capture = frame.captureNanos ?: return null
        // A timestamp in another domain, in the future or from a stale stream must not produce plausible-looking data.
        if (capture > now || now - capture > 10_000_000_000L) return null
        val payload = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putDouble(capture / 1e6).array()
        return WebVideoRecord(KIND, 0, 0, frame.sequence, frame.epoch, frame.timestampUs, payload)
    }
}
