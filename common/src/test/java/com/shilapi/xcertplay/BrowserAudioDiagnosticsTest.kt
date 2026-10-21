package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test

class BrowserAudioDiagnosticsTest {
    @Test fun clockStepKeepsSignedPreRecoveryEvidenceAndOmittedUnknownsStayUnknown() {
        val lines = BrowserAudioDiagnostics.lines(mapOf("stream0.epoch" to 56,
            "stream0.lastClockStepPhaseErrorMs" to -37.25, "stream0.phaseErrorMs" to 0.5,
            "stream0.lastClockStepDeviceRatePpm" to -12_500, "stream0.lastClockStepUncertaintyMs" to 8.17,
            "stream0.lastClockStepAgeMs" to 5000, "stream0.recoveryCounts.clock-step" to 26))
        val text = lines.joinToString(" ")
        assertTrue(text.contains("lastClockStepPhaseErrorMs=-37.250"))
        assertTrue(text.contains("phaseErrorMs=0.500"))
        assertTrue(text.contains("lastClockStepDeviceRatePpm=-12500"))
        assertTrue(text.contains("lastClockStepUncertaintyMs=8.170"))
        assertTrue(text.contains("lastClockStepAgeMs=5000"))
        assertTrue(lines.all { it.length <= 600 })
        assertTrue(BrowserAudioDiagnostics.lines(mapOf("stream0.lastClockStepPhaseErrorMs" to Double.NaN,
            "stream0.lastClockStepAgeMs" to null)).isEmpty())
    }
    @Test fun aRecoveredMirrorSourceAnchorAndItsDeadlineBudgetRemainVisible() {
        for (state in listOf("unavailable", "mapped-presentation", "arrival-anchored-unverified")) {
            val line = BrowserAudioDiagnostics.lines(mapOf("stream6.senderTimingState" to state,
                "stream6.senderRelativePolicyCeilingMs" to 300, "stream6.sourceStartupDelayMs" to 436.5)).single()
            assertTrue(line.contains("senderTimingState=$state"))
            assertTrue(line.contains("senderRelativePolicyCeilingMs=300"))
            assertTrue(line.contains("sourceStartupDelayMs=436.500"))
            assertTrue(line.length <= 600)
        }
        assertTrue(BrowserAudioDiagnostics.lines(mapOf("stream6.senderTimingState" to "invented-state")).isEmpty())
    }
    @Test fun deviceFitHoldoverRetainsOnlyFixedEvidenceAndRejectsInventedStatusText() {
        val lines = BrowserAudioDiagnostics.lines(mapOf(
            "deviceClockAcceptedFitAgeMs" to 16_000.5, "deviceClockFitRejected" to 27,
            "deviceClockFitStatus" to "holdover", "deviceClockFitRejectReason" to "noisy",
        ))
        assertTrue(lines.single().contains("deviceClockAcceptedFitAgeMs=16000.500"))
        assertTrue(lines.single().contains("deviceClockFitRejected=27"))
        assertTrue(lines.single().contains("deviceClockFitStatus=holdover"))
        assertTrue(lines.single().contains("deviceClockFitRejectReason=noisy"))
        assertTrue(BrowserAudioDiagnostics.lines(mapOf(
            "deviceClockFitStatus" to "unbounded-status", "deviceClockFitRejectReason" to "secret",
            "deviceClockAcceptedFitAgeMs" to Double.NaN,
        )).isEmpty())
    }
    @Test fun independentSourceDeadlineAndUnavailableClockReasonRemainVisible() {
        val lines = BrowserAudioDiagnostics.lines(mapOf("stream0.sourceDeadlineState" to "unknown",
            "stream0.sourceDeadlineReason" to "source-anchor-unavailable", "stream0.sourceDeltaUpperMs" to 305,
            "stream0.sourceDeadlineRejectedFrames" to 128, "stream0.recoveryCounts.source-deadline" to 1))
        assertTrue(lines.single().contains("sourceDeadlineState=unknown"))
        assertTrue(lines.single().contains("sourceDeadlineReason=source-anchor-unavailable"))
        assertTrue(lines.single().contains("sourceDeadlineRejectedFrames=128"))
        assertTrue(lines.single().contains("recoveryCounts.source-deadline=1"))
    }
    @Test fun separatesDecodedPcmFromRenderedOutputAndTheStreamsClock() {
        val lines = BrowserAudioDiagnostics.lines(mapOf(
            "pageVersion" to "v52", "contextState" to "running", "contextTimeMs" to 5000,
            "pcmFrames" to 120_000, "renderNonzero" to 0, "renderAgeMs" to 2500,
            "decoder.frames" to 120_000, "decoder.stream0.backend" to "webcodecs",
            "stream0.epoch" to 4, "stream0.headMs" to 1_792_120_000_000L,
            "stream0.playbackMs" to 1_792_119_999_900L, "stream0.capacityPackets" to 117,
            "stream0.playedPackets" to 0,
        ))
        assertEquals(4, lines.size)
        assertTrue(lines[0].contains("contextState=running"))
        assertTrue(lines[0].contains("renderNonzero=0"))
        assertTrue(lines[1].contains("stage=DECODE frames=120000"))
        assertTrue(lines[2].contains("stream=0"))
        assertTrue(lines[2].contains("headMs=1792120000000"))
        assertTrue(lines[2].contains("capacityPackets=117"))
        assertTrue(lines[2].contains("playedPackets=0"))
        assertTrue(lines[3].contains("backend=webcodecs"))
    }

