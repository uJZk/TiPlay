/* SPDX-License-Identifier: GPL-3.0-only */
package com.shilapi.xcertplay.media

import com.shilapi.xcertplay.airplay.AudioCodecKind
import com.shilapi.xcertplay.airplay.AudioFormat
import com.shilapi.xcertplay.airplay.RtpAudioTimeline
import java.util.ArrayDeque
import java.util.TreeMap

internal data class IncomingAudioPacket(val bytes: ByteArray, val sample: Int, val arrivedNanos: Long)
internal data class SpeechPacket(val bytes: ByteArray, val sample: Long, val arrivedNanos: Long, val durationNanos: Long)

/** A live speech budget, never the buffered-music queue. Arrival time survives ordering and decoding. */
internal class SpeechAudioQueue(private val format: AudioFormat, private val timeline: RtpAudioTimeline,
    private val now: () -> Long = System::nanoTime) {
    private val lock = Object()
    private val pending = ArrayDeque<SpeechPacket>()
    private var duration = 0L
    private var closed = false
    private var newestSample: Long? = null
    // Decoder leases are worker-owned. Missing/retired leases must never bless late codec output.
    private val decoding = TreeMap<Long, SpeechPacket>()

    fun offer(input: IncomingAudioPacket) = synchronized(lock) {
        if (closed) return@synchronized
        var bytes = input.bytes
        var sample = timeline.unwrap(input.sample)
        var nanos = durationNanos(bytes) ?: return@synchronized
        if (nanos > WINDOW_NANOS) {
            if (format.codec != AudioCodecKind.LPCM) return@synchronized
            val frameBytes = format.channels * 2
            val keep = (format.sampleRate.toLong() * WINDOW_NANOS / SECOND).toInt()
            val skip = (bytes.size - 12) / frameBytes - keep
            bytes = bytes.copyOfRange(0, 12) + bytes.copyOfRange(12 + skip * frameBytes, bytes.size)
            sample += skip.toLong() * format.rtpClockRate / format.sampleRate
            nanos = keep.toLong() * SECOND / format.sampleRate
        }
        if (newestSample?.let { sample <= it } == true) return@synchronized
        newestSample = sample
        val packet = SpeechPacket(bytes, sample, input.arrivedNanos, nanos)
        if (expired(packet)) return@synchronized
        pending.addLast(packet); duration += nanos
        while (pending.isNotEmpty() && (duration > WINDOW_NANOS || pending.size > 256 ||
                sourceSpanNanos() > WINDOW_NANOS || expired(pending.peekFirst()))) removeFirst()
        lock.notifyAll()
    }

    fun poll(timeoutMillis: Long): SpeechPacket? = synchronized(lock) {
        if (pending.isEmpty() && !closed) lock.wait(timeoutMillis)
        while (pending.isNotEmpty() && expired(pending.peekFirst())) removeFirst()
        if (closed || pending.isEmpty()) null else removeFirst()
    }

    fun close() = synchronized(lock) { closed = true; pending.clear(); duration = 0; lock.notifyAll() }

    fun deadline(packet: SpeechPacket, sample: Long = packet.sample): Long =
        timeline.presentation(sample)?.plus(LATE_NANOS) ?: (packet.arrivedNanos + WINDOW_NANOS +
            (sample - packet.sample) * SECOND / format.rtpClockRate)

    fun expired(packet: SpeechPacket): Boolean = deadline(packet) + packet.durationNanos <= now()

    fun submitted(packet: SpeechPacket) {
        decoding.entries.removeAll { expired(it.value) ||
            (packet.sample - it.key).toDouble() * SECOND / format.rtpClockRate > WINDOW_NANOS }
        decoding[packet.sample] = packet
        while (decoding.size > 256) decoding.pollFirstEntry()
    }

    fun outputLease(sample: Long): SpeechPacket? {
        val packet = decoding.floorEntry(sample)?.value ?: return null
        val offset = (sample - packet.sample).toDouble() * SECOND / format.rtpClockRate
        return packet.takeIf { offset < packet.durationNanos && !expired(it) }
    }

    private fun removeFirst(): SpeechPacket = pending.removeFirst().also { duration -= it.durationNanos }
    private fun sourceSpanNanos(): Double = if (pending.isEmpty()) 0.0 else
        (pending.peekLast().sample - pending.peekFirst().sample).toDouble() * SECOND / format.rtpClockRate + pending.peekLast().durationNanos

    private fun durationNanos(bytes: ByteArray): Long? {
        val length = bytes.size - 12
        if (length <= 0) return null
        return when (format.codec) {
            AudioCodecKind.LPCM -> if (length % (format.channels * 2) != 0) null else
                length.toLong() / (format.channels * 2) * SECOND / format.sampleRate
            AudioCodecKind.AAC_LC -> 1024L * SECOND / format.sampleRate
            AudioCodecKind.OPUS -> {
                // RFC 6716 §3: TOC config gives frame duration; packet code gives frame count.
                val toc = bytes[12].toInt() and 255
                val config = toc ushr 3
                val frameMicros = when {
                    config < 12 -> when (config and 3) { 0 -> 10000; 1 -> 20000; 2 -> 40000; else -> 60000 }
                    config < 16 -> if (config and 1 == 0) 10000 else 20000
                    else -> 2500 shl (config and 3)
                }
                val frames = when (toc and 3) {
                    0 -> 1
                    1, 2 -> 2
                    else -> if (length > 1) bytes[13].toInt() and 63 else 0
                }
                (frameMicros.toLong() * frames * 1000).takeIf { frames > 0 && it <= 120_000_000L }
            }
        }?.takeIf { it > 0 }
    }

    companion object {
        const val WINDOW_NANOS = 160_000_000L
        const val LATE_NANOS = 125_000_000L
        private const val SECOND = 1_000_000_000L
    }
}
