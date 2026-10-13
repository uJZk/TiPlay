package com.shilapi.xcertplay

/** Video playback metadata only: never logs resource URLs, media, headers or exception messages. */
internal class AirPlayVideoDiagnostics(private val log: (String) -> Unit) {
    enum class Stage { ENCODER_READY, PREPARE, ENCODER_CONFIG, ENCODED_FRAME }

    fun stage(stage: Stage, value: Long? = null) = emit("video stage=$stage" + (value?.let { " value=$it" } ?: ""))

    fun failure(stage: Stage, error: Exception) {
        val type = error.javaClass.simpleName.filter { it.isLetterOrDigit() || it == '_' }.take(64)
        emit("video stage=FAILURE operation=$stage exception=$type")
    }

    private fun emit(message: String) { runCatching { log(message) } }
}
