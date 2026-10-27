package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import org.webrtc.VideoCodecInfo
import org.webrtc.VideoCodecStatus
import org.webrtc.VideoEncoder
import org.webrtc.VideoFrame
import org.webrtc.VideoProcessor

class BrowserRtcVideoSourceProcessorTest {
    private fun adaptation(timestamp: Long, drop: Boolean = false, width: Int = 640) =
        VideoProcessor.FrameAdaptationParameters(0, 0, 640, 360, width, 360, timestamp, drop)

    private class Buffer : VideoFrame.Buffer {
        var references = 1
        var crops = 0
        override fun getWidth() = 640
        override fun getHeight() = 360
        override fun retain() { references++ }
        override fun release() { references-- }
        override fun toI420(): VideoFrame.I420Buffer = error("Pixel conversion is forbidden")
        override fun cropAndScale(x: Int, y: Int, cropWidth: Int, cropHeight: Int, scaleWidth: Int, scaleHeight: Int): VideoFrame.Buffer {
            assertEquals(listOf(0, 0, 640, 360, 640, 360), listOf(x, y, cropWidth, cropHeight, scaleWidth, scaleHeight))
            crops++; retain(); return this
        }
    }

    @Test fun actualSdkAdaptationPreservesOriginalBufferAndAlignedTimestamp() {
        val processor = BrowserRtcVideoSourceProcessor()
        val buffer = Buffer()
        val original = VideoFrame(buffer, 90, 1_000_000L)
        var outputs = 0
        processor.setSink {
            assertSame(buffer, it.buffer)
            assertEquals(90, it.rotation)
            assertEquals(1_234_567L, it.timestampNs)
            assertEquals(2, buffer.references)
            outputs++
        }
        processor.onCapturerStarted(true)
        processor.onFrameCaptured(original, adaptation(1_234_567L))
        assertEquals(1, outputs)
        assertEquals(1, buffer.crops)
        assertEquals(1, buffer.references)
        assertEquals(mapOf("sourceObservedFrames" to 1L, "sourceAdaptationDrops" to 0L,
            "sourceForwardedFrames" to 1L), processor.flowDiagnostics())
        original.release()
        assertEquals(0, buffer.references)
    }

    @Test fun sdkSourceDropRemainsObservableAndInvalidatesCompressedReferences() = Fixture().use { f ->
        val first = f.frame(0, true)
        assertTrue(f.bridge.offer(first))
        f.dropNext = true
        assertTrue(f.bridge.offer(f.frame(16_667)))
        assertEquals(1L, f.counter("releasedUnencodedFrames"))
        assertEquals(1L, f.counter("lossEvents"))
        assertTrue(f.bridge.offer(f.frame(33_333)))
        assertEquals(1L, f.counter("awaitingKeyFrames"))
        val recovery = f.frame(50_000, true)
        assertTrue(f.bridge.offer(recovery))
        assertEquals(2, f.output.size)
        assertArrayEquals(first.payload, f.output.first())
        assertArrayEquals(recovery.payload, f.output.last())
        assertEquals(mapOf("sourceObservedFrames" to 3L, "sourceAdaptationDrops" to 1L,
            "sourceForwardedFrames" to 2L), f.processor.flowDiagnostics())
        assertEquals(0L, f.counter("pendingFrames"))
    }

    @Test fun sdkCropRecommendationKeepsExistingExplicitPixelAdaptationFailure() = Fixture().use { f ->
        f.scaledWidth = 320
        assertFalse(f.bridge.offer(f.frame(0, true)))
        assertEquals("pixel-adaptation-requested", f.bridge.failure)
        assertTrue(f.output.isEmpty())
        assertEquals(0L, f.counter("pendingFrames"))
        assertEquals(1L, f.processor.flowDiagnostics()["sourceForwardedFrames"])
        assertEquals(0L, f.processor.flowDiagnostics()["sourceAdaptationDrops"])
    }

    @Test fun stoppedFailedOrDetachedProcessorCannotForwardAndAdaptedReferencesSurviveSinkFailure() {
        val processor = BrowserRtcVideoSourceProcessor()
        val buffer = Buffer()
        val frame = VideoFrame(buffer, 0, 1_000)
        var outputs = 0
        processor.setSink { outputs++ }
        processor.onFrameCaptured(frame, adaptation(1_000))
        processor.onCapturerStarted(false)
        processor.onFrameCaptured(frame, adaptation(1_000))
        processor.onCapturerStarted(true)
        processor.onFrameCaptured(frame, adaptation(1_000))
        processor.onCapturerStopped()
        processor.onFrameCaptured(frame, adaptation(1_000))
        processor.onCapturerStarted(true)
        processor.setSink(null)
        processor.onFrameCaptured(frame, adaptation(1_000))
        assertEquals(1, outputs)
        assertEquals(1, buffer.references)
        processor.setSink { throw IllegalStateException("sink retired") }
        assertThrows(IllegalStateException::class.java) { processor.onFrameCaptured(frame, adaptation(1_000)) }
        assertEquals(1, buffer.references)
        assertEquals(1L, processor.flowDiagnostics()["sourceForwardedFrames"])
        frame.release()
        assertEquals(0, buffer.references)
    }

    private class Fixture : AutoCloseable {
        val processor = BrowserRtcVideoSourceProcessor()
        var dropNext = false
        var scaledWidth = 640
        val output = mutableListOf<ByteArray>()
        private val codec = BrowserRtcVideoPolicy.Codec("H264", mapOf(
            "packetization-mode" to "1", "profile-level-id" to "42e02a"))
        val bridge = BrowserRtcVideoTrack(listOf(codec), {}, captureFrame = {
            val parameters = VideoProcessor.FrameAdaptationParameters(0, 0, 640, 360,
                scaledWidth, 360, it.timestampNs + 1_000, dropNext)
            dropNext = false
            processor.onFrameCaptured(it, parameters)
        })
        private val encoder = requireNotNull(bridge.createEncoder(VideoCodecInfo(codec.name, codec.parameters, emptyList())))
        init {
            assertEquals(VideoCodecStatus.OK, encoder.initEncode(VideoEncoder.Settings(1, 640, 360, 4_000, 60, 1, false),
                VideoEncoder.Callback { image, _ -> output.add(ByteArray(image.buffer.remaining()).also { image.buffer.duplicate().get(it) }) }))
            processor.setSink { encoder.encode(it, VideoEncoder.EncodeInfo(emptyArray())) }
            processor.onCapturerStarted(true)
            assertTrue(bridge.configure(WebVideoRecord(WebVideoRecords.KIND_CONFIG, 0, WebVideoRecords.CODEC_H264, 0, 1, 0,
                WebJson.write(mapOf("codec" to "avc1.42e028", "width" to 640, "height" to 360, "fps" to 60)).toByteArray())))
        }
        fun frame(timeUs: Long, key: Boolean = false) = WebVideoRecord(WebVideoRecords.KIND_FRAME,
            if (key) WebVideoRecords.FLAG_KEY_FRAME else 0, WebVideoRecords.CODEC_H264, 0, 1, timeUs,
            byteArrayOf(0, 0, 0, 1, if (key) 0x65 else 0x41, 0xe0.toByte()))
        fun counter(name: String) = (bridge.flowDiagnostics().getValue(name) as Number).toLong()
        override fun close() { processor.onCapturerStopped(); processor.setSink(null); bridge.close() }
    }
}