    @Test fun unknownFieldsAndUnsafeTextCannotInjectCredentialsOrExtraLogLines() {
        val lines = BrowserAudioDiagnostics.lines(mapOf(
            "code" to "1234", "url" to "https://private.test/secret", "stream256.epoch" to 4,
            "contextState" to "running\nsecret", "stream0.mode" to "https://private.test",
            "clockAgeMs" to Double.NaN, "renderAgeMs" to Double.POSITIVE_INFINITY,
            "renderFrames" to 256,
        ))
        assertEquals(listOf("Browser audio: stage=SNAPSHOT renderFrames=256"), lines)
    }

    @Test fun extendedTransportStreamsKeepTheirSemanticPurposeAndArrivalAnchorInDiagnostics() {
        val lines = BrowserAudioDiagnostics.lines(mapOf(
            "stream255.epoch" to 3, "stream255.semanticType" to 1, "stream255.anchoring" to "arrival",
            "decoder.stream255.backend" to "webcodecs", "decoder.stream255.semanticType" to 1,
            "stream256.epoch" to 4, "decoder.stream999.backend" to "invalid",
        ))
        assertEquals(2, lines.size)
        assertTrue(lines[0].contains("stream=255")); assertTrue(lines[0].contains("semanticType=1"))
        assertTrue(lines[0].contains("anchoring=arrival")); assertTrue(lines[1].contains("backend=webcodecs"))
        assertTrue(lines.none { it.contains("stream=256") || it.contains("stream=999") })
    }

    @Test fun outputClockEvidenceRetainsPpmAndUnavailableReasonsWithoutAdmittingArbitraryKeys() {
        val lines = BrowserAudioDiagnostics.lines(mapOf(
            "deviceClockRatePpm" to -4000.125, "outputUnavailableReason" to "feedback-distance",
            "outputUnavailableCounts.feedback-distance" to 7, "outputUnavailableCounts.secret" to "hidden",
            "stream0.resampleRatePpm" to 4016.064, "stream0.phaseCorrectionPpm" to 0.25,
            "outputFeedbackContextMs" to 12342.667, "outputFeedbackAgeMs" to 20,
            "outputTimestampCaptureMs" to 40, "outputTimestampHoldoverAgeMs" to 70,
            "stream0.contextTimeMs" to 12342.667,
        ))
        assertEquals(2, lines.size)
        assertTrue(lines[0].contains("deviceClockRatePpm=-4000.125"))
        assertTrue(lines[0].contains("outputUnavailableReason=feedback-distance"))
        assertTrue(lines[0].contains("outputUnavailableCounts.feedback-distance=7"))
        assertTrue(lines[0].contains("outputFeedbackContextMs=12342.667"))
        assertTrue(lines[0].contains("outputFeedbackAgeMs=20"))
        assertTrue(lines[0].contains("outputTimestampCaptureMs=40"))
        assertTrue(lines[0].contains("outputTimestampHoldoverAgeMs=70"))
        assertTrue(lines[1].contains("resampleRatePpm=4016.064"))
        assertTrue(lines[1].contains("contextTimeMs=12342.667"))
        assertTrue(lines.none { it.contains("secret") || it.contains("hidden") })
    }

    @Test fun fullClockEvidenceSurvivesTheMetadataRedactorWithoutLosingTailFields() {
        val fields = listOf(
            "contextTimeMs", "contextRate", "clockBase", "clockOffsetMs", "clockAgeMs", "clockRttMs",
            "contextBaseLatencyMs", "contextOutputLatencyMs", "processorErrors", "recoveries", "recoveryAttempts",
            "renderAgeMs", "renderReportAgeMs", "renderFrames", "renderNonzero", "renderPeak", "processCalls",
            "renderTimeMs", "pcmPackets", "pcmFrames", "pcmNonzero", "pcmPeak", "clockRatePpm", "clockGeneration",
            "clockUncertaintyMs", "clockRateConfidence", "deviceClockRatePpm", "deviceClockTargetRatePpm",
            "deviceClockConfidence", "deviceClockUncertaintyMs", "deviceClockGeneration", "outputUnavailableCount",
            "deviceClockAcceptedFitAgeMs", "deviceClockFitRejected",
            "outputTimestampContextMs", "outputTimestampPerformanceMs", "outputTimestampAgeMs", "outputRenderedContextMs",
            "outputFeedbackDeltaMs", "outputFeedbackContextMs", "outputFeedbackAgeMs",
            "outputUnavailableCounts.timestamp-backwards", "outputUnavailableCounts.timestamp-invalid",
        )
        val lines = BrowserAudioDiagnostics.lines(fields.associateWith { 1_792_120_000_000.125 } + mapOf(
            "deviceClockFitStatus" to "holdover", "deviceClockFitRejectReason" to "noisy",
        ))
        assertTrue("A full snapshot must be split before the metadata cap", lines.size > 1)
        for (line in lines) {
            val timestamped = "2026-10-19 11:54:40.607 +0800  $line"
            assertEquals("Metadata must retain every scalar", timestamped, DiagnosticRedactor.redact(timestamped))
        }
        for (field in fields + listOf("deviceClockFitStatus", "deviceClockFitRejectReason")) {
            val occurrences = lines.sumOf { Regex("(?:^| )${Regex.escape(field)}=").findAll(it).count() }
            assertEquals("Exactly one complete value for $field", 1, occurrences)
        }
    }
}
