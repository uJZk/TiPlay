package com.shilapi.xcertplay.web

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.ArrayDeque

/** Fragmentation is outside the unchanged video/audio record; lengths include no hidden padding. */
internal object BrowserRtcProtocol {
    const val HEADER_BYTES = 24
    const val MAX_MESSAGE_BYTES = 16 * 1024
    const val MAGIC = 0x31435254 // TRC1, little endian
    const val MAX_VIDEO_BYTES = WebVideoRecords.MAX_PAYLOAD + WebVideoRecords.HEADER_SIZE
    const val MAX_AUDIO_BYTES = 1024 * 1024

    fun fragment(session: Int, record: Int, bytes: ByteArray, offset: Int, limit: Int): ByteArray {
        require(session > 0 && record > 0 && offset in bytes.indices)
        require(limit in (HEADER_BYTES + 1)..MAX_MESSAGE_BYTES)
        val count = minOf(limit - HEADER_BYTES, bytes.size - offset)
        return ByteBuffer.allocate(HEADER_BYTES + count).order(ByteOrder.LITTLE_ENDIAN)
            .putInt(MAGIC).putInt(session).putInt(record).putInt(bytes.size).putInt(offset).putInt(count)
            .put(bytes, offset, count).array()
    }

    fun messageLimit(sdp: String): Int {
        val values = Regex("(?m)^a=max-message-size:(\\d+)\\r?$").findAll(sdp).toList()
        require(values.size <= 1) { "ambiguous message size" }
        val remote = values.singleOrNull()?.let {
            requireNotNull(it.groupValues[1].toLongOrNull()) { "invalid remote message size" }
        } ?: 65536L
        require(remote == 0L || remote > HEADER_BYTES) { "remote message size too small" }
        return if (remote == 0L) MAX_MESSAGE_BYTES else minOf(remote, MAX_MESSAGE_BYTES.toLong()).toInt()
    }
}

/** Receiver credit counts complete encoded records, separately from native SCTP buffered bytes. */
internal class BrowserRtcCredit(private val maximum: Long) {
    var window: Long = 0; private set
    var reserved: Long = 0; private set
    var consumed: Long = 0; private set
    private val boundaries = ArrayDeque<Pair<Long, Long>>()
    val oldestNanos: Long? get() = boundaries.peekFirst()?.second

    fun initialize(bytes: Long) {
        require(window == 0L && bytes in 1..maximum) { "invalid receiver credit" }
        window = bytes
    }

    fun reserve(bytes: Int, now: Long = System.nanoTime()): Boolean {
        require(bytes > 0)
        if (window == 0L || bytes > window - (reserved - consumed)) return false
        require(reserved <= 9_007_199_254_740_991L - bytes) { "credit sequence exhausted" }
        reserved += bytes
        boundaries.addLast(reserved to now)
        return true
    }

    fun acknowledge(bytes: Long) {
        require(bytes >= consumed && bytes <= reserved) { "invalid receiver acknowledgement" }
        if (bytes == consumed) return
        require(boundaries.any { it.first == bytes }) { "partial record acknowledgement" }
        while (boundaries.isNotEmpty() && boundaries.first.first <= bytes) boundaries.removeFirst()
        consumed = bytes
    }
}
