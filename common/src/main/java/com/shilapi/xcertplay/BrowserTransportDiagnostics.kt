package com.shilapi.xcertplay

import java.util.Locale

/** Browser metadata is untrusted. Keep fixed scalar fields, never SDP, candidates or credentials. */
internal class BrowserTransportDiagnostics(
    private val log: (String) -> Unit,
    private val nowMillis: () -> Long = { System.nanoTime() / 1_000_000 },
) {
    private var lastState: String? = null
    private var lastFailure: String? = null
    private var lastDebug: Long? = null
    private var lastAudioUnavailable: String? = null
    private var generation: String? = null
    private var counters = emptyMap<String, Double>()
    private var capacityScope: Pair<String, String>? = null
    private var policyScope = emptyMap<String, String>()
    private var policySnapshot = emptyMap<String, String>()

    @Synchronized fun report(source: Map<String, Any?>, debug: Boolean) {
        val stats = normalized(source)
        val values = FIELDS.flatten().mapNotNull { key -> scalar(key, stats[key])?.let { key to it } }.toMap()
        if (values.isEmpty()) return
        values["transport.generation"]?.let {
            if (it != generation) counters = counters.filterKeys { key -> key.startsWith("audio.") }
            generation = it
        }
        val videoScope = videoScope(values)
        if (videoScope != null) {
            if (capacityScope != null && capacityScope != videoScope) counters = counters - "video.scheduledCapacityFrames"
            capacityScope = videoScope
        }
        val policyChanged = policyBoundary(values)
        val state = STATE_FIELDS.joinToString("|") { values[it].orEmpty() }
        val nextCounters = ERROR_COUNTERS.mapNotNull { key ->
            if (key == "video.scheduledCapacityFrames") {
                if (videoScope == null) return@mapNotNull null
                // This epoch-scoped counter enters failure admission only after scalar validation.
                values[key]?.toDoubleOrNull()?.let { key to it }
            } else (stats[key] as? Number)?.toDouble()?.takeIf(Double::isFinite)?.let { key to it }
        }.toMap()
        val increased = nextCounters.any { (key, value) -> value > (counters[key] ?: 0.0) }
        val previousAudioRejected = counters["audio.sourceDeadlineRejectedFrames"]
        counters = counters + nextCounters
        val reason = values["transport.reason"]
        val failed = values["transport.state"] == "failed" ||
            (reason != null && reason !in NORMAL_END_REASONS) ||
            values["audio.sourceDeadlineState"] == "violated" ||
            values["video.decodeStalled"] in setOf("true", "1")
        val audioState = listOf("audio.sourceDeadlineStream", "audio.sourceDeadlineEpoch", "audio.sourceDeadlineState", "audio.sourceDeadlineReason")
            .joinToString("|") { values[it].orEmpty() }
        val audioUnavailable = values["audio.sourceDeadlineState"] == "unknown" &&
            values["audio.sourceDeadlineReason"] in IMPORTANT_UNKNOWN_REASONS
        val newUnavailable = audioUnavailable && audioState != lastAudioUnavailable
        if (audioUnavailable) lastAudioUnavailable = audioState
        val failure = state + "|" + audioState + "|" + ERROR_COUNTERS.joinToString("|") { values[it].orEmpty() }
        val newFailure = increased || (failed && failure != lastFailure)
        lastFailure = if (failed || increased) failure else null
        val stateChanged = values.keys.any { it.startsWith("transport.") } && state != lastState
        if (stateChanged) lastState = state
        val now = nowMillis()
        val debugDue = debug && (lastDebug?.let { now - it >= 10_000 } != false || newFailure || stateChanged)
        if (debugDue) lastDebug = now
        if (!newFailure && !stateChanged && !debugDue && !newUnavailable && !policyChanged) return
        for ((index, fields) in FIELDS.withIndex()) {
            if (index == POLICY_INDEX) {
                if (videoScope == null || !POLICY_VALUES.any(values::containsKey) || (!newFailure && !stateChanged && !debugDue && !policyChanged)) continue
            } else {
                if (!newFailure && !stateChanged && !debugDue && !newUnavailable) continue
                if (index >= 2 && !newFailure && !debugDue && !(index == 4 && newUnavailable)) continue
            }
            val audioFailure = index == 4 && (nextCounters["audio.sourceDeadlineRejectedFrames"] ?: 0.0) > (previousAudioRejected ?: 0.0)
            val scope = if (index == POLICY_INDEX) " streamGeneration=${values["video.streamGeneration"] ?: "unknown"}" +
                " epoch=${values["video.epoch"] ?: "unknown"}" else ""
            val prefix = "Browser transport: stage=${STAGES[index]} generation=${values["transport.generation"] ?: "unknown"} failed=$newFailure" +
                scope + if (audioFailure) " reason=source-deadline" else ""
            var line = StringBuilder(prefix)
            for (key in fields) {
                if (key == "transport.generation" || (index == POLICY_INDEX && key in POLICY_SCOPE)) continue
                val value = values[key] ?: continue
                val entry = "${key.substringAfter('.')}=$value"
                if (line.length > prefix.length && line.length + entry.length + 1 > LINE_BUDGET) {
                    emit(line.toString())
                    line = StringBuilder(prefix)
                }
                line.append(' ').append(entry)
            }
            if (line.length > prefix.length) emit(line.toString())
        }
    }

    /** Compare only known same-stream observations. Ages and convergence estimates never
     * create a Standard event; cumulative touch edges survive a short interaction between reports. */
    private fun videoScope(values: Map<String, String>): Pair<String, String>? {
        val stream = values["video.streamGeneration"] ?: return null
        val epoch = values["video.epoch"] ?: return null
        return stream to epoch
    }

    private fun policyBoundary(values: Map<String, String>): Boolean {
        if (videoScope(values) == null) return false
        val scope = POLICY_SCOPE.mapNotNull { key -> values[key]?.let { key to it } }.toMap()
        if (scope.any { (key, value) -> policyScope[key]?.let { it != value } == true }) policySnapshot = emptyMap()
        policyScope = policyScope + scope
        val next = POLICY_VALUES.mapNotNull { key -> values[key]?.let { key to it } }.toMap()
        val profileChanged = next["video.playbackProfile"]?.let { value ->
            policySnapshot["video.playbackProfile"]?.let { it != value }
        } == true
        val interactionChanged = POLICY_COUNTERS.any { key ->
            val previous = policySnapshot[key]?.toDoubleOrNull()
            val current = next[key]?.toDoubleOrNull()
            previous != null && current != null && current > previous
        }
        val clockChanged = POLICY_CLOCK_STATES.any { key ->
            next[key]?.let { value -> policySnapshot[key]?.let { it != value } } == true
        }
        policySnapshot = policySnapshot + next
        return profileChanged || interactionChanged || clockChanged
    }

    private fun emit(line: String) { runCatching { log(line) } }

    /** Ordinary st telemetry is already flat. Accept both deployed RTC layouts without
     * turning missing counters into zero or interpreting candidate addresses/SDP. */
    private fun normalized(source: Map<String, Any?>): Map<String, Any?> = source.toMutableMap().apply {
        fun alias(target: String, vararg candidates: String) {
            if (this[target] == null) candidates.firstNotNullOfOrNull { source[it] }?.let { this[target] = it }
        }
        alias("transport.reason", "link.failure.reason")
        alias("transport.stage", "link.failure.stage", "link.connection.stage")
        alias("transport.iceState", "transport.ice.connectionState", "link.failure.iceState", "link.connection.iceState")
        alias("transport.connectionState", "link.failure.connectionState", "link.connection.connectionState", "transport.state")
        alias("transport.selectedProtocol", "transport.ice.protocol")
        alias("transport.rttMs", "transport.ice.currentRoundTripTimeMs")
        alias("transport.localCandidateType", "transport.ice.localCandidateType")
        alias("transport.remoteCandidateType", "transport.ice.remoteCandidateType")
        alias("transport.statsErrors", "transport.ice.errors")
        alias("transport.controlFailures", "control.failures")
        for (field in listOf("localCandidates", "localUdpCandidates", "remoteCandidates", "remoteUdpCandidates")) {
            alias("transport.$field", "link.failure.$field", "link.connection.$field")
        }
        if (this["transport.state"] == null && source["link.phase"] == "retry" && source["link.failure.reason"] is String) {
            this["transport.state"] = "failed"
        }
    }

    private fun scalar(key: String, value: Any?): String? {
        POLICY_ENUMS[key]?.let { allowed -> return (value as? String)?.takeIf { it in allowed } }
        if (key == "video.policyInteractionActive") return when (value) {
            is Boolean -> value.toString()
            is Number -> when (value.toDouble()) { 0.0 -> "false"; 1.0 -> "true"; else -> null }
            else -> null
        }
        if (key in POLICY_NUMBERS || key in POLICY_SCOPE || key == "video.scheduledCapacityFrames") {
            val number = (value as? Number)?.toDouble()?.takeIf { it.isFinite() && it >= 0 && it <= 9_007_199_254_740_991.0 &&
                (key !in POLICY_WHOLE && key != "video.scheduledCapacityFrames" || it % 1.0 == 0.0) } ?: return null
            return if (number % 1.0 == 0.0) number.toLong().toString() else numeric(number)
        }
        return when (value) {
            is Number -> value.toDouble().takeIf(Double::isFinite)?.let(::numeric)
            is Boolean -> value.toString()
            is String -> value.takeIf { key in TEXT_FIELDS && SAFE_TEXT.matches(it) }
            else -> null
        }
    }

    private fun numeric(value: Double) = if (value % 1.0 == 0.0 && kotlin.math.abs(value) < 9e15) value.toLong().toString()
        else String.format(Locale.ROOT, "%.3f", value)

    companion object {
        private const val LINE_BUDGET = 600
        private val SAFE_TEXT = Regex("[A-Za-z0-9._-]{1,48}")
        private val NORMAL_END_REASONS = setOf("none", "stopped", "transport-closed", "video-cancelled")
        private val STATE_FIELDS = listOf("transport.transport", "transport.state", "transport.stage", "transport.reason",
            "transport.generation", "transport.iceState", "transport.connectionState")
        private val ERROR_COUNTERS = listOf("transport.reassemblyErrors", "transport.controlFailures", "transport.iceCandidateErrors",
            "transport.statsErrors", "video.decodeErrors", "video.decodeStalls", "video.decodedResourceDroppedFrames", "video.scheduledCapacityFrames",
            "audio.sourceDeadlineRejectedFrames")
        private val TEXT_FIELDS = setOf("transport.transport", "transport.state", "transport.stage", "transport.reason",
            "transport.iceState", "transport.connectionState", "transport.selectedProtocol", "transport.localCandidateType",
            "transport.remoteCandidateType", "video.playbackProfile",
            "audio.sourceDeadlineState", "audio.sourceDeadlineReason", "audio.sourceDeadlineStream")
        private val IMPORTANT_UNKNOWN_REASONS = setOf("source-anchor-unavailable", "output-clock-unavailable", "clock-uncertainty-unavailable")
        private val POLICY_SCOPE = listOf("transport.generation", "video.streamGeneration", "video.epoch")
        private val POLICY_COUNTERS = listOf("video.policyInteractionStarts", "video.policyInteractionReleases", "video.policyProfileSwitches")
        private val POLICY_ENUMS = mapOf(
            "video.playbackProfile" to setOf("default", "carplay", "carplay-touch", "airplay-mirror", "airplay-cast", "airplay-audio"),
            "video.policyTargetReason" to setOf("initial", "touch", "readiness", "initial-floor", "ceiling"),
            "video.sourceClockState" to setOf("fresh", "stale", "unavailable"),
            "video.clockEstimatorState" to setOf("unavailable", "suspended", "pending-jump", "observation-stale", "selected-stale", "fresh"),
        )
        private val POLICY_CLOCK_STATES = listOf("video.sourceClockState", "video.clockEstimatorState")
        private val POLICY_NUMBERS = listOf("policyVideoReadinessMs", "policyVideoMarginMs", "policyVideoTargetMs", "policyVideoPlanFromMs",
            "policyVideoPlanDurationMs", "policyVideoPlanRemainingMs", "policyVideoLeadRemainingMs", "policyHoldRemainingMs",
            "policyInteractionStarts", "policyInteractionReleases", "policyProfileSwitches", "policyPlanChanges", "policyMaxDelayMs",
            "policyMaxVideoFrames", "policyMaxVideoBytes", "policySubmitMarginMs", "sourceClockAgeMs", "sourceClockGeneration", "sourceClockMaxAgeMs", "clockEstimatorObservationAgeMs", "clockEstimatorSelectedAgeMs")
            .map { "video.$it" }.toSet()
        private val POLICY_WHOLE = (POLICY_COUNTERS + POLICY_SCOPE + listOf("video.policyPlanChanges", "video.policyMaxVideoFrames", "video.policyMaxVideoBytes",
            "video.sourceClockGeneration")).toSet()
        private val POLICY_VALUES = listOf("video.playbackProfile", "video.policyInteractionActive", "video.policyTargetReason", "video.sourceClockState",
            "video.clockEstimatorState", "video.stageClockUncertaintyMs") + POLICY_NUMBERS
        private val POLICY_FIELDS = listOf("video.streamGeneration", "video.epoch") + POLICY_VALUES
        private const val POLICY_INDEX = 6
        private val STAGES = listOf("STATE", "CANDIDATES", "FLOW", "PIPELINE", "AUDIO", "SENDER", "POLICY")
        private val FIELDS = listOf(
            STATE_FIELDS + listOf("transport.selectedProtocol", "transport.rttMs", "transport.localCandidateType", "transport.remoteCandidateType"),
            listOf("transport.localCandidates", "transport.localUdpCandidates", "transport.remoteCandidates", "transport.remoteUdpCandidates",
                "transport.iceCandidateErrors", "transport.lastIceCandidateErrorCode", "transport.statsErrors"),
            listOf("transport.queuedBytes", "transport.highWaterBytes", "transport.fragmentsReceived", "transport.bytesReceived",
                "transport.reassemblyErrors", "transport.recordsReceived", "transport.recordsConsumed", "transport.audioDiscardedRecords",
                "transport.controlRequests", "transport.controlFailures") + listOf("video", "audio").flatMap { kind ->
                listOf("retainedBytes", "consumedBytes", "queuedRecords", "partialBytes", "receivedRecords", "receivedFragments",
                    "peakRetainedBytes", "reassemblyMsMax", "consumerWaitMsMax").map { "transport.$kind.$it" }
            },
            listOf("video.streamGeneration", "video.epoch", "video.playbackProfile", "video.decodeQueueSize", "video.decodeErrors", "video.decodeStalled", "video.decodeStalls",
                "video.decodeBackpressureWaits", "video.decodeBackpressureMs", "video.decoderAbortedFrames", "video.decodeOnlyFrames",
                "video.decodedQueueFrames", "video.decodedQueueBytes", "video.decodedResourceDroppedFrames", "video.untimedScheduledFrames",
                "video.decodeInFlightFrames", "video.decodeInFlightBytes", "video.decodeDroppedFrames", "video.scheduledDroppedFrames",
                "video.transferDroppedFrames", "video.renderDroppedFrames", "video.pacingDroppedFrames", "video.droppedFrames", "video.scheduledCapacityFrames",
                "video.currentFps", "video.currentDelta", "video.lastDrawAgeMs", "video.frameIntervalP95Ms"),
            listOf("audio.sourceDeadlineState", "audio.sourceDeadlineReason", "audio.sourceDeltaUpperMs",
                "audio.sourceDeadlineRejectedFrames", "audio.sourceDeadlineStream", "audio.sourceDeadlineEpoch"),
            listOf("video", "audio").flatMap { kind ->
                listOf("queueBytes", "queueRecords", "queueLimitBytes", "oldestQueuedAgeMs", "receiverReservedBytes",
                    "receiverConsumedBytes", "receiverInFlightBytes", "oldestUnackedAgeMs", "nativeBufferedBytes",
                    "acceptedRecords", "recordsSent", "wireBytesSent").map { "sender.$kind.$it" }
            },
            POLICY_FIELDS,
        )
    }
}
