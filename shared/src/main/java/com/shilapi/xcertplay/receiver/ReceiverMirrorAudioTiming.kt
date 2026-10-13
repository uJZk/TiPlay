package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AudioPacketOrder
import com.shilapi.xcertplay.airplay.RtpAudioTimeline
import java.math.BigInteger

/** Legacy RAOP sync pairs packet[4..7] with NTP[8..15]; next-RTP at 16 includes sender latency. */
internal class ReceiverMirrorAudioTiming(
    sampleRate: Int,
    private val mapNtp: (BigInteger) -> Long?,
    now: () -> Long = System::nanoTime,
) {
    data class Packet(val payload: ByteArray, val sample: Long, val presentationNanos: Long?)
    private data class Pending(val payload: ByteArray, val sample: Int)
    private val timeline = RtpAudioTimeline(sampleRate)
    private val order = AudioPacketOrder<Pending>(now)
    private var anchor: Pair<Int, BigInteger>? = null
    private var lastAnchorNtp: BigInteger? = null

    @Synchronized fun sync(packet: ByteArray) {
        if (packet.size < 20 || packet[0].toInt() and 0xc0 != 0x80 || packet[1].toInt() and 0x7f != 84) return
        val ntp = BigInteger(1, packet.copyOfRange(8, 16))
        if (ntp.signum() <= 0 || lastAnchorNtp?.let { ntp <= it } == true) return
        anchor = read32(packet, 4) to ntp
        lastAnchorNtp = ntp
    }

    @Synchronized fun offer(packet: ByteArray, payload: ByteArray): List<Packet> {
        val sequence = ((packet[2].toInt() and 255) shl 8) or (packet[3].toInt() and 255)
        return map(order.offer(sequence, Pending(payload, read32(packet, 4))))
    }

    @Synchronized fun drain(): List<Packet> = map(order.drain())

    private fun map(packets: List<Pending>): List<Packet> {
        val mapped = anchor?.let { (sample, ntp) -> mapNtp(ntp)?.also { timeline.anchor(sample, it) } }
        return packets.map {
            val sample = timeline.unwrap(it.sample)
            Packet(it.payload, sample, if (mapped == null) null else timeline.presentation(sample))
        }
    }

    private fun read32(packet: ByteArray, offset: Int): Int =
        (0..3).fold(0) { value, i -> (value shl 8) or (packet[offset + i].toInt() and 255) }
}
