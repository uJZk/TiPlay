package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test

class AirPlayCastSubmissionsTest {
    @Test fun unknownSourceStillProducesAFrameWithoutInventingSourceTime() {
        val submissions = AirPlayCastSubmissions()
        val pts = submissions.submit(100_999, null)
        val frame = submissions.take(pts / 1000)
        assertNotNull(frame)
        assertNull(frame!!.sourceNanos)
        assertNull(submissions.take(pts / 1000))
    }

    @Test fun resetRejectsOldEncoderOutputEvenWhenClockAndSourceTimeRepeat() {
        val submissions = AirPlayCastSubmissions()
        val old = submissions.submit(100_999, 42_000)
        submissions.clear()
        val fresh = submissions.submit(100_999, 42_000)
        assertTrue(fresh > old)
        assertNull(submissions.take(old / 1000))
        assertEquals(42_000L, submissions.take(fresh / 1000)!!.sourceNanos)
    }

    @Test fun encoderBacklogStaysBounded() {
        val submissions = AirPlayCastSubmissions()
        repeat(121) { submissions.submit((it + 1) * 1000L, it.toLong()) }
        assertNull(submissions.take(1))
        assertEquals(120L, submissions.take(121)!!.sourceNanos)
    }
}
