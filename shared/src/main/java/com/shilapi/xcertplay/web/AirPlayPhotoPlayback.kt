package com.shilapi.xcertplay.web

import java.io.Closeable
import java.io.ByteArrayInputStream

/** A still image retains its original encoding; browsers decode it once and fit their current viewport. */
class AirPlayPhotoPlayback(bytes: ByteArray) : Closeable {
    private var image: ByteArray? = bytes.copyOf()
    val contentType = if (bytes.size >= 2 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte())
        "image/jpeg" else "image/png"

    init { require(bytes.size in 4..16 * 1024 * 1024) }

    @Synchronized fun bytes(): ByteArray? = image?.copyOf()
    /** Streams one retained encoding without copying it per browser or keeping it after the cast ends. */
    @Synchronized fun open(range: String?): AirPlayVideoProxy.Resource? {
        val data = image ?: return null
        if (range == null) return AirPlayVideoProxy.Resource(200, contentType,
            listOf("Content-Length" to data.size.toString(), "Accept-Ranges" to "bytes", "Cache-Control" to "no-store"),
            ByteArrayInputStream(data))
        if (!range.matches(Regex("bytes=(?:[0-9]{1,18}-[0-9]{0,18}|-[0-9]{1,18})"))) return unsatisfied(data.size)
        val parts = range.removePrefix("bytes=").split('-')
        val start = if (parts[0].isEmpty()) (data.size.toLong() - parts[1].toLong()).coerceAtLeast(0) else parts[0].toLong()
        val end = if (parts[0].isEmpty() || parts[1].isEmpty()) data.size.toLong() - 1
            else parts[1].toLong().coerceAtMost(data.size.toLong() - 1)
        if (start > end || start >= data.size) return unsatisfied(data.size)
        val length = (end - start + 1).toInt()
        return AirPlayVideoProxy.Resource(206, contentType, listOf("Content-Length" to length.toString(),
            "Content-Range" to "bytes $start-$end/${data.size}", "Accept-Ranges" to "bytes", "Cache-Control" to "no-store"),
            ByteArrayInputStream(data, start.toInt(), length))
    }

    private fun unsatisfied(size: Int) = AirPlayVideoProxy.Resource(416, contentType,
        listOf("Content-Range" to "bytes */$size"), ByteArrayInputStream(ByteArray(0)))
    @Synchronized fun source(): Map<String, Any?> = if (image == null) emptyMap() else mapOf("resource" to "photo")
    @Synchronized override fun close() { image = null }
}
