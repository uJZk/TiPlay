package com.shilapi.xcertplay.airplay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import java.math.BigInteger
import java.net.DatagramSocket
import org.junit.Test

class MediaClockDiagnosticsTest {
    @Test fun shortSessionsReportFinalSyncEvidenceOnceDespiteFrameThrottle() {
        val lines = mutableListOf<String>()
        val diagnostics = MediaClockDiagnostics(lines::add)
        diagnostics.frame(1_000_000_000L, 1, null, false, 0)
        repeat(4) { diagnostics.sent(); diagnostics.responded(true) }
        diagnostics.sample(0.002, -120.0)
        diagnostics.ended(5_000_000_000L, true, 4_000_000_000L)
        diagnostics.ended(6_000_000_000L, true, 4_000_000_000L)
        assertEquals(2, lines.size)
        assertTrue(lines.last().startsWith("Media clock final: tx=4 rxRequest=0 rxResponse=4 unmatched=0 sendFailures=0 synced=true syncAgeMs=1000"))
        assertTrue(lines.last().endsWith("rttUs=2000 offsetMs=-120000"))
    }

    @Test fun failingFinalLoggerCannotPreventSocketRelease() {
        val clock = NtpClock { throw IllegalStateException("logger unavailable") }
        val port = clock.listen()
        clock.close()
        clock.close()
        DatagramSocket(port).use { rebound -> assertEquals(port, rebound.localPort) }
    }

    @Test fun videoEndSnapshotLeavesFinalReportAvailableForLaterControlClose() {
        val lines = mutableListOf<String>()
        val diagnostics = MediaClockDiagnostics(lines::add)
        diagnostics.sent()
        diagnostics.videoEnded(5_000_000_000L, false, 0)
        diagnostics.videoEnded(5_100_000_000L, false, 0)
        diagnostics.responded(true)
        diagnostics.sent()
        diagnostics.ended(60_000_000_000L, true, 59_000_000_000L)
        assertEquals(2, lines.size)
        assertTrue(lines.first().startsWith("Media clock snapshot: reason=VIDEO_END tx=1"))
        assertTrue(lines.first().contains("synced=false"))
        assertTrue(lines.last().contains("Media clock final: tx=2 rxRequest=0 rxResponse=1"))
        assertTrue(lines.last().contains("synced=true syncAgeMs=1000"))
    }

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
