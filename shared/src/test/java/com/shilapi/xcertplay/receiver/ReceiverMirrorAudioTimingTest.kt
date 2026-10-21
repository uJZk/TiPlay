package com.shilapi.xcertplay.receiver

import java.math.BigInteger
import java.nio.ByteBuffer
import org.junit.Assert.*
import org.junit.Test

class ReceiverMirrorAudioTimingTest {
    private fun audio(seq: Int, sample: Int): ByteArray = ByteBuffer.allocate(12)
        .put(0x80.toByte()).put(0x60).putShort(seq.toShort()).putInt(sample).putInt(0).array()

    private fun sync(sample: Int, ntp: Long, nextSample: Int): ByteArray = ByteBuffer.allocate(20)
        .put(0x80.toByte()).put(0xd4.toByte()).putShort(4).putInt(sample).putLong(ntp).putInt(nextSample).array()

    private fun offer(clock: ReceiverMirrorAudioTiming, seq: Int, sample: Int, payload: ByteArray): List<ReceiverMirrorAudioTiming.Packet> {
        val wire = audio(seq, sample) + payload
        val decoded = requireNotNull(ReceiverMirrorAudioPacket.decrypt(wire, ByteArray(16), ByteArray(16)))
        return clock.offer(wire, decoded)
    }

    @Test fun nineteenNoDataUnitsAdvanceSourceTimeWithoutRetransmissionOrExtraWait() {
        var now = 0L
        val clock = ReceiverMirrorAudioTiming(44100, { 1_000_000_000L }, { now })
        clock.sync(sync(0, 9, 9600))
        val noData = byteArrayOf(0, 0x68, 0x34, 0)
        val delivered = mutableListOf<ReceiverMirrorAudioTiming.Packet>()
        delivered += offer(clock, 100, 0, byteArrayOf(1))
        for (index in 1..19) {
            now = index * 480L * 1_000_000_000L / 44100
            val packet = offer(clock, 100 + index, index * 480, noData).single()
            assertArrayEquals(noData, packet.payload)
            delivered += packet
            // The sender's redundant copies neither replay silence nor invent a gap.
            repeat(2) { assertTrue(offer(clock, 100 + index, index * 480, noData).isEmpty()) }
            assertTrue(clock.retransmissionRequests().isEmpty())
        }
        now = 9600L * 1_000_000_000L / 44100
        delivered += offer(clock, 120, 9600, byteArrayOf(2)).single()
        assertEquals((0..20).map { it * 480L }, delivered.map { it.sample })
        for (packet in delivered) {
            assertEquals(1_000_000_000L + packet.sample * 1_000_000_000L / 44100, packet.presentationNanos)
            assertFalse(packet.discontinuity)
        }
        assertTrue(clock.drain().isEmpty())
        assertTrue(clock.retransmissionRequests().isEmpty())
    }

    @Test fun recoveredNoDataClosesRealReorderGapAcrossSequenceAndSampleWrap() {
        val clock = ReceiverMirrorAudioTiming(44100, { null }, { 0L })
        offer(clock, 65534, -480, byteArrayOf(1))
        assertTrue(offer(clock, 0, 480, byteArrayOf(3)).isEmpty())
        assertTrue(offer(clock, 0, 480, byteArrayOf(3)).isEmpty())
        val request = clock.retransmissionRequests().single()
        assertEquals(65535, ByteBuffer.wrap(request).getShort(4).toInt() and 65535)
        assertEquals(1, ByteBuffer.wrap(request).getShort(6).toInt())
        val noData = byteArrayOf(0, 0x68, 0x34, 0)
        val original = audio(65535, 0) + noData
        val recovered = requireNotNull(clock.control(byteArrayOf(0x80.toByte(), 0xd6.toByte(), 0, 0) + original))
        val decoded = requireNotNull(ReceiverMirrorAudioPacket.decrypt(recovered, ByteArray(16), ByteArray(16)))
        val result = clock.offer(recovered, decoded)
        assertEquals(listOf(0x1_0000_0000L, 0x1_0000_01e0L), result.map { it.sample })
        assertArrayEquals(noData, result.first().payload)
        assertArrayEquals(byteArrayOf(3), result.last().payload)
        assertTrue(offer(clock, 65535, 0, noData).isEmpty())
        assertTrue(clock.retransmissionRequests().isEmpty())
    }

    @Test fun continuousNoDataDoesNotBecomeALongInterruptionOrRetireItsClockAnchor() {
        var now = 0L
        val clock = ReceiverMirrorAudioTiming(44100, { 1_000_000_000L }, { now })
        clock.sync(sync(0, 9, 9600))
        offer(clock, 1, 0, byteArrayOf(1))
        val noData = byteArrayOf(0, 0x68, 0x34, 0)
        for (index in 1..250) {
            now = index * 480L * 1_000_000_000L / 44100
            val packet = offer(clock, index + 1, index * 480, noData).single()
            assertFalse(packet.discontinuity)
            assertNotNull(packet.presentationNanos)
        }
        assertTrue(now > 2_000_000_000L)
        now = 251L * 480L * 1_000_000_000L / 44100
        val resumed = offer(clock, 252, 251 * 480, byteArrayOf(2)).single()
        assertFalse(resumed.discontinuity)
        assertEquals(1_000_000_000L + now, resumed.presentationNanos)
        assertTrue(clock.retransmissionRequests().isEmpty())
    }

