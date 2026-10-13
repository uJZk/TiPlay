package com.shilapi.xcertplay.airplay

import org.junit.Assert.*
import org.junit.Test
import java.math.BigInteger

class RtpAudioTimelineTest {
    @Test fun continuousPlaybackKeepsElapsedTimePastHalfAndCompleteWraps() {
        val clock = RtpAudioTimeline(48000)
        val startNanos = 1_000_000_000L
        clock.anchor(0, startNanos)
        clock.unwrap(0)
        var extended = 0L
        // Each step is unambiguous, while accumulated elapsed time exceeds a full RTP turn.
        repeat(10) {
            extended += 1_000_000_000L
            assertEquals(extended, clock.unwrap(extended.toInt()))
            val expected = startNanos + BigInteger.valueOf(extended).multiply(BigInteger.valueOf(1_000_000_000L))
                .divide(BigInteger.valueOf(48000L)).toLong()
            assertEquals(expected, clock.presentation(extended))
        }
    }

    @Test fun anAnchorAfterACompleteWrapUsesTheCurrentEraAndLateSamplesRemainEarlier() {
        val clock = RtpAudioTimeline(48000)
        clock.anchor(0, 0L)
        clock.unwrap(0)
        for (sample in listOf(1_000_000_000L, 2_000_000_000L, 3_000_000_000L, 4_000_000_000L)) {
            clock.unwrap(sample.toInt())
        }
        val current = 0x1_0000_0000L + 480L
        assertEquals(current, clock.unwrap(current.toInt()))
        clock.anchor(current.toInt(), 100_000_000_000L)
        assertEquals(100_000_000_000L, clock.presentation(current))
        assertEquals(100_010_000_000L, clock.presentation(clock.unwrap((current + 480).toInt())))
        assertEquals(99_990_000_000L, clock.presentation(clock.unwrap((current - 480).toInt())))
    }

    @Test fun theFirstSampleCanBeBeforeAnAnchorAcrossTheWrapBoundary() {
        val clock = RtpAudioTimeline(48000)
        clock.anchor(480, 1_000_000_000L)
        val late = clock.unwrap(-480)
        assertEquals(-480L, late)
        assertEquals(980_000_000L, clock.presentation(late))
    }

    @Test fun sourceSamplesRemainContinuousAcrossWrapAndLateSamplesKeepTheirOwnTime() {
        val clock = RtpAudioTimeline(48000)
        assertNull(clock.presentation(1))
        clock.anchor(-480, 1_000_000_000L)
        assertEquals(0xffff_fe20L, clock.unwrap(-480))
        val afterWrap = clock.unwrap(480)
        assertEquals(0x1_0000_01e0L, afterWrap)
        assertEquals(1_020_000_000L, clock.presentation(afterWrap))
        assertEquals(1_010_000_000L, clock.presentation(clock.unwrap(0)))
    }

    @Test fun decodeOrderHandlesDuplicatesWrapAndAdvancesAnIdleTail() {
        var now = 0L
        val order = AudioPacketOrder<String> { now }
        assertEquals(listOf("a"), order.offer(65534, "a"))
        assertTrue(order.offer(0, "c").isEmpty())
        assertTrue(order.offer(0, "duplicate").isEmpty())
        assertEquals(listOf("b", "c"), order.offer(65535, "b"))
        assertTrue(order.offer(2, "tail").isEmpty())
        now = 30_000_000L
        assertEquals(listOf("tail"), order.drain())
        assertTrue(order.offer(1, "late").isEmpty())
    }
}
