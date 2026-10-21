package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test

class BrowserAudioDiagnosticsTest {
    @Test fun noiseDispersionRetainsItsSideOfTheGateWithoutChangingOrdinaryScalarPrecision() {
        val lines = BrowserAudioDiagnostics.lines(mapOf(
            "deviceClockUncertaintyMs" to 2.999999, "deviceClockFitDispersionMs" to 3.000001,
            "stream0.sourceClockDispersionMs" to 0.500001,
            "stream6.sourceClockDispersionMs" to 1.500001,
            "stream0.phaseErrorMs" to 0.123456,
        ))
        val text = lines.joinToString(" ")
        assertTrue(text.contains("deviceClockUncertaintyMs=2.999999"))
        assertTrue(text.contains("deviceClockFitDispersionMs=3.000001"))
        assertTrue(text.contains("sourceClockDispersionMs=0.500001"))
        assertTrue(text.contains("sourceClockDispersionMs=1.500001"))
        assertTrue(text.contains("phaseErrorMs=0.123"))
        assertFalse(text.contains("phaseErrorMs=0.123456"))
        assertTrue(lines.all { it.length <= 600 })
    }

    @Test fun currentDeviceFitNoiseRemainsSeparateFromAcceptedUncertaintyAndUnknownNoiseStaysAbsent() {
        val evidence = mapOf<String, Any?>(
            "deviceClockUncertaintyMs" to 0.125123, "deviceClockFitDispersionMs" to 3.000001,
            "deviceClockRatePpm" to -12_000, "deviceClockTargetRatePpm" to -12_000,
            "deviceClockConfidence" to 0, "deviceClockAcceptedFitAgeMs" to 16_000.5,
            "deviceClockFitRejected" to 27, "deviceClockFitStatus" to "holdover",
            "deviceClockFitRejectReason" to "noisy",
        )
        val lines = BrowserAudioDiagnostics.lines(evidence)
        val text = lines.joinToString(" ")
        assertTrue(text.contains("deviceClockUncertaintyMs=0.125123"))
        assertTrue(text.contains("deviceClockFitDispersionMs=3.000001"))
        assertTrue(text.contains("deviceClockRatePpm=-12000"))
        assertTrue(text.contains("deviceClockTargetRatePpm=-12000"))
        assertTrue(text.contains("deviceClockConfidence=0"))
        assertTrue(text.contains("deviceClockAcceptedFitAgeMs=16000.500"))
        assertTrue(text.contains("deviceClockFitRejected=27"))
        assertTrue(text.contains("deviceClockFitStatus=holdover"))
        assertTrue(text.contains("deviceClockFitRejectReason=noisy"))
        assertTrue(lines.all { it.length <= 600 })
        for (line in lines) assertEquals(line, DiagnosticRedactor.redact(line))
        for (unknown in listOf(null, Double.NaN, Double.NEGATIVE_INFINITY, Double.POSITIVE_INFINITY)) {
            val withoutNoise = BrowserAudioDiagnostics.lines(evidence + ("deviceClockFitDispersionMs" to unknown))
                .joinToString(" ")
            assertFalse(withoutNoise.contains("deviceClockFitDispersionMs="))
            assertTrue(withoutNoise.contains("deviceClockUncertaintyMs=0.125123"))
            assertTrue(withoutNoise.contains("deviceClockFitRejectReason=noisy"))
            assertTrue(BrowserAudioDiagnostics.lines(mapOf("deviceClockFitDispersionMs" to unknown)).isEmpty())
        }
        assertTrue(BrowserAudioDiagnostics.lines(mapOf(
            "stream0.deviceClockFitDispersionMs" to 3.000001,
            "deviceClockFitPrivateNoise" to 3.000001,
        )).isEmpty())
    }

