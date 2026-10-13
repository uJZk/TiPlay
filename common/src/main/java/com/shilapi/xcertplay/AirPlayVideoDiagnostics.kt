package com.shilapi.xcertplay

/** Video playback metadata only: never logs resource URLs, media, headers or exception messages. */
internal class AirPlayVideoDiagnostics(private val log: (String) -> Unit) {
    enum class Stage {
        START, ENCODER_READY, PREPARE, BUFFERING, READY, ENDED, PLAYING, PAUSED,
        PREPARE_POSITION, INITIAL_SEEK, SEEK,
        RESOURCE_OPEN, RESOURCE_DIRECT, RESOURCE_IPHONE, RESOURCE_REDIRECT, RESOURCE_HLS, SOURCE_HLS,
        ENCODER_CONFIG, ENCODED_FRAME, STOP, FAILURE,
        VIDEO_TRACKS, VIDEO_SIZE, VIDEO_FIRST_FRAME, VIDEO_DISABLED, VIDEO_CODEC,
        AUDIO_TRACKS, AUDIO_PCM, AUDIO_SIGNAL, AUDIO_CODEC,
    }

    enum class SeekOrigin { IPHONE, BROWSER }

    fun seek(origin: SeekOrigin, targetMillis: Long, positionMillis: Long?, durationMillis: Long?) =
        emit("video stage=SEEK value=$targetMillis origin=$origin " +
            "positionMs=${positionMillis?.coerceAtLeast(0) ?: 0} " +
            "durationMs=${durationMillis?.coerceAtLeast(0) ?: 0}")

    fun stage(stage: Stage, value: Long? = null) = emit("video stage=$stage" + (value?.let { " value=$it" } ?: ""))

    fun failure(stage: Stage, error: Exception, code: Int? = null) {
        val type = error.javaClass.simpleName.filter { it.isLetterOrDigit() || it == '_' }.take(64)
        emit("video stage=FAILURE operation=$stage exception=$type" + (code?.let { " code=$it" } ?: ""))
    }

    fun videoSize(width: Int, height: Int) = emit("video stage=VIDEO_SIZE width=$width height=$height")

    fun audioFormat(sampleRate: Int, channels: Int, encoding: Int) =
        emit("video stage=AUDIO_FORMAT sampleRate=$sampleRate channels=$channels encoding=$encoding")

    fun decoded(rendered: Int, skipped: Int, dropped: Int) =
        emit("video stage=VIDEO_DISABLED rendered=$rendered skipped=$skipped dropped=$dropped")

    private fun emit(message: String) { runCatching { log(message) } }
}
