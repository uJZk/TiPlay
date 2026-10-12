package com.shilapi.xcertplay.media

import com.shilapi.xcertplay.airplay.MediaSink
import com.shilapi.xcertplay.airplay.AudioFormat
import com.shilapi.xcertplay.airplay.AudioStreamId
import com.shilapi.xcertplay.airplay.MicrophoneConfig
import com.shilapi.xcertplay.airplay.VideoCodec
import com.shilapi.xcertplay.airplay.BrowserBufferedAudioPolicy

/** Routes media to the browser while retaining Android session and iAP lifecycle callbacks. */
class BrowserOnlyMediaSink(
    private val android: MediaSink,
    private val browser: MediaSink,
) : MediaSink by android, BrowserBufferedAudioPolicy {
    // Keep host screen lifecycle and iAP callbacks, but never allocate Android audio renderers or capture.
    override fun onAudioStarted(id: AudioStreamId, format: AudioFormat, firstSample: Int) = browser.onAudioStarted(id, format, firstSample)

    override fun onAudioRtp(id: AudioStreamId, format: AudioFormat, rtp: ByteArray, sample: Int) = browser.onAudioRtp(id, format, rtp, sample)

    override fun onAudioStopped(id: AudioStreamId) = browser.onAudioStopped(id)

    override fun onMicrophoneStarted(id: AudioStreamId, config: MicrophoneConfig) = browser.onMicrophoneStarted(id, config)

    override fun onMicrophoneStopped(id: AudioStreamId) = browser.onMicrophoneStopped(id)

    override fun onVideoCodec(type: Int, codec: VideoCodec) = browser.onVideoCodec(type, codec)

    override fun onVideoConfig(type: Int, codecData: ByteArray) = browser.onVideoConfig(type, codecData)

    override fun onVideoFrame(type: Int, naluBytes: ByteArray) = browser.onVideoFrame(type, naluBytes)

    override fun onVideoFrame(type: Int, naluBytes: ByteArray, senderNanos: Long, arrivalNanos: Long) =
        browser.onVideoFrame(type, naluBytes, senderNanos, arrivalNanos)

    override fun setVideoClockHandler(type: Int, handler: (Long) -> Long?) =
        browser.setVideoClockHandler(type, handler)

    override fun setVideoRecoveryHandler(type: Int, handler: () -> Unit) =
        browser.setVideoRecoveryHandler(type, handler)

    override fun setVideoDiagnosticHandler(type: Int, handler: (String) -> Unit) =
        browser.setVideoDiagnosticHandler(type, handler)

    override fun onScreenStreamActive(type: Int, active: Boolean) {
        android.onScreenStreamActive(type, active)
        browser.onScreenStreamActive(type, active)
    }
}
