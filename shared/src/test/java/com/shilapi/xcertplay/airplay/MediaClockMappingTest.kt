package com.shilapi.xcertplay.airplay

import java.math.BigInteger
import org.junit.Assert.*
import org.junit.Test

class MediaClockMappingTest {
    @Test fun mediaTimestampsRequireSynchronizationAndExpireWithoutTimingResponses() {
        val clock = NtpClock()
        assertNull(clock.mediaTimeNanos(1))
        assertNull(clock.ntpTimeNanos(BigInteger.ONE))
        // Exercise the existing NTP correction directly, without a real iPhone or timing sleeps.
        val correct = NtpClock::class.java.getDeclaredMethod("applyOffset", Double::class.javaPrimitiveType)
        correct.isAccessible = true
        correct.invoke(clock, 0.0)
        val before = System.nanoTime()
        val fullNtp = clock.syncedNtp()
        val sender = fullNtp.multiply(BigInteger.valueOf(1_000_000_000)).shiftRight(32).toLong() -
            VideoMediaClockMapping.NTP_EPOCH_NANOS
        val mapped = clock.mediaTimeNanos(sender)!!
        assertTrue(mapped >= before - 1 && mapped <= System.nanoTime())
        assertEquals(mapped, clock.ntpTimeNanos(fullNtp))
        assertNull(clock.ntpTimeNanos(BigInteger.ZERO))
        assertNull(clock.ntpTimeNanos(BigInteger.ONE.shiftLeft(64)))
        assertNull(clock.mediaTimeNanos(0))
        val lastSync = NtpClock::class.java.getDeclaredField("lastSyncNanos")
        lastSync.isAccessible = true
        lastSync.setLong(clock, System.nanoTime() - 11_000_000_000)
        assertNull(clock.mediaTimeNanos(sender))
        assertNull(clock.ntpTimeNanos(fullNtp))
    }
}
