package com.shilapi.xcertplay.media

import com.shilapi.xcertplay.airplay.*
import org.junit.Assert.*
import org.junit.Test

class SpeechAudioQueueTest {
    private var now = 0L
    private fun format(codec: AudioCodecKind = AudioCodecKind.OPUS, rate: Int = 48000, clock: Int = 16000) =
        AudioFormat(codec, rate, 1, 100, "telephony", clock)
    private fun packet(sample: Int, toc: Int = 19 shl 3, arrived: Long = now, count: Int? = null) =
        IncomingAudioPacket(ByteArray(12) + byteArrayOf(toc.toByte()) + (count?.let { byteArrayOf(it.toByte()) } ?: byteArrayOf()), sample, arrived)
    private fun queue(format: AudioFormat = format(), timeline: RtpAudioTimeline = RtpAudioTimeline(format.rtpClockRate)) =
        SpeechAudioQueue(format, timeline) { now }
    private fun all(q: SpeechAudioQueue) = generateSequence { q.poll(1) }.toList()

    @Test fun twentyMillisecondBurstKeepsOnlyTheNewest160Milliseconds() {
        val q = queue()
        repeat(20) { q.offer(packet(it * 320)) }
        val packets = all(q)
        assertEquals((12..19).map { it * 320L }, packets.map { it.sample })
        assertEquals(160_000_000L, packets.sumOf { it.durationNanos })
    }

    @Test fun shortOpusFramesAreNotLimitedToTheOld24PacketCount() {
        val q = queue()
        repeat(65) { q.offer(packet(it * 40, 16 shl 3)) } // CELT 2.5 ms
        val packets = all(q)
        assertEquals(64, packets.size)
        assertEquals(40L, packets.first().sample)
        assertEquals(160_000_000L, packets.sumOf { it.durationNanos })
    }

    @Test fun variableOpusDurationAndPacketFrameCountsUseTheRealBudget() {
        val q = queue()
        q.offer(packet(0, (3 shl 3) or 1)) // 2 × SILK 60 ms
        q.offer(packet(1920, 3 shl 3)) // 60 ms, evicts the entire old encoded access unit
        q.offer(packet(2880, (19 shl 3) or 3, count = 3)) // 3 × CELT 20 ms
        val packets = all(q)
        assertEquals(listOf(960L, 960L), packets.map { it.durationNanos * 16000 / 1_000_000_000L })
        assertEquals(listOf(1920L, 2880L), packets.map { it.sample })
    }

    @Test fun invalidOpusFrameCountCannotConsumeTheQueue() {
        val q = queue()
        q.offer(packet(0, (19 shl 3) or 3))
        q.offer(packet(320, (19 shl 3) or 3, count = 0))
        q.offer(packet(640, (19 shl 3) or 3, count = 63))
        assertNull(q.poll(1))
    }

    @Test fun sourceGapsBoundTheQueuedSpanEvenWhenPacketsAreTiny() {
        val q = queue()
        repeat(5) { q.offer(packet(it * 1600, 16 shl 3)) }
        assertEquals(listOf(4800L, 6400L), all(q).map { it.sample })
    }

    @Test fun aacUses1024DecodedFramesRatherThanRtpClockTicks() {
        val q = queue(format(AudioCodecKind.AAC_LC, rate = 48000, clock = 48000))
        repeat(10) { q.offer(packet(it * 1024)) }
        assertEquals((3..9).map { it * 1024L }, all(q).map { it.sample })
    }

    @Test fun largePcmPacketKeepsOnlyItsNewest160MillisecondTail() {
        val q = queue(format(AudioCodecKind.LPCM, rate = 8000, clock = 8000))
        q.offer(IncomingAudioPacket(ByteArray(12 + 1600 * 2), 0, 0))
        val packet = requireNotNull(q.poll(1))
        assertEquals(320L, packet.sample)
        assertEquals(12 + 1280 * 2, packet.bytes.size)
        assertEquals(160_000_000L, packet.durationNanos)
    }

    @Test fun orderingWaitDoesNotRefreshPacketAgeAndCloseRetiresTheQueue() {
        val q = queue()
        now = 200_000_000L
        q.offer(packet(0, arrived = 0))
        assertNull(q.poll(1))
        q.offer(packet(320))
        q.close()
        assertNull(q.poll(1000))
        q.offer(packet(640))
        assertNull(q.poll(1))
    }

    @Test fun anchoredDeadlineIsAbsoluteAndAStalledPacketDoesNotBecomeFreshAtPoll() {
        val timeline = RtpAudioTimeline(16000).apply { anchor(0, 1_000_000_000L) }
        val q = queue(timeline = timeline)
        q.offer(packet(0))
        now = 1_140_000_000L // Some tail remains; the first sample's deadline stays 1.125 s.
        val packet = requireNotNull(q.poll(1))
        assertEquals(1_125_000_000L, q.deadline(packet))
        q.submitted(packet)
        now = 1_146_000_000L
        assertNull(q.outputLease(packet.sample))
    }

    @Test fun codecOutputRequiresItsOriginalLiveLeaseAndCannotBorrowTheNewestPacket() {
        val q = queue()
        q.offer(packet(0)); val old = requireNotNull(q.poll(1)); q.submitted(old)
        now = 200_000_000L
        assertNull(q.outputLease(0))
        q.offer(packet(3200)); val fresh = requireNotNull(q.poll(1))
        assertNull(q.outputLease(fresh.sample))
        q.submitted(fresh)
        assertNull(q.outputLease(old.sample))
        assertEquals(fresh, q.outputLease(fresh.sample + 100))
        assertNull(q.outputLease(fresh.sample + 320))
    }

    @Test fun sequenceOrderedTimestampWrapStaysContinuousAndBackwardTimestampsAreRejected() {
        val q = queue()
        q.offer(packet(-320)); q.offer(packet(0)); q.offer(packet(-160)); q.offer(packet(320))
        assertEquals(listOf(0xffff_fec0L, 0x1_0000_0000L, 0x1_0000_0140L), all(q).map { it.sample })
        val restarted = queue()
        restarted.offer(packet(0))
        assertEquals(0L, restarted.poll(1)!!.sample)
    }
}
