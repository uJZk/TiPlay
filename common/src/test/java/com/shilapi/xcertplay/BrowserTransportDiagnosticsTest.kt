package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test

class BrowserTransportDiagnosticsTest {
    @Test fun standardAudioDeadlineSchemaKeepsTheActualRejectionReasonWithoutVideoOrDebugFields() {
        val lines = mutableListOf<String>()
        val diagnostics = BrowserTransportDiagnostics(lines::add)
        // Matches createBrowserAudio.stats -> browserDiagnosticEvents in audio.test.mjs.
        val stats = mapOf("audio.sourceDeadlineState" to "violated", "audio.sourceDeadlineReason" to "source-deadline",
            "audio.sourceDeltaUpperMs" to 305, "audio.sourceDeadlineRejectedFrames" to 128,
            "audio.sourceDeadlineStream" to "carplay-0", "audio.sourceDeadlineEpoch" to 1)
        diagnostics.report(stats, false)
        val fault = lines.single()
        assertTrue(fault, fault.contains("stage=AUDIO") && fault.contains("failed=true reason=source-deadline"))
        assertTrue(fault, fault.contains("sourceDeltaUpperMs=305") && fault.contains("sourceDeadlineRejectedFrames=128"))
        assertTrue(fault, fault.contains("sourceDeadlineStream=carplay-0") && fault.contains("sourceDeadlineEpoch=1"))
        assertTrue(DiagnosticLogPolicy.shouldRecord(fault, DiagnosticLogLevel.STANDARD))
        assertEquals(fault, DiagnosticRedactor.redact(fault))
        diagnostics.report(stats, false)
        assertEquals(1, lines.size)
        diagnostics.report(stats + mapOf("transport.generation" to 7), false)
        assertEquals(1, lines.count { it.contains("stage=AUDIO") && it.contains("reason=source-deadline") })
    }

    @Test fun immediateFaultBypassesHealthyPeriodicLimitsAndKeepsStageAndResourceEvidence() {
        val lines = mutableListOf<String>()
        var now = 1L
        val diagnostics = BrowserTransportDiagnostics(lines::add) { now }
        val healthy = mapOf("transport.transport" to "webrtc-datachannel-v1", "transport.state" to "connected",
            "transport.stage" to "connected", "transport.generation" to 7, "transport.localUdpCandidates" to 2,
            "transport.remoteUdpCandidates" to 1, "transport.queuedBytes" to 512,
            "transport.reassemblyErrors" to 0, "video.playbackProfile" to "carplay-touch", "video.decodedQueueBytes" to 12_000_000)
        diagnostics.report(healthy, false)
        assertTrue(lines.any { it.contains("stage=CANDIDATES") && it.contains("localUdpCandidates=2") })
        assertFalse(lines.any { it.contains("stage=FLOW") })
        lines.clear()
        now++
        val failed = healthy + mapOf("transport.state" to "failed", "transport.reason" to "fragment-order", "transport.reassemblyErrors" to 1)
        diagnostics.report(failed, false)
        assertTrue(lines.any { it.contains("failed=true") && it.contains("reason=fragment-order") })
        assertTrue(lines.any { it.contains("stage=FLOW") && it.contains("queuedBytes=512") })
        assertTrue(lines.any { it.contains("stage=PIPELINE") && it.contains("playbackProfile=carplay-touch") })
        assertTrue(lines.all { it.length <= 600 && DiagnosticLogPolicy.shouldRecord(it, DiagnosticLogLevel.STANDARD) })
        val count = lines.size
        diagnostics.report(failed, false)
        assertEquals(count, lines.size)
        diagnostics.report(healthy, false)
        lines.clear()
        diagnostics.report(failed, false)
        assertTrue(lines.any { it.contains("failed=true") })
    }

    @Test fun missingCountersDoNotCreateRepeatedFaultsAndNewGenerationsHaveIndependentCounters() {
        val lines = mutableListOf<String>()
        val diagnostics = BrowserTransportDiagnostics(lines::add)
        val stats = mapOf("transport.generation" to 2, "transport.state" to "connected", "transport.reassemblyErrors" to 1)
        diagnostics.report(stats, false)
        diagnostics.report(mapOf("transport.generation" to 2, "transport.state" to "connected"), false)
        lines.clear()
        diagnostics.report(stats, false)
        assertTrue(lines.isEmpty())
        diagnostics.report(stats + mapOf("transport.generation" to 3), false)
        assertTrue(lines.any { it.contains("generation=3 failed=true") })
    }

    @Test fun debugIsBoundedAndRejectsArbitraryFieldsUnsafeTextAndNonfiniteNumbers() {
        val lines = mutableListOf<String>()
        var now = 1L
        val diagnostics = BrowserTransportDiagnostics(lines::add) { now }
        val stats = mapOf("transport.state" to "connected", "transport.stage" to "connected", "transport.generation" to 9,
            "transport.sdp" to "private-sdp", "transport.candidate" to "private-candidate", "transport.reason" to "private password=secret",
            "transport.queuedBytes" to "private-value", "transport.rttMs" to Double.NaN,
            "video.playbackProfile" to "airplay-mirror", "video.decodedQueueBytes" to 10_000_000)
        diagnostics.report(stats, true)
        assertTrue(lines.any { it.contains("stage=PIPELINE") })
        assertFalse(lines.joinToString().contains("private"))
        assertFalse(lines.joinToString().contains("NaN"))
        assertTrue(lines.all { it.length <= 600 })
        lines.clear()
        diagnostics.report(stats, true)
        assertTrue(lines.isEmpty())
        now += 10_000
        diagnostics.report(stats, true)
        assertTrue(lines.isNotEmpty())
    }
}
