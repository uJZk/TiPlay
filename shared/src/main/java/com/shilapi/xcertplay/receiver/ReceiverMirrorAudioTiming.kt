package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.RtpAudioTimeline
import java.math.BigInteger
import java.nio.ByteBuffer

/** Bounded RAOP jitter/retransmission window; NTP anchors remain the source clock. */
internal class ReceiverMirrorAudioTiming(
    private val sampleRate: Int,
    private val mapNtp: (BigInteger) -> Long?,
    private val now: () -> Long = System::nanoTime,
) {
    data class Packet(val payload: ByteArray, val sample: Long, val presentationNanos: Long?, val discontinuity: Boolean = false)
    private data class Pending(val payload: ByteArray, val sample: Int, val arrived: Long)
    private var timeline = RtpAudioTimeline(sampleRate)
    private val pending = mutableMapOf<Int, Pending>()
    private var expected: Int? = null
    private var anchor: Pair<Int, BigInteger>? = null
    private var lastAnchorNtp: BigInteger? = null
    private var lastArrival: Long? = null
    private var lastRtp: Int? = null
    private var jitter = 0L
    private var requestSequence = 0
    private var requestAt = Long.MIN_VALUE
    private var requestAttempts = 0
    private var requestFor: Int? = null
    private var flushSample: Int? = null
    private var syncArrived = Long.MIN_VALUE
    private var discontinuity = false

    @Synchronized fun sync(packet: ByteArray) {
        if (packet.size < 20 || packet[0].toInt() and 0xc0 != 0x80 || packet[1].toInt() and 0x7f != 84) return
        val ntp = BigInteger(1, packet.copyOfRange(8, 16))
        if (ntp.signum() <= 0 || lastAnchorNtp?.let { ntp <= it } == true) return
        anchor = read32(packet, 4) to ntp
        lastAnchorNtp = ntp
        syncArrived = now()
    }

    /** Type 0x56 carries a four-byte resend header followed by the original RTP packet. */
    @Synchronized fun control(packet: ByteArray): ByteArray? {
        if (packet.size < 16 || packet[0].toInt() and 0xc0 != 0x80 || packet[1].toInt() and 0x7f != 0x56) return null
        return packet.copyOfRange(4, packet.size).takeIf { valid(it) }
    }

    @Synchronized fun offer(packet: ByteArray, payload: ByteArray): List<Packet> {
        if (!valid(packet) || payload.isEmpty()) return emptyList()
        val seq = ((packet[2].toInt() and 255) shl 8) or (packet[3].toInt() and 255)
        val sample = read32(packet, 4)
        val boundary = flushSample
        if (boundary != null && RtpAudioTimeline.delta(sample.toLong(), boundary.toLong()) <= 0) return emptyList()
        val next = expected ?: seq.also { expected = it }
        if (((seq - next) and 65535) >= 0x8000 || pending.containsKey(seq)) return emptyList()
        val arrived = now()
        val priorArrival = lastArrival
        val priorRtp = lastRtp
        // A stream resumed after a long interruption must not preserve an obsolete reorder head.
        val sampleJump = priorRtp?.let { kotlin.math.abs(RtpAudioTimeline.delta(sample.toLong(), it.toLong())) >= sampleRate * 2L } == true
        if (priorArrival != null && (arrived - priorArrival > 2_000_000_000L || sampleJump)) {
            pending.clear(); expected = null; timeline = RtpAudioTimeline(sampleRate)
            requestFor = null; requestAttempts = 0
            if (syncArrived <= priorArrival) { anchor = null; lastAnchorNtp = null }
            discontinuity = true
        }
        if (expected == null) expected = seq
        if (priorArrival != null && priorRtp != null) {
            val distance = RtpAudioTimeline.delta(sample.toLong(), priorRtp.toLong())
            if (distance > 0 && distance < sampleRate) {
                val variation = kotlin.math.abs((arrived - priorArrival) - distance * 1_000_000_000L / sampleRate)
                jitter += (variation.coerceAtMost(120_000_000L) - jitter) / 16
            }
        }
        lastArrival = arrived; lastRtp = sample
        pending[seq] = Pending(payload, sample, arrived)
        return drain()
    }

    @Synchronized fun drain(): List<Packet> {
        val result = mutableListOf<Pending>()
        while (pending.isNotEmpty()) {
            val next = requireNotNull(expected)
            val packet = pending.remove(next)
            if (packet != null) {
                result += packet; expected = (next + 1) and 65535
                requestFor = null; requestAttempts = 0
            } else {
                val wait = (30_000_000L + jitter * 4).coerceAtMost(90_000_000L)
                if (pending.size < 32 && now() - pending.values.minOf { it.arrived } < wait) break
                expected = pending.keys.minByOrNull { (it - next) and 65535 }
            }
        }
        val mapped = anchor?.let { (sample, ntp) -> mapNtp(ntp)?.also { timeline.anchor(sample, it) } }
        if (result.isNotEmpty()) flushSample = null // Sequence ordering now rejects pre-FLUSH replies; do not retain a half-wrap sample fence forever.
        return result.map {
            val sample = timeline.unwrap(it.sample)
            Packet(it.payload, sample, if (mapped == null) null else timeline.presentation(sample), discontinuity).also {
                discontinuity = false
            }
        }
    }

    /** At most three requests per gap, every 10 ms, each covering no more than 32 packets. */
    @Synchronized fun retransmissionRequests(): List<ByteArray> {
        val next = expected ?: return emptyList()
        val earliest = pending.keys.minByOrNull { (it - next) and 65535 } ?: return emptyList()
        val count = ((earliest - next) and 65535).coerceAtMost(32)
        if (count == 0) return emptyList()
        if (requestFor != next) { requestFor = next; requestAttempts = 0; requestAt = Long.MIN_VALUE }
        val time = now()
        if (requestAttempts >= 3 || (requestAt != Long.MIN_VALUE && time - requestAt < 10_000_000L)) return emptyList()
        requestAt = time; requestAttempts++
        return listOf(ByteBuffer.allocate(8).put(0x80.toByte()).put(0xd5.toByte())
            .putShort((requestSequence++ and 65535).toShort()).putShort(next.toShort()).putShort(count.toShort()).array())
    }

    /** FLUSH retires queued packets, previous NTP anchors and pre-boundary retransmissions. */
    @Synchronized fun flush(sequence: Int? = null, sample: Int? = null) {
        pending.clear(); expected = sequence?.let { (it + 1) and 65535 }
        timeline = RtpAudioTimeline(sampleRate); anchor = null; lastAnchorNtp = null
        lastArrival = null; lastRtp = null; jitter = 0; requestFor = null; requestAttempts = 0
        flushSample = sample
        syncArrived = Long.MIN_VALUE; discontinuity = false
    }

    private fun valid(packet: ByteArray) = packet.size >= 12 && packet[0].toInt() and 0xc0 == 0x80 &&
        packet[1].toInt() and 0x7f == 0x60
    private fun read32(packet: ByteArray, offset: Int): Int =
        (0..3).fold(0) { value, i -> (value shl 8) or (packet[offset + i].toInt() and 255) }
}
