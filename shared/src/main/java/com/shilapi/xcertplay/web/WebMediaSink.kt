package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.airplay.MediaSink
import com.shilapi.xcertplay.airplay.VideoCodec

/**
 * Feeds the main CarPlay screen (stream type 110) of one AirPlay session into [hub]; every other stream is ignored.
 * [width] × [height] is the negotiated canvas, which the page uses for touch mapping.
 *
 * The hub ignores this sink once a newer session's sink has begun a stream, and a [close]d sink never begins one again,
 * so a retired sink is harmless.
 */
class WebMediaSink(
    private val hub: WebVideoHub,
    private var width: Int,
    private var height: Int,
    private val fps: Int,
    private val source: BrowserDisplaySource = BrowserDisplaySource.CARPLAY,
    private val mode: BrowserPlaybackMode = if (source == BrowserDisplaySource.AIRPLAY)
        BrowserPlaybackMode.AIRPLAY_MIRROR else BrowserPlaybackMode.CARPLAY,
) : MediaSink {
    @Volatile private var mediaClock: ((Long) -> Long?)? = null
    @Volatile private var codec: VideoCodec? = null
    @Volatile private var recovery: (() -> Unit)? = null
    @Volatile private var diagnostics: ((String) -> Unit)? = null
    private var closed = false // guarded by this
    private var paused = false // guarded by this
    private var active = false // guarded by this
    private var retainedConfig: ByteArray? = null // guarded by this

    /** Temporarily lend the browser display to another source without closing the CarPlay stream. */
    fun pauseDisplay() = synchronized(this) {
        paused = true
        hub.endStream(this)
    }

    fun resumeDisplay() = synchronized(this) {
        if (closed || !paused) return@synchronized
        paused = false
        if (!active) return@synchronized
        hub.beginStream(this, width, height, fps, requestKeyFrame = { recovery?.invoke() }, report = { diagnostics?.invoke(it) }, source = source, mode = mode)
        val codec = codec
        if (codec != null) retainedConfig?.let { hub.configure(this, codec, it) }
        hub.requestKeyFrame(force = true)
    }

    /** Changes the next stream's canvas; an existing stream retains its negotiated dimensions. */
    fun updateCanvas(width: Int, height: Int) = synchronized(this) {
        if (closed) return@synchronized
        this.width = width
        this.height = height
    }

    override fun onVideoCodec(type: Int, codec: VideoCodec) {
        if (type == MAIN_SCREEN) this.codec = codec
    }

    override fun onVideoConfig(type: Int, codecData: ByteArray) {
        if (type != MAIN_SCREEN) return
        synchronized(this) {
            if (closed) return
            retainedConfig = codecData.copyOf()
            val codec = codec ?: return
            if (!paused) hub.configure(this, codec, codecData)
        }
    }

    override fun onVideoFrame(type: Int, naluBytes: ByteArray) = onVideoFrame(type, naluBytes, 0L, System.nanoTime())

    override fun onVideoFrame(type: Int, naluBytes: ByteArray, senderNanos: Long, arrivalNanos: Long) {
        if (type == MAIN_SCREEN) hub.frame(this, naluBytes, senderNanos, arrivalNanos, mediaClock?.invoke(senderNanos))
    }

    override fun setVideoClockHandler(type: Int, handler: (Long) -> Long?) {
        if (type == MAIN_SCREEN) mediaClock = handler
    }

    override fun setVideoRecoveryHandler(type: Int, handler: () -> Unit) {
        if (type == MAIN_SCREEN) recovery = handler
    }

    override fun setVideoDiagnosticHandler(type: Int, handler: (String) -> Unit) {
        if (type == MAIN_SCREEN) diagnostics = handler
    }

    override fun onScreenStreamActive(type: Int, active: Boolean) {
        if (type != MAIN_SCREEN) return
        if (active) {
            // Under the same lock as close(): a retired session's screen that comes up late, while its stack is still
            // closing, must not take the hub from the next session's sink.
            synchronized(this) {
                if (closed || this.active) return
                this.active = true
                if (paused) return
                hub.beginStream(this, width, height, fps, requestKeyFrame = { recovery?.invoke() }, report = { diagnostics?.invoke(it) }, source = source, mode = mode)
            }
        } else {
            synchronized(this) { this.active = false; retainedConfig = null; hub.endStream(this) }
        }
    }

    /** Ends this sink's stream for good, for a session that is retired without a screen teardown. */
    fun close() = synchronized(this) {
        closed = true
        active = false
        retainedConfig = null
        hub.endStream(this)
    }

    private companion object {
        const val MAIN_SCREEN = 110
    }
}
