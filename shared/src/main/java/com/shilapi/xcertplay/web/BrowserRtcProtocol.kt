package com.shilapi.xcertplay.web

import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Application framing above reliable, ordered SCTP. A record remains in its original decode order. */
internal object BrowserRtcProtocol {
    const val NAME = "webrtc-datachannel-v1"
    const val MAGIC = 0x31524454 // TDR1, little endian
    const val HEADER = 24
    const val MESSAGE_BYTES = 16 * 1024
    const val VIDEO_WINDOW = 16 * 1024 * 1024
    const val AUDIO_WINDOW = 2 * 1024 * 1024

    fun unsignedInt(value: Any?): Int? = (value as? Number)?.toDouble()?.takeIf {
        it.isFinite() && it >= 0 && it <= 0xffff_ffffL.toDouble() && it == it.toLong().toDouble()
    }?.toLong()?.toInt()

    fun fragment(epoch: Int, sequence: Int, record: ByteArray, offset: Int): ByteBuffer =
        fragment(epoch, sequence, BrowserRtcRecord(listOf(record)), offset)

    fun fragment(epoch: Int, sequence: Int, record: BrowserRtcRecord, offset: Int): ByteBuffer {
        require(epoch > 0 && offset in 0 until record.size)
        val size = minOf(MESSAGE_BYTES - HEADER, record.size - offset)
        return ByteBuffer.allocate(HEADER + size).order(ByteOrder.LITTLE_ENDIAN)
            .putInt(MAGIC).putInt(epoch).putInt(sequence).putInt(record.size).putInt(offset).putInt(size)
            .also { record.copyTo(it, offset, size) }.apply { flip() }
    }
}

/** Scatter source: each SCTP fragment copies directly from the canonical AU and parameter sets. */
internal class BrowserRtcRecord(private val parts: List<ByteArray>) {
    val size = parts.sumOf { it.size }
    fun copyTo(target: ByteBuffer, offset: Int, length: Int) {
        var skip = offset
        var remaining = length
        for (part in parts) {
            if (skip >= part.size) { skip -= part.size; continue }
            val count = minOf(remaining, part.size - skip)
            target.put(part, skip, count)
            remaining -= count; skip = 0
            if (remaining == 0) break
        }
        check(remaining == 0)
    }
    companion object {
        fun video(record: WebVideoRecord): BrowserRtcRecord {
            val header = ByteArray(WebVideoRecords.HEADER_SIZE).also { WebVideoRecords.writeHeader(record, it) }
            return BrowserRtcRecord(listOfNotNull(header, record.prefix, record.payload))
        }
    }
}

/** FIFO consumption credit, independent of libwebrtc's local bufferedAmount. Caller synchronizes access. */
internal class BrowserRtcCredit(private val maxBytes: Int) {
    private data class Pending(val sequence: Int, val bytes: Int, val since: Long)
    private val pending = ArrayDeque<Pending>()
    var bytes = 0; private set
    var reservedBytes = 0L; private set
    var consumedBytes = 0L; private set
    private var lastProgressNanos = 0L
    fun canSend(size: Int) = size in 1..maxBytes && bytes <= maxBytes - size
    fun sent(sequence: Int, size: Int, now: Long) {
        check(canSend(size))
        if (pending.isEmpty()) lastProgressNanos = now
        pending.addLast(Pending(sequence, size, now))
        bytes += size
        reservedBytes += size
    }
    fun acknowledge(sequence: Int, size: Int, now: Long = System.nanoTime()): Boolean {
        val first = pending.firstOrNull() ?: return false
        if (first.sequence != sequence || first.bytes != size) return false
        pending.removeFirst()
        bytes -= size
        consumedBytes += size
        lastProgressNanos = now
        return true
    }
    fun oldestAgeMillis(now: Long): Long = pending.firstOrNull()?.let { (now - it.since) / 1_000_000 } ?: 0L
    fun noProgressMillis(now: Long): Long = if (pending.isEmpty()) 0L else (now - lastProgressNanos) / 1_000_000
}
