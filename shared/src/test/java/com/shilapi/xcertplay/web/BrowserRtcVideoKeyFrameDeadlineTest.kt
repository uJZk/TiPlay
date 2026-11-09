package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import org.webrtc.VideoCodecInfo
import org.webrtc.VideoEncoder

class BrowserRtcVideoKeyFrameDeadlineTest {
    private val codec = BrowserRtcVideoPolicy.Codec("H264", mapOf(
        "packetization-mode" to "1", "profile-level-id" to "42e02a"))
    private fun config() = WebVideoRecord(WebVideoRecords.KIND_CONFIG, 0,
        WebVideoRecords.CODEC_H264, 0, 1, 0,
        WebJson.write(mapOf("codec" to "avc1.42e028", "width" to 640, "height" to 360)).toByteArray())
    private fun frame(timestamp: Long, key: Boolean = false) = WebVideoRecord(WebVideoRecords.KIND_FRAME,
        if (key) WebVideoRecords.FLAG_KEY_FRAME else 0, WebVideoRecords.CODEC_H264, 0, 1, timestamp,
        byteArrayOf(0, 0, 0, 1, if (key) 0x65 else 0x41, 0xe0.toByte()))

    @Test fun anIdleConfigurationIsNotMissingSourceVideo() {
        var now = 0L
        val track = BrowserRtcVideoTrack(listOf(codec), {}, nowNanos = { now })
        try {
            assertTrue(track.configure(config()))
            val encoder = requireNotNull(track.createEncoder(VideoCodecInfo(codec.name, codec.parameters, emptyList())))
            encoder.initEncode(VideoEncoder.Settings(1, 640, 360, 4000, 60, 1, false), VideoEncoder.Callback { _, _ -> })
            now = 60_000_000_000L
            assertNull(track.pollFailure())
        } finally { track.close() }
    }

    @Test fun continuingDeltasCannotExtendTheInitialKeyFrameDeadline() {
        var now = 0L
        var requests = 0
        val track = BrowserRtcVideoTrack(listOf(codec), { requests++ }, nowNanos = { now })
        try {
            assertTrue(track.configure(config()))
            assertTrue(track.offer(frame(0)))
            now = 5_999_999_999L
            assertTrue(track.offer(frame(16_667)))
            assertNull(track.pollFailure())
            assertTrue(requests > 0)
            now++
            assertEquals("video-keyframe-timeout", track.pollFailure())
            assertEquals(0L, track.flowDiagnostics()["submittedFrames"])
            assertFalse(track.offer(frame(33_333, true)))
        } finally { track.close() }
    }

    @Test fun aRenderedPredictionChainCanRemainStaticWithoutATimeout() {
        var now = 0L
        lateinit var encoder: VideoEncoder
        val track = BrowserRtcVideoTrack(listOf(codec), {}, captureFrame = {
            encoder.encode(it, VideoEncoder.EncodeInfo(emptyArray()))
        }, nowNanos = { now })
        try {
            encoder = requireNotNull(track.createEncoder(VideoCodecInfo(codec.name, codec.parameters, emptyList())))
            encoder.initEncode(VideoEncoder.Settings(1, 640, 360, 4000, 60, 1, false), VideoEncoder.Callback { _, _ -> })
            assertTrue(track.configure(config()))
            assertTrue(track.offer(frame(0)))
            now = 5_000_000_000L
            assertTrue(track.offer(frame(16_667, true)))
            now = 60_000_000_000L
            assertNull(track.pollFailure())
            assertEquals(1L, track.flowDiagnostics()["outputFrames"])
        } finally { track.close() }
    }

    @Test fun duplicateTimestampRecoveryAlsoExpiresWhenTheSenderGoesStatic() {
        var now = 0L
        lateinit var encoder: VideoEncoder
        val track = BrowserRtcVideoTrack(listOf(codec), {}, captureFrame = {
            encoder.encode(it, VideoEncoder.EncodeInfo(emptyArray()))
        }, nowNanos = { now })
        try {
            encoder = requireNotNull(track.createEncoder(VideoCodecInfo(codec.name, codec.parameters, emptyList())))
            encoder.initEncode(VideoEncoder.Settings(1, 640, 360, 4000, 60, 1, false), VideoEncoder.Callback { _, _ -> })
            assertTrue(track.configure(config()))
            assertTrue(track.offer(frame(0, true)))
            now = 1_000_000_000L
            assertTrue(track.offer(frame(0)))
            now = 6_999_999_999L
            assertTrue(track.offer(frame(16_667)))
            assertNull(track.pollFailure())
            now++
            assertEquals("video-keyframe-timeout", track.pollFailure())
            assertEquals(1L, track.flowDiagnostics()["outputFrames"])
        } finally { track.close() }
    }
}
