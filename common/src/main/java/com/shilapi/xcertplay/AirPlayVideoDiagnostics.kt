package com.shilapi.xcertplay

import com.shilapi.xcertplay.diagnostics.DiagnosticErrorText

/** Video metadata and sanitized failures; media, headers and raw URLs stay out of the log. */
internal class AirPlayVideoDiagnostics(private val log: (String) -> Unit) {
    enum class Stage { ENCODER_READY, PREPARE, ENCODER_CONFIG, ENCODED_FRAME }
    enum class ControlSource(val wire: String) { IPHONE("iphone"), BROWSER("browser") }
    enum class StopReason(val wire: String) {
        REPLACED("replaced"), BROWSER_STOP("browser-stop"), BROWSER_ENDED("browser-ended"),
        BROWSER_FAILED("browser-failed"), RECEIVER_STOP("receiver-stop"), PHOTO_FAILED("photo-failed"),
        SHUTDOWN("shutdown"),
    }

    fun stage(stage: Stage, value: Long? = null) = emit("video stage=$stage" + (value?.let { " value=$it" } ?: ""))

    fun failure(stage: Stage, error: Exception) {
        val type = error.javaClass.simpleName.filter { it.isLetterOrDigit() || it == '_' }.take(64)
        emit("video stage=FAILURE operation=$stage exception=$type errorText=${DiagnosticErrorText.sanitize(runCatching { error.message }.getOrNull())}")
    }

    fun control(source: ControlSource, action: String, value: Double?, generation: Long) {
        val safeAction = action.takeIf { it in setOf("play", "pause", "seek", "rate", "stop") } ?: "OTHER"
        val numeric = value?.takeIf { it.isFinite() && it in 0.0..1_000_000_000.0 }
        emit("video stage=CONTROL source=${source.wire} action=$safeAction generation=$generation" +
            (value?.let { " value=${numeric ?: "INVALID"}" } ?: ""))
    }

    fun stopped(reason: StopReason, generation: Long) =
        emit("video stage=STOP reason=${reason.wire} generation=$generation")

    fun callback(state: String, generation: Long) {
        val safeState = state.takeIf { it in setOf("loading", "playing", "paused", "stopped", "failed") } ?: "OTHER"
        emit("video stage=CALLBACK state=$safeState generation=$generation")
    }

    private fun emit(message: String) { runCatching { log(message) } }
}
