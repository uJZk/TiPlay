package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import org.webrtc.EncodedImage
import org.webrtc.VideoCodecInfo
import org.webrtc.VideoCodecStatus
import org.webrtc.VideoEncoder
import org.webrtc.VideoFrame

class BrowserRtcVideoFlowTest {
    private val codec = BrowserRtcVideoPolicy.Codec("H264", mapOf(
        "packetization-mode" to "1", "profile-level-id" to "42e02a"))
    private fun frame(timeUs: Long, key: Boolean = false) = WebVideoRecord(
        WebVideoRecords.KIND_FRAME, if (key) WebVideoRecords.FLAG_KEY_FRAME else 0,
        WebVideoRecords.CODEC_H264, 0, 1, timeUs,
        byteArrayOf(0, 0, 0, 1, if (key) 0x65 else 0x41, 0xe0.toByte()))

    private inner class Fixture : AutoCloseable {
        var requestCount = 0
        val output = mutableListOf<ByteArray>()
        var capture: (VideoFrame) -> Unit = { encoder.encode(it, VideoEncoder.EncodeInfo(emptyArray())) }
        val bridge = BrowserRtcVideoTrack(listOf(codec), { requestCount++ }, captureFrame = { capture(it) })
        val encoder: VideoEncoder = requireNotNull(bridge.createEncoder(VideoCodecInfo(codec.name, codec.parameters, emptyList())))
        init {
            assertEquals(VideoCodecStatus.OK, encoder.initEncode(VideoEncoder.Settings(1, 640, 360, 4_000, 60, 1, false),
                VideoEncoder.Callback { image, _ -> output.add(ByteArray(image.buffer.remaining()).also { image.buffer.duplicate().get(it) }) }))
            assertTrue(bridge.configure(WebVideoRecord(WebVideoRecords.KIND_CONFIG, 0, WebVideoRecords.CODEC_H264, 0, 1, 0,
                WebJson.write(mapOf("codec" to "avc1.42e028", "width" to 640, "height" to 360, "fps" to 60)).toByteArray())))
        }
        fun counter(name: String) = (bridge.flowDiagnostics().getValue(name) as Number).toLong()
        override fun close() { bridge.close() }
    }

    @Test fun originalOutputAndNativeAllocationHaveSeparateCounters() = Fixture().use { f ->
        val first = frame(0, true)
        val next = frame(16_667)
        assertTrue(f.bridge.offer(first)); assertTrue(f.bridge.offer(next))
        assertArrayEquals(first.payload, f.output[0]); assertArrayEquals(next.payload, f.output[1])
        assertEquals(VideoCodecStatus.OK, f.encoder.setRateAllocation(VideoEncoder.BitrateAllocation(arrayOf(intArrayOf(90_000, 10_000))), 60))
        assertEquals(2L, f.counter("receivedFrames")); assertEquals(2L, f.counter("submittedFrames"))
        assertEquals(2L, f.counter("outputFrames")); assertEquals(12L, f.counter("outputBytes"))
        assertEquals(1L, f.counter("rateUpdates")); assertEquals(100_000L, f.counter("allocatedBitrateBps"))
        assertEquals(60L, f.counter("allocatedFramerate")); assertEquals(0L, f.counter("pendingFrames"))
        assertEquals(0L, f.counter("releasedUnencodedFrames")); assertEquals(0L, f.counter("lossEvents"))
        assertEquals("bridge-lifetime", f.bridge.flowDiagnostics()["scope"])
    }

    @Test fun inputReleaseBeforeEncodeIsDistinguishedFromWaitingForRecovery() = Fixture().use { f ->
        lateinit var held: VideoFrame
        f.capture = { it.retain(); held = it }
        assertTrue(f.bridge.offer(frame(0, true)))
        assertEquals(1L, f.counter("pendingFrames"))
        held.release()
        assertEquals(1L, f.counter("releasedUnencodedFrames")); assertEquals(1L, f.counter("lossEvents"))
        assertTrue(f.bridge.offer(frame(16_667)))
        f.capture = { f.encoder.encode(it, VideoEncoder.EncodeInfo(emptyArray())) }
        assertTrue(f.bridge.offer(frame(33_333, true)))
        assertEquals(3L, f.counter("receivedFrames")); assertEquals(2L, f.counter("submittedFrames"))
        assertEquals(1L, f.counter("awaitingKeyFrames")); assertEquals(1L, f.counter("outputFrames"))
        assertEquals(0L, f.counter("pendingBytes")); assertEquals(1, f.output.size)
        assertEquals(false, f.bridge.flowDiagnostics()["waitingForKey"])
    }

