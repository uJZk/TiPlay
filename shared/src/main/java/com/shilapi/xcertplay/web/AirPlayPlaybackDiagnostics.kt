package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.diagnostics.DiagnosticErrorText
import com.shilapi.xcertplay.diagnostics.RawTraffic

/** Fixed metadata and bounded error text with resource locations and credentials removed. */
internal class AirPlayPlaybackDiagnostics(
    private val log: (String) -> Unit,
    private val debug: () -> Boolean = { RawTraffic.enabled },
    private val nowMillis: () -> Long = { System.nanoTime() / 1_000_000 },
) {
    private var lastReport: String? = null
    private var lastReportMillis = 0L
    private var lastEngineSignature: String? = null
    private var lastEngineMillis = Long.MIN_VALUE
    private var lastStalledIdentity: String? = null
    private var lastErrorSignature: String? = null
    private var errorCleanupPending = false
    private var lastAudioContinuity: String? = null
    private var lastStartupPhase: String? = null

    @Synchronized fun report(id: Long, fields: Map<*, *>, accepted: Boolean) {
        val flags = "id=$id revision=${whole(fields["revision"])} accepted=$accepted " +
            REPORT_FLAGS.joinToString(" ") { "$it=${flag(fields[it])}" } + " rate=${number(fields["rate"])}"
        val now = nowMillis()
        if (flags == lastReport && now - lastReportMillis < 5_000) return
        lastReport = flags
        lastReportMillis = now
        emit("browser video stage=REPORT $flags " + times(fields))
    }

    fun command(id: Long, action: String, value: Double?, accepted: Boolean) {
        val verb = action.takeIf { it in ACTIONS } ?: "OTHER"
        emit("browser video stage=COMMAND id=$id action=$verb target=${number(value)} accepted=$accepted")
    }

    @Synchronized fun event(id: Long, fields: Map<*, *>, active: Boolean) {
        val event = (fields["event"] as? String)?.takeIf { it in EVENTS } ?: return
        if (active && event in setOf("open", "resync", "proxy-fallback")) {
            lastStalledIdentity = null; lastEngineSignature = null
            lastErrorSignature = null; errorCleanupPending = false
            lastAudioContinuity = null
            lastStartupPhase = null
        }
        val error = (fields["errorName"] as? String)?.takeIf { it in ERRORS } ?: "OTHER"
        if (event != "engine-state") emit("browser video stage=EVENT id=$id revision=${whole(fields["revision"])} event=$event active=$active " +
            times(fields) + " " + EVENT_FLAGS.joinToString(" ") { "$it=${flag(fields[it])}" } +
            " readyState=${bounded(fields["readyState"], 4)} networkState=${bounded(fields["networkState"], 3)}" +
            // The saved-report privacy filter reserves name= fields for personal device names.
            " errorCode=${bounded(fields["errorCode"], 5)} errorType=$error" +
            " errorText=${DiagnosticErrorText.sanitize(fields["errorText"] as? String)}")
        engine(id, fields, active)
    }

    /** One active player, fixed scalar groups and a second rate limit at the log admission boundary. */
    private fun engine(id: Long, fields: Map<*, *>, active: Boolean) {
        if (!active) return
        val source = fields["engine"] as? Map<*, *> ?: return
        val values = linkedMapOf<String, String>()
        ENGINE_ENUMS.forEach { (key, allowed) ->
            values[key] = (source[key] as? String)?.takeIf { it in allowed } ?: "unknown"
        }
        ENGINE_FLAGS.forEach { values[it] = flag(source[it]) }
        ENGINE_NUMBERS.forEach { key ->
            val value = (source[key] as? Number)?.toDouble()
            values[key] = when {
                key in ENGINE_DIMENSIONS && value != null && value > 32768 -> "unknown"
                key == "resourceLastStatus" && value != null && value != 0.0 && value !in 100.0..599.0 -> "unknown"
                key in AUDIO_RATES && value != null && value !in 3000.0..384000.0 -> "unknown"
                key == "audioSourceChannels" && value != null && value !in 1.0..8.0 -> "unknown"
                else -> engineNumber(source[key], key in ENGINE_WHOLE, key in ENGINE_SIGNED)
            }
        }
        values["codec"] = (source["codec"] as? String)?.takeIf { it.length <= 48 && CODEC.matches(it) } ?: "unknown"
        val stalled = values["intentPlaying"] == "true" && values["running"] == "false"
        val revision = whole(fields["revision"])
        val identity = "$id:$revision:${values["generation"]}"
            .takeIf { revision != "unknown" && values["generation"] != "unknown" }
        if (lastStalledIdentity != null && identity != lastStalledIdentity) lastStalledIdentity = null
        val recovered = !stalled && values["running"] == "true" && values["intentPlaying"] == "true" &&
            values["waitReason"] != "error" && identity != null && identity == lastStalledIdentity
        if (values["intentPlaying"] == "false") lastStalledIdentity = null
        val semanticFailure = fields["event"] in FAILURE_EVENTS
        val errorState = values["waitReason"] == "error"
        val errorSignature = "$identity " + values.filterKeys { it !in ERROR_VOLATILE_FIELDS }.toString()
        val errorBoundary = semanticFailure || (errorState &&
            (lastErrorSignature == null || (errorCleanupPending && errorSignature != lastErrorSignature)))
        val now = nowMillis()
        val continuity = "$identity " + AUDIO_CONTINUITY_COUNTERS.joinToString(" ") { values[it] ?: "unknown" }
        val continuityChanged = continuity != lastAudioContinuity && AUDIO_CONTINUITY_COUNTERS.any {
            values[it]?.toDoubleOrNull()?.let { value -> value > 0 } == true
        }
        // Continuity observations include legitimate silent introductions; they are not error labels.
        val audioBoundary = identity != null && continuityChanged &&
            (lastEngineSignature == null || now - lastEngineMillis >= 5_000)
        // Standard keeps one same-identity recovery edge; healthy periodic summaries are Debug only.
        val startupPhase = values["startupPhase"].takeUnless { it == "unknown" || it == "none" }
        val startupBoundary = startupPhase != null && startupPhase != lastStartupPhase
        if (!stalled && !recovered && !errorState && !semanticFailure && !audioBoundary && !startupBoundary && !debug()) return
        val prefix = "id=$id revision=$revision generation=${values["generation"]} active=true stalled=$stalled recovered=$recovered"
        val signature = prefix + ENGINE_SIGNATURE.joinToString(" ") { "$it=${values[it]}" }
        if (!errorBoundary && !audioBoundary && lastEngineSignature != null) {
            val elapsed = now - lastEngineMillis
            if (elapsed < 250 || (signature == lastEngineSignature && elapsed < if (stalled || errorState) 5_000 else 10_000)) return
        }
        lastEngineSignature = signature; lastEngineMillis = now
        lastStalledIdentity = if (stalled && !errorState && !semanticFailure) identity else null
        lastErrorSignature = if (errorState || semanticFailure) errorSignature else null
        errorCleanupPending = semanticFailure
        lastAudioContinuity = continuity
        lastStartupPhase = startupPhase
        ENGINE_GROUPS.forEach { (stage, keys) ->
            val boundary = when (stage) {
                "ENGINE_CODEC" -> " actualHardware=unknown poolCapacity=unknown vendorBuffers=unknown"
                "ENGINE_OWNERSHIP" -> " bytes=app-rgba8-estimate samples=engine close=successful"
                else -> ""
            }
            emit("browser video stage=$stage $prefix " + keys.joinToString(" ") { "$it=${values[it]}" } + boundary)
        }
    }

    private fun engineNumber(value: Any?, whole: Boolean, signed: Boolean = false): String {
        val number = (value as? Number)?.toDouble()?.takeIf { it.isFinite() && (signed || it >= 0) && kotlin.math.abs(it) <= 9_007_199_254_740_991.0 &&
            (!whole || it == Math.floor(it)) }
            ?: return "unknown"
        return if (number == Math.floor(number)) number.toLong().toString()
            else if (kotlin.math.abs(number) < 1e12) (Math.round(number * 1_000) / 1_000.0).toString() else number.toString()
    }

    private fun times(fields: Map<*, *>) = listOf("position", "duration", "bufferedPosition")
        .joinToString(" ") { "$it=${number(fields[it])}" }

    private fun flag(value: Any?) = (value as? Boolean)?.toString() ?: "unknown"
    private fun number(value: Any?) = (value as? Number)?.toDouble()
        ?.takeIf { it.isFinite() && it >= 0 }?.toString() ?: "unknown"
    private fun whole(value: Any?) = (value as? Number)?.toDouble()
        ?.takeIf { it.isFinite() && it >= 0 && it <= 9_007_199_254_740_991.0 && it == Math.floor(it) }
        ?.toLong()?.toString() ?: "unknown"
    private fun bounded(value: Any?, maximum: Int) = whole(value)
        .takeIf { it.toLongOrNull()?.let { number -> number <= maximum } == true } ?: "unknown"
    private fun emit(message: String) { runCatching { log(message) } }

    companion object {
        private val ACTIONS = setOf("play", "pause", "seek", "rate", "stop")
        private val REPORT_FLAGS = listOf("playing", "ready", "buffering", "seekable", "ended", "failed")
        private val EVENT_FLAGS = listOf("paused", "ended", "seeking", "dragging")
        private val EVENTS = setOf("open", "probe-start", "probe-ready", "open-error", "directive-seek",
            "directive-play", "directive-pause", "play-resolved", "play-rejected", "loadedmetadata",
            "play", "pause", "waiting", "playing", "seeking", "seeked", "ratechange", "ended", "error",
            "drag-start", "drag-end", "drag-cancel", "canvas-error", "explicit-stop", "proxy-fallback", "resync", "engine-state")
        private val ERRORS = setOf("NotAllowedError", "AbortError", "NotSupportedError", "InvalidStateError",
            "SecurityError", "TypeError", "RangeError", "NetworkError", "EncodingError", "TimeoutError")
        private val ENGINE_ENUMS = mapOf(
            "startupPhase" to setOf("none", "dependencies", "video-selection", "audio-selection", "audio-menu",
                "metadata", "first-samples", "ready", "playing"),
            "waitReason" to setOf("none", "no-source", "paused", "seeking", "preparing", "ended", "error",
                "video-starved", "audio-starved", "timeline-gap", "startup-watermark", "resume-watermark",
                "audio-context-suspended", "audio-context-resume", "audio-context-closed", "clock-stalled",
                "video-budget", "audio-budget", "unknown"),
            "renderStatsState" to setOf("available", "unavailable", "invalid", "failed"),
            "audioOutputTimestampState" to setOf("unavailable", "closed", "format-mismatch", "startup", "invalid", "future", "context-ahead", "valid", "failed"),
            "audioVideoSyncState" to setOf("unavailable", "inactive", "no-video-reference", "no-output-timestamp", "stale-output-timestamp", "output-timestamp-discontinuity", "no-submitted-audio", "native-output-and-video-frame"),
            "audioTempoBackend" to setOf("none", "wasm-simd", "wasm", "soundtouchjs"),
            "contextState" to setOf("running", "suspended", "interrupted", "closed", "unavailable", "unknown"),
            "clockSource" to setOf("audio", "performance", "unknown"),
            "limitingTrack" to setOf("video", "audio", "both", "none", "unknown"),
            "startReason" to setOf("none", "watermark", "video-budget", "audio-budget", "end-of-stream", "read-progress-fallback"),
            "requestedHardwareAcceleration" to setOf("no-preference", "prefer-hardware", "prefer-software", "unknown"),
            "hardwareSupportProbe" to setOf("supported", "unsupported", "unavailable", "error", "unknown"),
            "requestedVideoLatencyHint" to setOf("not-requested", "realtime", "quality", "unknown"),
            "requestedAudioLatencyHint" to setOf("interactive", "balanced", "playback", "not-requested", "unknown"),
            "resourceLastResult" to setOf("idle", "success", "eof", "cancelled", "timeout", "http-error", "error", "unknown"),
        )
        private val ENGINE_FLAGS = listOf("running", "intentPlaying", "resumePending", "hasPlayed", "videoBudgetBlocked",
            "videoDone", "audioDone", "videoReadPending", "audioReadPending", "userActivationHasBeenActive", "gestureRequired")
        private val ENGINE_NUMBERS = listOf("manualPlaybackRate", "automaticPlaybackRate", "effectivePlaybackRate", "audioAppliedTempo", "audioVideoSyncErrorMs", "audioVideoSyncMinimumMs", "audioVideoSyncMaximumMs", "audioSyncControlDelayMs", "audioSyncResponseMs",
            "openElapsedMs", "phaseElapsedMs", "generation", "clockTime", "clockPosition", "scheduledEnd", "position", "playableEnd",
            "videoEnd", "audioEnd", "targetMs", "videoFrames", "videoBytes", "audioChunks", "audioBytes", "stallElapsedMs", "stallCount",
            "videoCapacityFrames", "videoCapacityBytes", "videoCapacityAheadMs", "audioCapacityBytes", "audioCapacityAheadMs",
            "codedWidth", "codedHeight", "displayWidth", "displayHeight", "observedSampleCadenceMs", "observedSampleDurationMs",
            "videoHeldFrames", "videoHeldBytes", "videoPendingFrames", "videoPendingBytes", "videoOwnedFrames", "videoOwnedBytes",
            "samplesReceived", "samplesClosed", "videoSinkReadPendingMs", "lastSampleAgeMs", "videoHeldGeneration",
            "audioResumeRequests", "audioResumeCompleted", "audioResumeFailed", "readProgressFallbacks",
            "resourceActive", "resourceQueued", "resourceBytes", "resourceLastProgressAgeMs", "resourceTimeouts",
            "resourceCancellations", "resourceBackwardRestarts", "resourceRangeIgnored", "resourceLastStatus",
            "audioSourceRate", "audioRequestedContextRate", "audioContextRate", "audioSourceChannels",
            "audioDecodedFrames", "audioSeekTrimmedFrames", "audioOverlapTrimmedFrames", "audioAlignedPackets",
            "audioAlignmentMaxUs", "audioSilenceFrames", "audioScheduledFrames", "audioScheduleGapUs", "audioScheduleOverlapUs",
            "audioLateStarts", "audioLateStartMaxMs", "audioPcmPeak", "audioPcmOverFullScaleSamples", "audioNonFiniteSamples",
            "audioScheduleUnderruns", "audioScheduleUnderrunMs", "audioScheduleUnderrunMaxMs", "audioRebufferStops",
            "audioBaseLatencyMs", "audioOutputLatencyMs", "audioOutputTimestampAgeMs", "audioOutputContextLagMs",
            "audioSubmitUncertaintyMaxMs", "renderUnderrunEvents", "renderUnderrunDurationMs", "renderTotalDurationMs")
        private val ENGINE_WHOLE = setOf("generation", "videoFrames", "videoBytes", "audioChunks", "audioBytes", "stallCount",
            "videoCapacityFrames", "videoCapacityBytes", "audioCapacityBytes", "codedWidth", "codedHeight", "displayWidth", "displayHeight",
            "videoHeldFrames", "videoHeldBytes", "videoPendingFrames", "videoPendingBytes", "videoOwnedFrames", "videoOwnedBytes",
            "samplesReceived", "samplesClosed", "videoHeldGeneration", "audioResumeRequests", "audioResumeCompleted", "audioResumeFailed",
            "readProgressFallbacks", "resourceActive", "resourceQueued", "resourceBytes", "resourceTimeouts", "resourceCancellations",
            "resourceBackwardRestarts", "resourceRangeIgnored", "resourceLastStatus",
            "audioSourceRate", "audioRequestedContextRate", "audioContextRate", "audioSourceChannels",
            "audioDecodedFrames", "audioSeekTrimmedFrames", "audioOverlapTrimmedFrames", "audioAlignedPackets",
            "audioSilenceFrames", "audioScheduledFrames", "audioLateStarts", "audioPcmOverFullScaleSamples", "audioNonFiniteSamples",
            "audioScheduleUnderruns", "audioRebufferStops", "renderUnderrunEvents")
        private val AUDIO_RATES = setOf("audioSourceRate", "audioRequestedContextRate", "audioContextRate")
        private val AUDIO_CONTINUITY_COUNTERS = listOf("audioOverlapTrimmedFrames", "audioSilenceFrames", "audioScheduleGapUs",
            "audioScheduleOverlapUs", "audioLateStarts", "audioPcmOverFullScaleSamples", "audioNonFiniteSamples",
            "audioScheduleUnderruns", "audioRebufferStops")
        private val ENGINE_SIGNED = setOf("audioVideoSyncErrorMs", "audioVideoSyncMinimumMs", "audioOutputTimestampAgeMs", "audioOutputContextLagMs")
        private val ENGINE_DIMENSIONS = setOf("codedWidth", "codedHeight", "displayWidth", "displayHeight")
        private val FAILURE_EVENTS = setOf("error", "open-error", "canvas-error", "play-rejected")
        private val ERROR_VOLATILE_FIELDS = setOf("clockTime", "clockPosition", "position", "playableEnd", "videoEnd", "audioEnd",
            "scheduledEnd", "stallElapsedMs", "lastSampleAgeMs", "videoSinkReadPendingMs", "resourceLastProgressAgeMs")
        private val CODEC = Regex("(?:avc|h264|hevc|h265|vp8|vp9|av1|avc1|avc3|hvc1|hev1|vp09|av01|mp4v)(?:\\.[a-z0-9]{1,16}){0,9}", RegexOption.IGNORE_CASE)
        private val ENGINE_SIGNATURE = listOf("startupPhase", "running", "intentPlaying", "waitReason", "contextState", "resumePending",
            "clockSource", "limitingTrack", "videoBudgetBlocked", "videoDone", "audioDone", "gestureRequired", "startReason", "stallCount")
        private val ENGINE_GROUPS = mapOf(
            "ENGINE_STATE" to listOf("waitReason", "running", "intentPlaying", "contextState", "resumePending", "clockSource",
                "clockTime", "clockPosition", "stallElapsedMs", "stallCount"),
            "ENGINE_BUFFER" to listOf("position", "playableEnd", "videoEnd", "audioEnd", "scheduledEnd", "targetMs", "hasPlayed", "limitingTrack",
                "videoCapacityAheadMs", "audioCapacityAheadMs", "startReason", "readProgressFallbacks"),
            "ENGINE_PIPELINE" to listOf("videoFrames", "videoBytes", "videoBudgetBlocked", "videoDone", "videoReadPending",
                "audioChunks", "audioBytes", "audioDone", "audioReadPending", "videoCapacityFrames", "videoCapacityBytes", "audioCapacityBytes"),
            "ENGINE_CODEC" to listOf("codec", "codedWidth", "codedHeight", "displayWidth", "displayHeight", "observedSampleCadenceMs",
                "observedSampleDurationMs", "requestedHardwareAcceleration", "hardwareSupportProbe", "requestedVideoLatencyHint"),
            "ENGINE_OWNERSHIP" to listOf("videoHeldFrames", "videoHeldBytes", "videoHeldGeneration", "videoPendingFrames", "videoPendingBytes",
                "videoOwnedFrames", "videoOwnedBytes", "samplesReceived", "samplesClosed", "videoSinkReadPendingMs", "lastSampleAgeMs"),
            "ENGINE_AUDIO" to listOf("audioResumeRequests", "audioResumeCompleted", "audioResumeFailed", "userActivationHasBeenActive",
                "gestureRequired", "requestedAudioLatencyHint", "audioBaseLatencyMs", "audioOutputLatencyMs",
                "audioOutputTimestampState", "audioOutputTimestampAgeMs", "audioOutputContextLagMs", "audioSubmitUncertaintyMaxMs"),
            "ENGINE_NETWORK" to listOf("resourceActive", "resourceQueued", "resourceBytes", "resourceLastProgressAgeMs", "resourceLastResult",
                "resourceTimeouts", "resourceCancellations", "resourceBackwardRestarts", "resourceRangeIgnored", "resourceLastStatus"),
            "ENGINE_PCM" to listOf("audioTempoBackend", "audioSourceRate", "audioRequestedContextRate", "audioContextRate", "audioSourceChannels",
                "audioDecodedFrames", "audioSeekTrimmedFrames", "audioOverlapTrimmedFrames",
                "manualPlaybackRate", "automaticPlaybackRate", "effectivePlaybackRate", "audioAppliedTempo"),
            "ENGINE_CONTINUITY" to listOf("audioAlignedPackets", "audioAlignmentMaxUs", "audioSilenceFrames", "audioPcmPeak",
                "audioPcmOverFullScaleSamples", "audioNonFiniteSamples"),
            "ENGINE_RENDER" to listOf("renderStatsState", "renderUnderrunEvents", "renderUnderrunDurationMs", "renderTotalDurationMs",
                "audioVideoSyncState", "audioVideoSyncErrorMs", "audioVideoSyncMinimumMs", "audioVideoSyncMaximumMs"),
            "ENGINE_STARTUP" to listOf("startupPhase", "openElapsedMs", "phaseElapsedMs"),
            "ENGINE_SCHEDULE" to listOf("audioScheduledFrames", "audioScheduleGapUs", "audioScheduleOverlapUs", "audioLateStarts", "audioLateStartMaxMs",
                "audioScheduleUnderruns", "audioScheduleUnderrunMs", "audioScheduleUnderrunMaxMs", "audioRebufferStops",
                "audioSyncControlDelayMs", "audioSyncResponseMs"),
        )
    }
}
