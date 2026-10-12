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
        val presentation = frame.captureNanos ?: return null
        // Source presentation times can be ahead of now; retain their sign but reject unrelated clock domains.
        if (presentation > now + 10_000_000_000L || presentation < now - 10_000_000_000L) return null
        val payload = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putDouble(presentation / 1e6).array()
        return WebVideoRecord(KIND, 0, 0, frame.sequence, frame.epoch, frame.timestampUs, payload)
    }
}