    @Test fun boundedQueueRejectionsDoNotMasqueradeAsEncoderOutputs() = Fixture().use { f ->
        val held = mutableListOf<VideoFrame>()
        try {
            f.capture = { it.retain(); held.add(it) }
            repeat(30) { assertTrue(f.bridge.offer(frame(it * 16_667L, true))) }
            assertEquals(30L, f.counter("receivedFrames")); assertEquals(16L, f.counter("submittedFrames"))
            assertEquals(14L, f.counter("queueRejectedFrames")); assertEquals(16L, f.counter("pendingFrames"))
            assertEquals(0L, f.counter("outputFrames")); assertEquals(0L, f.counter("releasedUnencodedFrames"))
        } finally { held.forEach(VideoFrame::release) }
        assertEquals(16L, f.counter("releasedUnencodedFrames")); assertEquals(0L, f.counter("pendingFrames"))
    }

    @Test fun receivedBytesIncludeParameterSetsWaitingFramesAndQueueRejections() = Fixture().use { f ->
        fun sizedFrame(timeUs: Long, key: Boolean, size: Int, prefix: ByteArray? = null): WebVideoRecord {
            val original = frame(timeUs, key)
            return WebVideoRecord(original.kind, original.flags, original.codec, original.sequence,
                original.epoch, original.timestampUs, original.payload.copyOf(size), prefix)
        }
        val first = sizedFrame(0, true, 6, byteArrayOf(0, 0, 0, 1, 0x67, 1, 2))
        assertTrue(f.bridge.offer(first))
        assertArrayEquals(first.prefix!! + first.payload, f.output.single())
        val held = mutableListOf<VideoFrame>()
        try {
            f.capture = { it.retain(); held.add(it) }
            repeat(16) { assertTrue(f.bridge.offer(sizedFrame((it + 1) * 16_667L, true, 6 + it))) }
            assertTrue(f.bridge.offer(sizedFrame(17 * 16_667L, true, 23))) // Full native queue.
            assertTrue(f.bridge.offer(sizedFrame(18 * 16_667L, false, 29))) // Waiting for a new IDR.
            assertEquals(19L, f.counter("receivedFrames"))
            assertEquals(281L, f.counter("receivedBytes")) // 13 + (6..21) + 23 + 29.
            assertEquals(1L, f.counter("queueRejectedFrames"))
            assertEquals(1L, f.counter("awaitingKeyFrames"))
            assertEquals(17L, f.counter("submittedFrames"))
            assertEquals(1L, f.counter("outputFrames"))
            assertEquals(13L, f.counter("outputBytes"))
        } finally { held.forEach(VideoFrame::release) }
        assertEquals(0L, f.counter("pendingBytes"))
    }

    @Test fun nativeKeyRequestsAndStaleDependencyChainsHaveDistinctEvidence() = Fixture().use { f ->
        lateinit var held: VideoFrame
        f.capture = { it.retain(); held = it }
        assertTrue(f.bridge.offer(frame(0, true)))
        try {
            f.capture = { f.encoder.encode(it, VideoEncoder.EncodeInfo(arrayOf(EncodedImage.FrameType.VideoFrameKey))) }
            assertTrue(f.bridge.offer(frame(16_667)))
            assertEquals(VideoCodecStatus.NO_OUTPUT, f.encoder.encode(held, VideoEncoder.EncodeInfo(emptyArray())))
            assertEquals(1L, f.counter("nativeKeyFrameRequests")); assertEquals(1L, f.counter("chainRejectedFrames"))
            assertEquals(0L, f.counter("outputFrames")); assertEquals(0L, f.counter("releasedUnencodedFrames"))
            assertTrue(f.output.isEmpty()); assertEquals(true, f.bridge.flowDiagnostics()["waitingForKey"])
        } finally { held.release() }
    }

    @Test fun repeatedNativeInputIsCountedWithoutReplayingTheCompressedAccessUnit() = Fixture().use { f ->
        f.capture = {
            assertEquals(VideoCodecStatus.OK, f.encoder.encode(it, VideoEncoder.EncodeInfo(emptyArray())))
            assertEquals(VideoCodecStatus.NO_OUTPUT, f.encoder.encode(it, VideoEncoder.EncodeInfo(emptyArray())))
        }
        assertTrue(f.bridge.offer(frame(0, true)))
        assertEquals(1L, f.counter("duplicateEncoderInputs")); assertEquals(1L, f.counter("outputFrames"))
        assertEquals(0L, f.counter("lossEvents")); assertEquals(1, f.output.size)
    }
}
