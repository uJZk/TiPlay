package com.shilapi.xcertplay

import java.util.Locale

/** Scalar evidence only; paired browser telemetry must not become an arbitrary log-writing API. */
internal object BrowserAudioDiagnostics {
    // The source logger redacts and caps metadata at 700 characters, even in Debug.
    // Leave room for its timestamp and keep each scalar intact before that boundary.
    private const val LINE_BUDGET = 600
    private val globalFields = setOf(
        "pageVersion", "omittedFields", "contextState", "contextTimeMs", "contextRate", "clockBase",
        "contextObservedStateChanges", "contextObservedNonRunningMs",
        "clockOffsetMs", "clockAgeMs", "clockRttMs", "contextBaseLatencyMs", "contextOutputLatencyMs",
        "processorErrors", "recoveries", "recoveryAttempts", "processorFailed", "renderAgeMs", "renderReportAgeMs",
        "evidenceFirstJump.observedFrame", "evidenceFirstJump.expectedFrame", "evidenceFirstJump.deltaFrames", "evidenceFirstJump.blockFrames", "evidenceFirstJump.renderedFrames", "evidenceFirstJump.call",
        "evidenceLastJump.observedFrame", "evidenceLastJump.expectedFrame", "evidenceLastJump.deltaFrames", "evidenceLastJump.blockFrames", "evidenceLastJump.renderedFrames", "evidenceLastJump.call",
        "evidenceEndWorkMsMax", "evidenceCounts.frame-discontinuity", "evidenceCounts.frame-invalid", "evidenceCounts.callback-budget",
        "evidenceCounts.output-edge", "evidenceCounts.output-invalid", "evidenceCounts.output-range", "evidenceCounts.packet-gap",
        "evidenceCounts.arrival-gap", "evidenceCounts.packet-reset", "evidenceCounts.decoder-error", "evidenceCounts.decoded-range", "evidenceCounts.decoded-invalid",
        "evidenceAttempts", "evidenceSuppressed", "evidenceCompleted", "evidenceIncomplete", "evidenceClock", "evidenceForwarded", "evidenceDropped",
        "mixPreClipPeak", "mixOverFullScaleSamples", "mixNonFiniteSamples",
        "renderFrames", "renderNonzero", "renderPeak", "processCalls", "renderTimeMs",
        "renderQuantumFrames", "renderQuantumMinFrames", "renderQuantumMaxFrames",
        "renderStatsState", "renderUnderrunEvents", "renderUnderrunDurationMs", "renderTotalDurationMs",
        "pcmPackets", "pcmFrames", "pcmNonzero", "pcmPeak",
        "clockRatePpm", "clockGeneration", "clockUncertaintyMs", "clockRateConfidence",
        "deviceClockRatePpm", "deviceClockTargetRatePpm", "deviceClockConfidence", "deviceClockUncertaintyMs",
        "deviceClockGeneration", "deviceClockReason", "deviceClockSource", "outputState", "outputUnavailableCount", "outputUnavailableReason",
        "deviceClockAcceptedFitAgeMs", "deviceClockFitRejected", "deviceClockFitStatus", "deviceClockFitRejectReason",
        "deviceClockFitDispersionMs",
        "outputTimestampFitUncertaintyMs", "outputTimestampFitStatus", "outputTimestampFitGeneration",
        "outputTimestampContextMs", "outputTimestampPerformanceMs", "outputTimestampAgeMs", "outputRenderedContextMs", "outputFeedbackDeltaMs",
        "outputFeedbackContextMs", "outputFeedbackAgeMs",
        "outputTimestampCaptureMs", "outputTimestampHoldoverAgeMs",
        "outputUnavailableCounts.context-suspended", "outputUnavailableCounts.timestamp-backwards",
        "outputUnavailableCounts.timestamp-stale", "outputUnavailableCounts.timestamp-invalid",
        "outputUnavailableCounts.timestamp-discontinuity",
        "outputUnavailableCounts.missing-latency", "outputUnavailableCounts.latency-unbounded",
        "outputUnavailableCounts.invalid-feedback", "outputUnavailableCounts.feedback-distance",
    )
    private val sourceDeadlineEvidenceFields = setOf(
        "lastSourceDeadlineDeltaUpperMs", "lastSourceDeadlineUncertaintyMs", "lastSourceDeadlineAgeMs", "lastSourceDeadlineLimitMs",
    )
    private val retiredDeadlineEvidenceFields = setOf(
        "lastRetiredSourceDeadlineDeltaUpperMs", "lastRetiredSourceDeadlineUncertaintyMs",
        "lastRetiredSourceDeadlineAgeMs", "lastRetiredSourceDeadlineLimitMs",
    )
    private val retiredDeadlineIdentityFields = setOf(
        "lastRetiredSourceDeadlineEpoch", "lastRetiredSourceDeadlineGeneration", "retiredSourceDeadlineRejectedFrames",
    )
    private val renderDurationFields = setOf("renderUnderrunDurationMs", "renderTotalDurationMs")
    private val voicePreparationFrameFields = setOf("voicePreparedFrames", "voiceRequiredFrames")
    private val streamFields = setOf(
        "epoch", "rate", "channels", "headMs", "tailMs", "playbackMs", "contextTimeMs", "delayMs", "queueBytes", "queuePackets",
        "capacityPackets", "latePackets", "duplicatePackets", "playedPackets", "resetPackets", "invalidPackets",
        "capacityBytes", "lateBytes", "duplicateBytes", "playedBytes", "resetBytes", "invalidBytes", "mode", "semanticType", "anchoring",
        "state", "reason", "phaseErrorMs", "resampleRatePpm", "deviceRatePpm", "phaseCorrectionPpm", "sourceRatePpm", "sourceRateConfidence",
        "sourceClockFitStatus", "sourceClockFitRejectReason", "sourceClockPoints", "sourceClockSpanMs",
        "sourceClockDispersionMs", "sourceClockAcceptedFitAgeMs", "sourceClockFitRejected",
        "sourceDeadlineState", "sourceDeadlineReason", "sourceDeltaMs", "sourceDeltaUpperMs", "sourceDeadlineRejectedFrames",
        "senderTimingState", "senderRelativePolicyCeilingMs", "sourceStartupDelayMs",
        "voicePreparationState", "voicePreparedFrames", "voiceRequiredFrames", "voiceWaitMs",
        "lastRecoveryReason", "rebufferCount", "recoveryCounts.clock-step", "recoveryCounts.underrun",
        "lastClockStepPhaseErrorMs", "lastClockStepDeviceRatePpm", "lastClockStepUncertaintyMs", "lastClockStepAgeMs",
        "recoveryCounts.source-deadline", "recoveryCounts.clock-generation", "recoveryCounts.suspended",
        "recoveryCounts.sender-deadline", "recoveryCounts.network-buffer", "recoveryCounts.device-clock-jump",
    ) + sourceDeadlineEvidenceFields + retiredDeadlineEvidenceFields + retiredDeadlineIdentityFields
    private val decoderFields = setOf("nativeScanFrames", "nativePeak", "nativeOverFullScaleSamples", "nativeNonFiniteSamples", "nativeScanErrors", "packets", "frames", "nonzero", "peak", "errors", "noDataPackets", "noDataFrames")
    private val decoderStreamFields = setOf("packets", "frames", "nonzero", "peak", "backend", "epoch", "rate", "channels", "semanticType", "noDataPackets", "noDataFrames")
    private val streamKey = Regex("(?:decoder\\.)?stream([0-9]{1,3})\\..+")
    private val safeText = Regex("[A-Za-z0-9._-]{1,40}")
    private val enumFields = mapOf(
        "renderStatsState" to setOf("available", "unavailable", "invalid", "failed"),
        "deviceClockFitStatus" to setOf("acquiring", "tracking", "holdover"),
        "deviceClockSource" to setOf("native", "render", "holdover"),
        "outputTimestampFitStatus" to setOf("acquiring", "tracking", "holdover"),
        "deviceClockFitRejectReason" to setOf("none", "noisy", "out-of-range"),
        "sourceClockFitStatus" to setOf("acquiring", "tracking", "holdover", "disabled"),
        "sourceClockFitRejectReason" to setOf("not-observed", "no-samples", "insufficient-span", "insufficient-points",
            "insufficient-pairs", "noisy", "out-of-range", "none", "buffered-prefetch"),
        "senderTimingState" to setOf("unavailable", "arrival-anchored-unverified", "mapped-presentation"),
        "voicePreparationState" to setOf("idle", "waiting-clock", "waiting-data", "waiting-deadline",
            "priming", "waiting-reserve", "ready", "playing"),
    )

