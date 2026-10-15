package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.VideoCodec

/** Bounded mirror metadata. Payloads, cipher inputs, transport keys and peer identities are never formatted. */
internal class ReceiverMirrorDiagnostics(private val log: (String) -> Unit, private val nanoTime: () -> Long = System::nanoTime) {
    enum class Stage { ACCEPT, HEADER, BODY, DECRYPT, CONFIG, FRAME_VALIDATE, PUBLISH }
    enum class End { CLOSED, HEADER_EOF, BODY_EOF, FAILED }
    private var packets = 0L
    private var frames = 0L
    private var configs = 0L
    private var geometries = 0L
    private var keyFrames = 0L
    private var annexBFrames = 0L
    private var firstSenderNanos: Long? = null
    private var firstSenderArrivalNanos: Long? = null
    private var firstArrivalNanos: Long? = null
    private var lastArrivalNanos: Long? = null

    fun listening() = emit("mirror stage=LISTENING")
    fun accepted() = emit("mirror stage=ACCEPTED")
    fun reconnecting(graceMillis: Long) = emit("mirror stage=RECONNECTING graceMs=$graceMillis")
    fun packet(type: Int, bytes: Int) {
        packets++
        if (sample(packets)) emit("mirror stage=PACKET type=$type bodyBytes=$bytes packets=$packets")
    }
    fun geometry(width: Int, height: Int) {
        geometries++
        if (sample(geometries)) emit("mirror stage=GEOMETRY width=$width height=$height")
    }
    fun config(codec: VideoCodec, bytes: Int) {
        configs++
        if (sample(configs)) emit("mirror stage=CONFIG codec=$codec recordBytes=$bytes configs=$configs")
    }
    fun forwarded(bytes: Int, keyFrame: Boolean, annexB: Boolean) {
        frames++
        if (keyFrame) keyFrames++
        if (annexB) annexBFrames++
        if (sample(frames)) emit("mirror stage=FORWARDED frameBytes=$bytes frames=$frames keyFrames=$keyFrames annexBFrames=$annexBFrames")
    }
    /** Relative times distinguish source pacing from receiver work without recording protocol timestamps. */
    fun timing(senderNanos: Long, arrivalNanos: Long, bodyReadNanos: Long, publishNanos: Long) {
        if (firstArrivalNanos == null) firstArrivalNanos = arrivalNanos
        if (firstSenderNanos == null && senderNanos != 0L) {
            firstSenderNanos = senderNanos
            firstSenderArrivalNanos = arrivalNanos
        }
        lastArrivalNanos = arrivalNanos
        if (!sample(frames)) return
        val arrivalElapsed = (arrivalNanos - requireNotNull(firstArrivalNanos)) / 1_000_000
        val sourceElapsed = firstSenderNanos?.takeIf { senderNanos != 0L }?.let { (senderNanos - it) / 1_000_000 }
        val drift = sourceElapsed?.let { (arrivalNanos - requireNotNull(firstSenderArrivalNanos)) / 1_000_000 - it }
        emit("mirror stage=TIMING frames=$frames arrivalElapsedMs=$arrivalElapsed sourceElapsedMs=$sourceElapsed driftMs=$drift bodyReadMs=${bodyReadNanos / 1_000_000} publishMs=${publishNanos / 1_000_000}")
    }
    fun failure(stage: Stage, error: Exception) {
        val type = error.javaClass.simpleName.filter { it.isLetterOrDigit() || it == '_' }.take(64)
        emit("mirror stage=$stage exception=$type")
    }
    fun end(reason: End) = emit("mirror stage=END reason=$reason packets=$packets configs=$configs frames=$frames keyFrames=$keyFrames annexBFrames=$annexBFrames sinceLastFrameMs=${lastArrivalNanos?.let { (nanoTime() - it) / 1_000_000 }}")
    private fun sample(count: Long) = count <= 3 || count % 120L == 0L
    private fun emit(message: String) { runCatching { log(message) } }
}
