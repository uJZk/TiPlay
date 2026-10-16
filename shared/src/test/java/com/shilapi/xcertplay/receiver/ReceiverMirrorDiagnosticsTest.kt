package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.VideoCodec
import org.junit.Assert.*
import org.junit.Test

class ReceiverMirrorDiagnosticsTest {
    @Test fun relativeTimingSeparatesSenderPacingFromReceiverBacklog() {
        val logs = mutableListOf<String>()
        val now = 8_000_000_000L
        val diagnostics = ReceiverMirrorDiagnostics(logs::add) { now }
        diagnostics.forwarded(42, true, true)
        diagnostics.timing(90_000_000_000L, 2_000_000_000L, 1_000_000L, 2_000_000L)
        diagnostics.forwarded(42, false, true)
        diagnostics.timing(91_000_000_000L, 7_000_000_000L, 3_000_000L, 4_000_000L)
        diagnostics.end(ReceiverMirrorDiagnostics.End.HEADER_EOF)
        assertTrue(logs.any { it.contains("arrivalElapsedMs=5000 sourceElapsedMs=1000 driftMs=4000 bodyReadMs=3 publishMs=4") })
        assertTrue(logs.last().contains("sinceLastFrameMs=1000"))
        assertFalse(logs.any { it.contains("90000000000") || it.contains("91000000000") })
    }

    @Test fun missingSourceTimeDoesNotBecomeAnEpochOrFalseBacklog() {
        val logs = mutableListOf<String>()
        val diagnostics = ReceiverMirrorDiagnostics(logs::add)
        diagnostics.forwarded(42, true, true)
        diagnostics.timing(0L, 2_000_000_000L, 0L, 0L)
        diagnostics.forwarded(42, false, true)
        diagnostics.timing(90_000_000_000L, 5_000_000_000L, 0L, 0L)
        assertTrue(logs.any { it.contains("sourceElapsedMs=null driftMs=null") })
        assertTrue(logs.any { it.contains("arrivalElapsedMs=3000 sourceElapsedMs=0 driftMs=0") })
    }

    @Test fun metadataIsSampledAndFailureMessagesDoNotLeak() {
        val logs = mutableListOf<String>()
        val diagnostics = ReceiverMirrorDiagnostics(logs::add)
        diagnostics.config(VideoCodec.H264, 42)
        repeat(240) { index ->
            diagnostics.packet(0, 1024)
            diagnostics.forwarded(1024, keyFrame = index % 120 == 0, annexB = index < 200)
        }
        diagnostics.failure(ReceiverMirrorDiagnostics.Stage.DECRYPT, IllegalArgumentException("secret transport key"))
        diagnostics.end(ReceiverMirrorDiagnostics.End.FAILED)
        assertEquals(5, logs.count { it.contains("stage=PACKET") })
        assertEquals(5, logs.count { it.contains("stage=FORWARDED") })
        assertTrue(logs.any { it.contains("codec=H264") })
        assertTrue(logs.any { it.contains("packets=240 configs=1 frames=240") })
        assertTrue(logs.any { it.contains("frames=120 keyFrames=1 annexBFrames=120") })
        assertTrue(logs.any { it.contains("frames=240 keyFrames=2 annexBFrames=200") })
        assertTrue(logs.any { it.contains("exception=IllegalArgumentException") })
        assertFalse(logs.any { it.contains("secret") || it.contains("transport key") })
    }

    @Test fun stableParserReasonSurvivesStandardAndSizeGeometryDetailsFollowLiveDebugToggle() {
        val logs = mutableListOf<String>()
        var debug = false
        val diagnostics = ReceiverMirrorDiagnostics(logs::add, debug = { debug })
        diagnostics.configInput(248)
        diagnostics.geometry(708, 1536)
        val error = ReceiverMirrorCodec.ConfigurationException(ReceiverMirrorCodec.Reason.INVALID_BOX_SIZE, 226, 64)
        diagnostics.failure(ReceiverMirrorDiagnostics.Stage.CONFIG, error)
        assertTrue(logs.last().contains("reason=INVALID_BOX_SIZE"))
        assertFalse(logs.any { it.contains("FAILURE_DETAIL") })
        debug = true
        diagnostics.failure(ReceiverMirrorDiagnostics.Stage.CONFIG, error)
        assertTrue(logs.last().contains("inputBytes=248"))
        assertTrue(logs.last().contains("width=708 height=1536 offset=226 boxBytes=64"))
        debug = false
        diagnostics.failure(ReceiverMirrorDiagnostics.Stage.CONFIG, error)
        assertEquals(1, logs.count { it.contains("FAILURE_DETAIL") })
        assertTrue(logs.last().contains("reason=INVALID_BOX_SIZE"))
    }
}
