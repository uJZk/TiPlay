package com.shilapi.xcertplay.web

import org.webrtc.VideoFrame
import org.webrtc.VideoProcessor
import org.webrtc.VideoSink
import java.util.concurrent.atomic.AtomicLong

/** Observes the public source-adaptation boundary without changing its drop/crop policy. */
internal class BrowserRtcVideoSourceProcessor : VideoProcessor {
    private var sink: VideoSink? = null
    private var running = false
    private val observedFrames = AtomicLong()
    private val adaptationDrops = AtomicLong()
    private val forwardedFrames = AtomicLong()

    @Synchronized override fun setSink(sink: VideoSink?) { this.sink = sink }
    @Synchronized override fun onCapturerStarted(success: Boolean) { running = success }
    @Synchronized override fun onCapturerStopped() { running = false }

    @Synchronized override fun onFrameCaptured(frame: VideoFrame, parameters: VideoProcessor.FrameAdaptationParameters) {
        observedFrames.incrementAndGet()
        if (parameters.drop) adaptationDrops.incrementAndGet()
        val output = sink?.takeIf { running } ?: return
        // Use the SDK's actual adaptation, including its aligned capture timestamp.
        // AccessUnit.cropAndScale still rejects any requested pixel transformation.
        val adapted = VideoProcessor.applyFrameAdaptationParameters(frame, parameters) ?: return
        try {
            output.onFrame(adapted)
            forwardedFrames.incrementAndGet()
        } finally { adapted.release() }
    }

    @Synchronized override fun onFrameCaptured(frame: VideoFrame) {
        observedFrames.incrementAndGet()
        val output = sink?.takeIf { running } ?: return
        output.onFrame(frame)
        forwardedFrames.incrementAndGet()
    }

    fun flowDiagnostics(): Map<String, Long> = linkedMapOf(
        "sourceObservedFrames" to observedFrames.get(),
        "sourceAdaptationDrops" to adaptationDrops.get(),
        "sourceForwardedFrames" to forwardedFrames.get(),
    )
}
