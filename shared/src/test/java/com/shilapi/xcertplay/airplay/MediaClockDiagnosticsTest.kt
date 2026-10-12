package com.shilapi.xcertplay.airplay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import java.math.BigInteger
import org.junit.Test

class MediaClockDiagnosticsTest {
    @Test fun failedDiagnosticsCannotBreakSynchronizedFrameMapping() {
        val unavailable = NtpClock { throw IllegalStateException("diagnostic callback unavailable") }
        assertEquals(null, unavailable.mediaTimeNanos(1))
        val clock = NtpClock { throw IllegalStateException("diagnostic callback unavailable") }
        val correct = NtpClock::class.java.getDeclaredMethod("applyOffset", Double::class.javaPrimitiveType)
        correct.isAccessible = true
        correct.invoke(clock, 0.0)
        val before = System.nanoTime()
        val sender = clock.syncedNtp().multiply(BigInteger.valueOf(1_000_000_000)).shiftRight(32).toLong() -
            VideoMediaClockMapping.NTP_EPOCH_NANOS
        val mapped = clock.mediaTimeNanos(sender)
        assertTrue(mapped != null && mapped >= before - 1 && mapped <= System.nanoTime())
    }

    @Test fun timingEvidenceIsThrottledAndDistinguishesMissingSyncFromInvalidFrameAge() {
        val lines = mutableListOf<String>()
        val diagnostics = MediaClockDiagnostics(lines::add)
        diagnostics.sent()
        diagnostics.requested()
        diagnostics.responded(false)
        diagnostics.failed()
        diagnostics.frame(20_000_000_000L, 1, null, false, 0)
        diagnostics.frame(21_000_000_000L, 1, null, false, 0)
        assertEquals(1, lines.size)
        assertTrue(lines.single().contains("tx=1 rxRequest=1 rxResponse=1 unmatched=1 sendFailures=1 synced=false"))
        assertTrue(lines.single().endsWith("senderZero=false frameAgeMs=-"))
        diagnostics.frame(30_000_000_000L, 1, 30_050_000_000L, true, 29_000_000_000L)
        assertEquals(2, lines.size)
        assertTrue(lines.last().contains("synced=true syncAgeMs=1000"))
        assertTrue(lines.last().endsWith("senderZero=false frameAgeMs=-50"))
    }
}