    @Test fun sourceFitEvidenceExplainsZeroConfidenceWithoutInventingUnknownHistory() {
        val cases = listOf(
            "acquiring" to "not-observed", "acquiring" to "no-samples",
            "acquiring" to "insufficient-span", "acquiring" to "insufficient-points",
            "acquiring" to "insufficient-pairs", "acquiring" to "out-of-range",
            "holdover" to "noisy", "tracking" to "none", "disabled" to "buffered-prefetch",
        )
        for ((status, reason) in cases) {
            val line = BrowserAudioDiagnostics.lines(mapOf(
                "stream0.sourceRateConfidence" to 0,
                "stream0.sourceClockFitStatus" to status, "stream0.sourceClockFitRejectReason" to reason,
                "stream0.sourceClockPoints" to 24, "stream0.sourceClockSpanMs" to 29_999,
                "stream0.sourceClockDispersionMs" to 0.501, "stream0.sourceClockAcceptedFitAgeMs" to 5000,
                "stream0.sourceClockFitRejected" to 7,
            )).single()
            assertTrue(line.startsWith("Browser audio: stage=STREAM stream=0 "))
            assertTrue(line.contains("sourceClockFitStatus=$status"))
            assertTrue(line.contains("sourceClockFitRejectReason=$reason"))
            assertTrue(line.contains("sourceRateConfidence=0"))
            assertTrue(line.contains("sourceClockPoints=24"))
            assertTrue(line.contains("sourceClockSpanMs=29999"))
            assertTrue(line.contains("sourceClockDispersionMs=0.501"))
            assertTrue(line.contains("sourceClockAcceptedFitAgeMs=5000"))
            assertTrue(line.contains("sourceClockFitRejected=7"))
            assertTrue(line.length <= 600)
            assertEquals(line, DiagnosticRedactor.redact(line))
        }
        assertTrue(BrowserAudioDiagnostics.lines(mapOf(
            "stream0.sourceClockFitStatus" to "untrusted-state", "stream0.sourceClockFitRejectReason" to "secret",
            "stream0.sourceClockPoints" to Double.NaN, "stream0.sourceClockSpanMs" to Double.POSITIVE_INFINITY,
            "stream0.sourceClockDispersionMs" to null, "stream0.sourceClockAcceptedFitAgeMs" to null,
            "stream0.sourceClockFitRejected" to Double.NaN, "stream0.sourceClockPrivateSource" to "hidden",
        )).isEmpty())
    }

    @Test fun actualQuantumAndIndependentSourceFitsSurviveTheExistingMetadataBudget() {
        val source = mapOf<String, Any?>(
            "sourceClockFitStatus" to "holdover", "sourceClockFitRejectReason" to "noisy",
            "sourceClockPoints" to 120, "sourceClockSpanMs" to 120_000,
            "sourceClockDispersionMs" to 1.501, "sourceClockAcceptedFitAgeMs" to 60_000,
            "sourceClockFitRejected" to 1_000_000_000L,
            "headMs" to 1_792_120_000_000.125, "tailMs" to 1_792_120_002_000.125,
            "playbackMs" to 1_792_120_000_030.125, "contextTimeMs" to 1_792_120_000_040.125,
            "queueBytes" to 192_000, "recoveryCounts.clock-step" to 1_000_000_001L,
            "recoveryCounts.network-buffer" to 1_000_000_002L,
            "recoveryCounts.device-clock-jump" to 1_000_000_003L,
            "lastRecoveryReason" to "clock-step",
            "deviceRatePpm" to -20_000, "phaseErrorMs" to 38.125,
            "sourceDeadlineReason" to "output-clock-unavailable",
        )
        val stats = mapOf<String, Any?>("renderQuantumFrames" to 256,
            "renderQuantumMinFrames" to 64, "renderQuantumMaxFrames" to 256) +
            source.mapKeys { "stream0.${it.key}" } + source.mapKeys { "stream6.${it.key}" }
        val lines = BrowserAudioDiagnostics.lines(stats)
        assertTrue(lines.single { it.startsWith("Browser audio: stage=SNAPSHOT ") }.let {
            it.contains("renderQuantumFrames=256") && it.contains("renderQuantumMinFrames=64") &&
                it.contains("renderQuantumMaxFrames=256")
        })
        for (stream in listOf(0, 6)) {
            val streamLines = lines.filter { it.startsWith("Browser audio: stage=STREAM stream=$stream ") }
            assertTrue("A complete noisy fit must not truncate later recoveries", streamLines.size > 1)
            for (field in source.keys) assertEquals("Exactly one complete $field in stream $stream", 1,
                streamLines.sumOf { Regex("(?:^| )${Regex.escape(field)}=").findAll(it).count() })
        }
        for (line in lines) {
            assertTrue(line.length <= 600)
            val timestamped = "2026-01-01 00:00:00.000 +0000  $line"
            assertEquals(timestamped, DiagnosticRedactor.redact(timestamped))
        }
        assertTrue(BrowserAudioDiagnostics.lines(mapOf("renderQuantumFrames" to null,
            "renderQuantumMinFrames" to Double.NaN, "renderQuantumMaxFrames" to Double.POSITIVE_INFINITY,
            "renderQuantumPrivateDevice" to "hidden")).isEmpty())
    }

