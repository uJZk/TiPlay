package com.shilapi.xcertplay

/** Video playback metadata only: never logs resource URLs, media, headers or exception messages. */
internal class AirPlayVideoDiagnostics(private val log: (String) -> Unit) {
    enum class Stage {
        START, ENCODER_READY, PREPARE, BUFFERING, READY, ENDED, PLAYING, PAUSED,
        RESOURCE_OPEN, RESOURCE_DIRECT, RESOURCE_IPHONE, RESOURCE_REDIRECT, RESOURCE_HLS, SOURCE_HLS,
        ENCODER_CONFIG, ENCODED_FRAME, STOP, FAILURE,
        VIDEO_TRACKS, VIDEO_SIZE, VIDEO_FIRST_FRAME, VIDEO_DISABLED, VIDEO_CODEC,
    }

    fun stage(stage: Stage, value: Long? = null) = emit("video stage=$stage" + (value?.let { " value=$it" } ?: ""))

    fun failure(stage: Stage, error: Exception, code: Int? = null) {
        val type = error.javaClass.simpleName.filter { it.isLetterOrDigit() || it == '_' }.take(64)
        emit("video stage=FAILURE operation=$stage exception=$type" + (code?.let { " code=$it" } ?: ""))
    }

    fun videoSize(width: Int, height: Int) = emit("video stage=VIDEO_SIZE width=$width height=$height")

    fun decoded(rendered: Int, skipped: Int, dropped: Int) =
        emit("video stage=VIDEO_DISABLED rendered=$rendered skipped=$skipped dropped=$dropped")

    private fun emit(message: String) { runCatching { log(message) } }
}
