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
        now = 31_000_000
        assertNull(clock.drain().single().presentationNanos)
    }
}