    fun lines(stats: Map<String, Any?>): List<String> = buildList {
        fun line(prefix: String, fields: Set<String>, keyPrefix: String = "") {
            val entries = fields.mapNotNull { field ->
                val raw = stats[keyPrefix + field]
                if ((field in sourceDeadlineEvidenceFields || field in retiredDeadlineEvidenceFields) && raw !is Number)
                    return@mapNotNull null
                if (field in retiredDeadlineIdentityFields && (raw !is Number || !raw.toDouble().isFinite() ||
                    raw.toDouble() < 0 || raw.toDouble() > 9_007_199_254_740_991.0 || raw.toDouble() % 1.0 != 0.0))
                    return@mapNotNull null
                if (field in renderDurationFields && (raw !is Number || !raw.toDouble().isFinite() ||
                    raw.toDouble() < 0 || raw.toDouble() > 9_007_199_254_740_991.0))
                    return@mapNotNull null
                if (field == "renderUnderrunEvents" && (raw !is Number || !raw.toDouble().isFinite() ||
                    raw.toDouble() < 0 || raw.toDouble() > 9_007_199_254_740_991.0 || raw.toDouble() % 1.0 != 0.0))
                    return@mapNotNull null
                if (field == "outputTimestampFitGeneration" && (raw !is Number || !raw.toDouble().isFinite() ||
                    raw.toDouble() < 0 || raw.toDouble() > 9_007_199_254_740_991.0 || raw.toDouble() % 1.0 != 0.0))
                    return@mapNotNull null
                if (field == "outputTimestampFitUncertaintyMs" && (raw !is Number || !raw.toDouble().isFinite() ||
                    raw.toDouble() < 0 || raw.toDouble() > 3)) return@mapNotNull null
                if ((field in voicePreparationFrameFields || field == "voiceWaitMs") &&
                    (raw !is Number || !raw.toDouble().isFinite() || raw.toDouble() < 0 ||
                        raw.toDouble() > 9_007_199_254_740_991.0 ||
                        field in voicePreparationFrameFields && raw.toDouble() % 1.0 != 0.0)) return@mapNotNull null
                if ((field == "contextObservedStateChanges" || field == "contextObservedNonRunningMs") &&
                    (raw !is Number || !raw.toDouble().isFinite() || raw.toDouble() < 0 ||
                        raw.toDouble() > 9_007_199_254_740_991.0 ||
                        field == "contextObservedStateChanges" && raw.toDouble() % 1.0 != 0.0)) return@mapNotNull null
                val choices = enumFields[field]
                if (choices != null && (raw !is String || raw !in choices)) return@mapNotNull null
                val precision = if (field == "sourceClockDispersionMs" || field == "deviceClockUncertaintyMs" ||
                    field == "deviceClockFitDispersionMs" || field == "outputTimestampFitUncertaintyMs" || field in sourceDeadlineEvidenceFields ||
                    field in retiredDeadlineEvidenceFields || field in renderDurationFields) 6 else 3
                val value = value(raw, precision) ?: return@mapNotNull null
                "$field=$value"
            }
            val header = "Browser audio: $prefix"
            var current = StringBuilder(header)
            for (entry in entries) {
                if (current.length > header.length && current.length + 1 + entry.length > LINE_BUDGET) {
                    add(current.toString())
                    current = StringBuilder(header)
                }
                current.append(' ').append(entry)
            }
            if (current.length > header.length) add(current.toString())
        }
        line("stage=SNAPSHOT", globalFields)
        line("stage=DECODE", decoderFields, "decoder.")
        val streams = stats.keys.mapNotNull { streamKey.matchEntire(it)?.groupValues?.get(1)?.toIntOrNull() }
            .filter { it in 0..255 }.toSortedSet()
        for (stream in streams) {
            line("stage=STREAM stream=$stream", streamFields, "stream$stream.")
            line("stage=DECODE stream=$stream", decoderStreamFields, "decoder.stream$stream.")
        }
    }

    private fun value(value: Any?, precision: Int): String? = when (value) {
        is Number -> value.toDouble().takeIf { it.isFinite() }?.let {
            if (it % 1.0 == 0.0 && kotlin.math.abs(it) < 9e15) it.toLong().toString()
            else String.format(Locale.ROOT, "%.${precision}f", it)
        }
        is Boolean -> value.toString()
        is String -> value.takeIf(safeText::matches)
        else -> null
    }
}
