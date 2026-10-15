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
