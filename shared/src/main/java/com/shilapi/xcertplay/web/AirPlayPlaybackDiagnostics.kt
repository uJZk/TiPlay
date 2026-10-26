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
                else -> engineNumber(source[key], key in ENGINE_WHOLE)
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
        // Standard keeps one same-identity recovery edge; healthy periodic summaries are Debug only.
        val startupPhase = values["startupPhase"].takeUnless { it == "unknown" || it == "none" }
        val startupBoundary = startupPhase != null && startupPhase != lastStartupPhase
        if (!stalled && !recovered && !errorState && !semanticFailure && !startupBoundary && !debug()) return
        val prefix = "id=$id revision=$revision generation=${values["generation"]} active=true stalled=$stalled recovered=$recovered"
        val signature = prefix + ENGINE_SIGNATURE.joinToString(" ") { "$it=${values[it]}" }
        if (!errorBoundary && lastEngineSignature != null) {
            val elapsed = now - lastEngineMillis
            if (elapsed < 250 || (signature == lastEngineSignature && elapsed < if (stalled || errorState) 5_000 else 10_000)) return
        }
        lastEngineSignature = signature; lastEngineMillis = now
        lastStalledIdentity = if (stalled && !errorState && !semanticFailure) identity else null
        lastErrorSignature = if (errorState || semanticFailure) errorSignature else null
        errorCleanupPending = semanticFailure
        lastStartupPhase = startupPhase
        ENGINE_GROUPS.forEach { (stage, keys) ->
            emit("browser video stage=$stage $prefix " + keys.joinToString(" ") { "$it=${values[it]}" })
        }
    }

    private fun engineNumber(value: Any?, whole: Boolean): String {
        val number = (value as? Number)?.toDouble()?.takeIf { it.isFinite() && it >= 0 && kotlin.math.abs(it) <= 9_007_199_254_740_991.0 &&
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
            "engine" to setOf("libmedia-avplayer"),
            "renderMode" to setOf("canvas"),
            "startupPhase" to setOf("none", "dependencies", "metadata", "first-samples", "ready", "playing"),
            "waitReason" to setOf("none", "no-source", "paused", "seeking", "preparing", "buffering", "ended", "error",
                "audio-context-suspended", "unknown"),
        )
        private val ENGINE_FLAGS = listOf("running", "intentPlaying", "gestureRequired")
        private val ENGINE_NUMBERS = listOf("generation", "position", "manualPlaybackRate", "effectivePlaybackRate",
            "openElapsedMs", "codedWidth", "codedHeight", "stallCount",
            "audioPacketQueueLength", "videoPacketQueueLength", "audioFrameDecodeCount", "videoFrameDecodeCount",
            "audioFrameRenderCount", "videoFrameRenderCount", "audioStutter", "videoStutter")
        private val ENGINE_WHOLE = setOf("generation", "codedWidth", "codedHeight", "stallCount",
            "audioPacketQueueLength", "videoPacketQueueLength", "audioFrameDecodeCount", "videoFrameDecodeCount",
            "audioFrameRenderCount", "videoFrameRenderCount", "audioStutter", "videoStutter")
        private val ENGINE_DIMENSIONS = setOf("codedWidth", "codedHeight")
        private val FAILURE_EVENTS = setOf("error", "open-error", "canvas-error", "play-rejected")
        private val ERROR_VOLATILE_FIELDS = setOf("position", "openElapsedMs")
        private val CODEC = Regex("(?:avc|h264|hevc|h265|vp8|vp9|av1|avc1|avc3|hvc1|hev1|vp09|av01|mp4v)(?:\\.[a-z0-9]{1,16}){0,9}", RegexOption.IGNORE_CASE)
        private val ENGINE_SIGNATURE = listOf("engine", "renderMode", "startupPhase", "running", "intentPlaying",
            "waitReason", "gestureRequired", "stallCount")
        private val ENGINE_GROUPS = mapOf(
            "ENGINE_STATE" to listOf("engine", "renderMode", "waitReason", "running", "intentPlaying", "gestureRequired",
                "position", "manualPlaybackRate", "effectivePlaybackRate", "stallCount"),
            "ENGINE_PIPELINE" to listOf("audioPacketQueueLength", "videoPacketQueueLength", "audioFrameDecodeCount", "videoFrameDecodeCount"),
            "ENGINE_RENDER" to listOf("audioFrameRenderCount", "videoFrameRenderCount", "audioStutter", "videoStutter"),
            "ENGINE_CODEC" to listOf("codec", "codedWidth", "codedHeight"),
            "ENGINE_STARTUP" to listOf("startupPhase", "openElapsedMs"),
        )
    }
}
