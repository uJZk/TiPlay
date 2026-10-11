package com.shilapi.xcertplay.media

import com.shilapi.xcertplay.airplay.MediaSink
import com.shilapi.xcertplay.airplay.VideoCodec

/** Routes compressed video only to the browser, while Android retains audio and stream lifecycle. */
class BrowserOnlyMediaSink(
    private val android: MediaSink,
    private val browser: MediaSink,
) : MediaSink by android {
    override fun onVideoCodec(type: Int, codec: VideoCodec) = browser.onVideoCodec(type, codec)

    override fun onVideoConfig(type: Int, codecData: ByteArray) = browser.onVideoConfig(type, codecData)

    override fun onVideoFrame(type: Int, naluBytes: ByteArray) = browser.onVideoFrame(type, naluBytes)

    override fun onVideoFrame(type: Int, naluBytes: ByteArray, senderNanos: Long, arrivalNanos: Long) =
        browser.onVideoFrame(type, naluBytes, senderNanos, arrivalNanos)

    override fun setVideoRecoveryHandler(type: Int, handler: () -> Unit) =
        browser.setVideoRecoveryHandler(type, handler)

    override fun setVideoDiagnosticHandler(type: Int, handler: (String) -> Unit) =
        browser.setVideoDiagnosticHandler(type, handler)

    override fun onScreenStreamActive(type: Int, active: Boolean) {
        android.onScreenStreamActive(type, active)
        browser.onScreenStreamActive(type, active)
    }
}