    @Test fun explicitDecoderSilenceIsSeparateFromRenderedSilenceAndUnknownNoDataStaysAbsent() {
        val lines = BrowserAudioDiagnostics.lines(mapOf(
            "renderNonzero" to 0,
            "decoder.frames" to 6144, "decoder.noDataPackets" to 3, "decoder.noDataFrames" to 1536,
            "decoder.stream6.backend" to "wasm", "decoder.stream6.frames" to 6144,
            "decoder.stream6.noDataPackets" to 3, "decoder.stream6.noDataFrames" to 1536,
            "decoder.stream0.frames" to 4800,
        ))
        assertTrue(lines.all { it.length <= 600 })
        val global = lines.single { it.startsWith("Browser audio: stage=DECODE ") && !it.contains("stream=") }
        val mirror = lines.single { it.startsWith("Browser audio: stage=DECODE stream=6 ") }
        val carplay = lines.single { it.startsWith("Browser audio: stage=DECODE stream=0 ") }
        for (line in listOf(global, mirror)) {
            assertTrue(line.contains("frames=6144"))
            assertTrue(line.contains("noDataPackets=3"))
            assertTrue(line.contains("noDataFrames=1536"))
            val timestamped = "2026-01-01 00:00:00.000 +0000  $line"
            assertEquals(timestamped, DiagnosticRedactor.redact(timestamped))
        }
        assertFalse(carplay.contains("noData"))
        assertTrue(BrowserAudioDiagnostics.lines(mapOf(
            "decoder.noDataPackets" to null, "decoder.noDataFrames" to Double.NaN,
            "decoder.stream6.noDataPackets" to Double.POSITIVE_INFINITY,
            "decoder.stream6.noDataFrames" to null,
            "decoder.inventedSilence" to 1, "decoder.stream6.inventedSilence" to 1,
        )).isEmpty())
    }

    @Test fun contradictoryOutputMeasurementsKeepTheirBoundedUnavailableReasonInTheExport() {
        val lines = BrowserAudioDiagnostics.lines(mapOf(
            "outputState" to "timestamp-discontinuity",
            "outputUnavailableReason" to "timestamp-discontinuity",
            "outputUnavailableCounts.timestamp-discontinuity" to 2,
            "outputUnavailableCounts.unknown-route" to "hidden",
        ))
        assertEquals(listOf("Browser audio: stage=SNAPSHOT outputState=timestamp-discontinuity " +
            "outputUnavailableReason=timestamp-discontinuity outputUnavailableCounts.timestamp-discontinuity=2"), lines)
    }

    @Test fun recoveryEvidenceDistinguishesBufferAndDeviceInterruptionsFromClockStepsForBothLiveModes() {
        val lines = BrowserAudioDiagnostics.lines(mapOf(
            "stream0.mode" to "carplay", "stream0.epoch" to 7,
            "stream0.lastRecoveryReason" to "network-buffer", "stream0.rebufferCount" to 6,
            "stream0.recoveryCounts.clock-step" to 0, "stream0.recoveryCounts.underrun" to 0,
            "stream0.recoveryCounts.network-buffer" to 3, "stream0.recoveryCounts.device-clock-jump" to 2,
            "stream0.recoveryCounts.clock-generation" to 1,
            "stream6.mode" to "airplay-mirror", "stream6.epoch" to 9,
            "stream6.lastRecoveryReason" to "suspended", "stream6.rebufferCount" to 4,
            "stream6.recoveryCounts.clock-step" to 0, "stream6.recoveryCounts.suspended" to 1,
            "stream6.recoveryCounts.network-buffer" to 3,
        ))
        val music = lines.filter { it.startsWith("Browser audio: stage=STREAM stream=0 ") }.joinToString(" ")
        val mirror = lines.filter { it.startsWith("Browser audio: stage=STREAM stream=6 ") }.joinToString(" ")
        assertTrue(music.contains("lastRecoveryReason=network-buffer"))
        assertTrue(music.contains("rebufferCount=6"))
        assertTrue(music.contains("recoveryCounts.clock-step=0"))
        assertTrue(music.contains("recoveryCounts.underrun=0"))
        assertTrue(music.contains("recoveryCounts.network-buffer=3"))
        assertTrue(music.contains("recoveryCounts.device-clock-jump=2"))
        assertTrue(music.contains("recoveryCounts.clock-generation=1"))
        assertTrue(mirror.contains("mode=airplay-mirror"))
        assertTrue(mirror.contains("rebufferCount=4"))
        assertTrue(mirror.contains("lastRecoveryReason=suspended"))
        assertTrue(mirror.contains("recoveryCounts.suspended=1"))
        assertTrue(mirror.contains("recoveryCounts.network-buffer=3"))
        assertFalse(mirror.contains("recoveryCounts.device-clock-jump="))
        assertFalse(music.contains("recoveryCounts.suspended="))
    }

