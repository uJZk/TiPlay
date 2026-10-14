package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.diagnostics.DiagnosticErrorText

/** Fixed metadata and bounded error text with resource locations and credentials removed. */
internal class AirPlayPlaybackDiagnostics(
    private val log: (String) -> Unit,
    private val nowMillis: () -> Long = { System.nanoTime() / 1_000_000 },
) {
    private var lastReport: String? = null
    private var lastReportMillis = 0L

    @Synchronized fun report(id: Long, fields: Map<*, *>, accepted: Boolean) {
        val flags = "id=$id revision=${whole(fields["revision"])} accepted=$accepted " +
            REPORT_FLAGS.joinToString(" ") { "$it=${flag(fields[it])}" }
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

    fun event(id: Long, fields: Map<*, *>, active: Boolean) {
        val event = (fields["event"] as? String)?.takeIf { it in EVENTS } ?: return
        val error = (fields["errorName"] as? String)?.takeIf { it in ERRORS } ?: "OTHER"
        emit("browser video stage=EVENT id=$id revision=${whole(fields["revision"])} event=$event active=$active " +
            times(fields) + " " + EVENT_FLAGS.joinToString(" ") { "$it=${flag(fields[it])}" } +
            " readyState=${bounded(fields["readyState"], 4)} networkState=${bounded(fields["networkState"], 3)}" +
            // The saved-report privacy filter reserves name= fields for personal device names.
            " errorCode=${bounded(fields["errorCode"], 5)} errorType=$error" +
            " errorText=${DiagnosticErrorText.sanitize(fields["errorText"] as? String)}")
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
        private val ACTIONS = setOf("play", "pause", "seek", "stop")
        private val REPORT_FLAGS = listOf("playing", "ready", "buffering", "seekable", "ended", "failed")
        private val EVENT_FLAGS = listOf("paused", "ended", "seeking", "dragging")
        private val EVENTS = setOf("open", "probe-start", "probe-ready", "open-error", "directive-seek",
            "directive-play", "directive-pause", "play-resolved", "play-rejected", "loadedmetadata",
            "play", "pause", "waiting", "playing", "seeking", "seeked", "ended", "error",
            "drag-start", "drag-end", "drag-cancel", "canvas-error", "explicit-stop")
        private val ERRORS = setOf("NotAllowedError", "AbortError", "NotSupportedError", "InvalidStateError",
            "SecurityError", "TypeError", "RangeError", "NetworkError", "EncodingError")
    }
}
