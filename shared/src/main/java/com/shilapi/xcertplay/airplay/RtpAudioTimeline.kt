package com.shilapi.xcertplay.airplay

/** RTP samples are unsigned and wrap; a local anchor identifies when a sample is to play. */
class RtpAudioTimeline(private val sampleRate: Int) {
    private var lastSample: Long? = null
    private var anchorSample: Long? = null
    private var anchorNanos: Long? = null

    @Synchronized fun unwrap(sample: Int): Long {
        val raw = sample.toLong() and 0xffff_ffffL
        val previous = lastSample ?: anchorSample
        val extended = if (previous == null) raw else previous + delta(raw, previous)
        lastSample = extended
        return extended
    }

    @Synchronized fun anchor(sample: Int, presentationNanos: Long) {
        val raw = sample.toLong() and 0xffff_ffffL
        anchorSample = lastSample?.let { it + delta(raw, it) } ?: raw
        anchorNanos = presentationNanos
    }

    @Synchronized fun presentation(sample: Long): Long? {
        val origin = anchorSample ?: return null
        val nanos = anchorNanos ?: return null
        val distance = sample - origin
        // Keep complete elapsed wraps and avoid overflowing the product on multi-day sessions.
        return nanos + distance / sampleRate * 1_000_000_000L +
            distance % sampleRate * 1_000_000_000L / sampleRate
    }

    companion object {
        fun delta(sample: Long, origin: Long): Long = ((sample - origin + 0x8000_0000L) and 0xffff_ffffL) - 0x8000_0000L
    }
}

/** Decode order follows RTP sequence, independently of presentation timestamps. */
class AudioPacketOrder<T>(private val now: () -> Long = System::nanoTime) {
    private data class Pending<T>(val value: T, val arrived: Long)
    private val pending = mutableMapOf<Int, Pending<T>>()
    private var expected: Int? = null

    @Synchronized fun offer(sequence: Int, value: T): List<T> {
        val seq = sequence and 0xffff
        val next = expected ?: seq.also { expected = it }
        if (((seq - next) and 0xffff) >= 0x8000 || pending.containsKey(seq)) return emptyList()
        pending[seq] = Pending(value, now())
        return drain()
    }

    @Synchronized fun drain(): List<T> {
        val ready = mutableListOf<T>()
        while (pending.isNotEmpty()) {
            val next = requireNotNull(expected)
            val packet = pending.remove(next)
            if (packet != null) {
                ready += packet.value
                expected = (next + 1) and 0xffff
            } else {
                if (pending.size < 4 && now() - pending.values.minOf { it.arrived } < 30_000_000L) break
                expected = pending.keys.minByOrNull { (it - next) and 0xffff }
            }
        }
        return ready
    }
}