    @Test fun completeRecoveryVectorSurvivesMetadataSplittingAndUnknownEvidenceStaysAbsent() {
        // A long-lived guidance stream can encounter every recovery path. Its
        // complete counter history must survive the logger's per-line cap.
        val evidence = mapOf(
            "mode" to "carplay", "semanticType" to 1, "epoch" to 9,
            "headMs" to 1_792_120_000_000.125, "tailMs" to 1_792_120_002_000.125,
            "playbackMs" to 1_792_120_000_030.125, "contextTimeMs" to 1_792_120_000_040.125,
            "queueBytes" to 192_000, "queuePackets" to 60, "state" to "rebuffering",
            "lastRecoveryReason" to "sender-deadline", "rebufferCount" to 1_000_000_001L,
            "lastClockStepPhaseErrorMs" to -37.25, "lastClockStepAgeMs" to 16000,
            "recoveryCounts.clock-step" to 1, "recoveryCounts.underrun" to 1,
            "recoveryCounts.source-deadline" to 1_000_000_002L,
            "recoveryCounts.clock-generation" to 1_000_000_003L,
            "recoveryCounts.suspended" to 1_000_000_004L,
            "recoveryCounts.sender-deadline" to 1_000_000_005L,
            "recoveryCounts.network-buffer" to 1_000_000_006L,
            "recoveryCounts.device-clock-jump" to 1_000_000_007L,
        )
        val lines = BrowserAudioDiagnostics.lines(evidence.mapKeys { "stream255.${it.key}" })
        assertTrue("A full recovery vector must split before the metadata cap", lines.size > 1)
        for (line in lines) {
            assertTrue(line.length <= 600)
            assertTrue(line.startsWith("Browser audio: stage=STREAM stream=255 "))
            val timestamped = "2026-01-01 00:00:00.000 +0000  $line"
            assertEquals(timestamped, DiagnosticRedactor.redact(timestamped))
        }
        for (field in evidence.keys) assertEquals("Exactly one complete value for $field", 1,
            lines.sumOf { Regex("(?:^| )${Regex.escape(field)}=").findAll(it).count() })
        assertTrue(BrowserAudioDiagnostics.lines(mapOf(
            "stream6.recoveryCounts.network-buffer" to Double.NaN,
            "stream6.recoveryCounts.suspended" to null,
            "stream6.rebufferCount" to Double.POSITIVE_INFINITY,
            "stream6.recoveryCounts.device-clock-reset" to 1,
            "stream6.recoveryCounts.invented-reason" to 2,
            "stream6.secret" to "hidden",
        )).isEmpty())
    }

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
            "deviceClockAcceptedFitAgeMs", "deviceClockFitRejected", "deviceClockFitDispersionMs",
            "outputTimestampContextMs", "outputTimestampPerformanceMs", "outputTimestampAgeMs", "outputRenderedContextMs",
            "outputFeedbackDeltaMs", "outputFeedbackContextMs", "outputFeedbackAgeMs",
            "outputUnavailableCounts.timestamp-backwards", "outputUnavailableCounts.timestamp-invalid",
        )
        val lines = BrowserAudioDiagnostics.lines(fields.associateWith { 1_792_120_000_000.125 } + mapOf(
            "deviceClockFitStatus" to "holdover", "deviceClockFitRejectReason" to "noisy",
        ))
        assertTrue("A full snapshot must be split before the metadata cap", lines.size > 1)
        for (line in lines) {
            assertTrue(line.length <= 600)
            val timestamped = "2026-10-19 11:54:40.607 +0800  $line"
            assertEquals("Metadata must retain every scalar", timestamped, DiagnosticRedactor.redact(timestamped))
        }
        for (field in fields + listOf("deviceClockFitStatus", "deviceClockFitRejectReason")) {
            val occurrences = lines.sumOf { Regex("(?:^| )${Regex.escape(field)}=").findAll(it).count() }
            assertEquals("Exactly one complete value for $field", 1, occurrences)
        }
    }
}
