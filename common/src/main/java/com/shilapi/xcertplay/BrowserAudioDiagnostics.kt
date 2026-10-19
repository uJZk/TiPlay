package com.shilapi.xcertplay

import java.util.Locale

/** Scalar evidence only; paired browser telemetry must not become an arbitrary log-writing API. */
internal object BrowserAudioDiagnostics {
    private val globalFields = setOf(
        "pageVersion", "omittedFields", "contextState", "contextTimeMs", "contextRate", "clockBase",
        "clockOffsetMs", "clockAgeMs", "clockRttMs", "contextBaseLatencyMs", "contextOutputLatencyMs",
        "processorErrors", "recoveries", "recoveryAttempts", "processorFailed", "renderAgeMs", "renderReportAgeMs",
        "renderFrames", "renderNonzero", "renderPeak", "processCalls", "renderTimeMs",
        "pcmPackets", "pcmFrames", "pcmNonzero", "pcmPeak",
        "clockRatePpm", "clockGeneration", "clockUncertaintyMs", "clockRateConfidence",
        "deviceClockRatePpm", "deviceClockTargetRatePpm", "deviceClockConfidence", "deviceClockUncertaintyMs",
        "deviceClockGeneration", "deviceClockReason", "outputState", "outputUnavailableCount", "outputUnavailableReason",
        "outputTimestampContextMs", "outputTimestampPerformanceMs", "outputTimestampAgeMs", "outputRenderedContextMs", "outputFeedbackDeltaMs",
        "outputUnavailableCounts.context-suspended", "outputUnavailableCounts.timestamp-backwards",
        "outputUnavailableCounts.timestamp-stale", "outputUnavailableCounts.timestamp-invalid",
        "outputUnavailableCounts.missing-latency", "outputUnavailableCounts.latency-unbounded",
        "outputUnavailableCounts.invalid-feedback", "outputUnavailableCounts.feedback-distance",
    )
    private val streamFields = setOf(
        "epoch", "rate", "channels", "headMs", "tailMs", "playbackMs", "delayMs", "queueBytes", "queuePackets",
        "capacityPackets", "latePackets", "duplicatePackets", "playedPackets", "resetPackets", "invalidPackets",
        "capacityBytes", "lateBytes", "duplicateBytes", "playedBytes", "resetBytes", "invalidBytes", "mode", "semanticType", "anchoring",
        "state", "reason", "phaseErrorMs", "resampleRatePpm", "deviceRatePpm", "phaseCorrectionPpm", "sourceRatePpm", "sourceRateConfidence",
        "lastRecoveryReason", "recoveryCounts.clock-step", "recoveryCounts.underrun", "recoveryCounts.device-clock-reset",
    )
    private val decoderFields = setOf("packets", "frames", "nonzero", "peak", "errors")
    private val decoderStreamFields = setOf("packets", "frames", "nonzero", "peak", "backend", "epoch", "rate", "channels", "semanticType")
    private val streamKey = Regex("(?:decoder\\.)?stream([0-9]{1,3})\\..+")
    private val safeText = Regex("[A-Za-z0-9._-]{1,40}")

    fun lines(stats: Map<String, Any?>): List<String> = buildList {
        fun line(prefix: String, fields: Set<String>, keyPrefix: String = "") {
            val entries = fields.mapNotNull { field ->
                val value = value(stats[keyPrefix + field]) ?: return@mapNotNull null
                "$field=$value"
            }
            if (entries.isNotEmpty()) add("Browser audio: $prefix ${entries.joinToString(" ")}")
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

    private fun value(value: Any?): String? = when (value) {
        is Number -> value.toDouble().takeIf { it.isFinite() }?.let {
            if (it % 1.0 == 0.0 && kotlin.math.abs(it) < 9e15) it.toLong().toString()
            else String.format(Locale.ROOT, "%.3f", it)
        }
        is Boolean -> value.toString()
        is String -> value.takeIf(safeText::matches)
        else -> null
    }
}