    @Test fun flushRetiresQueuedNoDataAndRejectsItsLateCopiesWithoutLosingNewSilence() {
        val clock = ReceiverMirrorAudioTiming(44100, { 99L }, { 0L })
        val noData = byteArrayOf(0, 0x68, 0x34, 0)
        clock.sync(sync(0, 9, 7497))
        offer(clock, 1, 0, byteArrayOf(1))
        assertTrue(offer(clock, 3, 960, noData).isEmpty())
        clock.flush(3, 960)
        assertTrue(clock.drain().isEmpty())
        assertTrue(offer(clock, 3, 960, noData).isEmpty())
        assertTrue(offer(clock, 2, 480, noData).isEmpty())
        val resumed = offer(clock, 4, 1440, noData).single()
        assertArrayEquals(noData, resumed.payload)
        assertEquals(1440L, resumed.sample)
        assertNull(resumed.presentationNanos)
        assertEquals(1920L, offer(clock, 5, 1920, byteArrayOf(2)).single().sample)
        assertTrue(clock.retransmissionRequests().isEmpty())
    }

    @Test fun syncPairsThePresentationSampleWithFullNtpAndRejectsOldAnchors() {
        val clock = ReceiverMirrorAudioTiming(44100, { if (it == BigInteger.valueOf(9)) 2_000_000_000L else null })
        clock.sync(sync(-441, 9, 7056))
        clock.sync(sync(123, 8, 8000))
        val first = clock.offer(audio(65535, -441), byteArrayOf(1)).single()
        val wrapped = clock.offer(audio(0, 0), byteArrayOf(2)).single()
        assertEquals(2_000_000_000L, first.presentationNanos)
        assertEquals(2_010_000_000L, wrapped.presentationNanos)
        assertEquals(0x1_0000_0000L, wrapped.sample)
    }

    @Test fun unusableTimingNeverCreatesAnArrivalBasedClockAndIdleTailIsReleased() {
        var now = 0L
        val clock = ReceiverMirrorAudioTiming(44100, { null }, { now })
        clock.sync(sync(0, 9, 7497))
        assertNull(clock.offer(audio(1, 0), byteArrayOf(1)).single().presentationNanos)
        assertTrue(clock.offer(audio(3, 960), byteArrayOf(3)).isEmpty())
        now = 91_000_000
        assertNull(clock.drain().single().presentationNanos)
    }
    @Test fun boundedRetransmissionsRecoverMissingPacketsAndValidateReplyEnvelope() {
        var now = 0L
        val clock = ReceiverMirrorAudioTiming(44100, { null }, { now })
        clock.offer(audio(65534, 0), byteArrayOf(1))
        assertTrue(clock.offer(audio(0, 960), byteArrayOf(3)).isEmpty())
        val request = clock.retransmissionRequests().single()
        assertEquals(0x55, request[1].toInt() and 0x7f)
        assertEquals(65535, java.nio.ByteBuffer.wrap(request).getShort(4).toInt() and 65535)
        assertEquals(1, java.nio.ByteBuffer.wrap(request).getShort(6).toInt())
        assertTrue(clock.retransmissionRequests().isEmpty())
        now = 10_000_000; assertEquals(1, clock.retransmissionRequests().size)
        now = 20_000_000; assertEquals(1, clock.retransmissionRequests().size)
        now = 30_000_000; assertTrue(clock.retransmissionRequests().isEmpty())
        val original = audio(65535, 480)
        val reply = byteArrayOf(0x80.toByte(), 0xd6.toByte(), 0, 0) + original
        assertArrayEquals(original, clock.control(reply))
        assertNull(clock.control(reply.copyOf(15)))
        assertEquals(listOf(2, 3), clock.offer(requireNotNull(clock.control(reply)), byteArrayOf(2)).map { it.payload[0].toInt() })
    }

    @Test fun flushDropsOldQueueAnchorsAndDelayedPacketsAtTheSpecifiedBoundary() {
        val clock = ReceiverMirrorAudioTiming(44100, { 99L })
        clock.sync(sync(0, 9, 7497))
        clock.offer(audio(1, 0), byteArrayOf(1))
        clock.offer(audio(3, 960), byteArrayOf(3))
        clock.flush(3, 960)
        assertTrue(clock.drain().isEmpty())
        assertTrue(clock.offer(audio(3, 960), byteArrayOf(3)).isEmpty())
        assertNull(clock.offer(audio(4, 1440), byteArrayOf(4)).single().presentationNanos)
        assertTrue(clock.retransmissionRequests().isEmpty())
    }

    @Test fun timestampDiscontinuityRetiresTheClockButLatePacketsNeverResetDecodeOrder() {
        var now = 0L
        val clock = ReceiverMirrorAudioTiming(44100, { 2_000_000_000L }, { now })
        clock.sync(sync(4_410_000, 9, 4_417_497))
        assertNotNull(clock.offer(audio(10, 4_410_000), byteArrayOf(1)).single().presentationNanos)
        now = 3_000_000_000L
        assertTrue(clock.offer(audio(9, 0), byteArrayOf(0)).isEmpty())
        val resumed = clock.offer(audio(11, 0), byteArrayOf(2)).single()
        assertTrue(resumed.discontinuity)
        assertNull(resumed.presentationNanos)
        assertTrue(clock.offer(audio(10, 4_410_000), byteArrayOf(1)).isEmpty())
    }

}
