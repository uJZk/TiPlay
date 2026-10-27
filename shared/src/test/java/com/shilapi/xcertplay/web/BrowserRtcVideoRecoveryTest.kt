package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import org.webrtc.VideoCodecInfo
import org.webrtc.VideoCodecStatus
import org.webrtc.VideoEncoder
import org.webrtc.VideoFrame
import java.util.concurrent.Executor

class BrowserRtcVideoRecoveryTest {
    @Test fun idlePollingRetriesAKeyFrameSuppressedDuringTheInitialBurstAndHighProfileRecovers() = Fixture().use { f ->
        f.hub.requestKeyFrame(force = true)
        f.atMillis(89)
        assertTrue(f.bridge.offer(f.frame(0, true))) // Native selection discards its first AU.
        for ((millis, pts) in listOf(108L to 16_667L, 124L to 33_333L, 141L to 50_000L)) {
            f.atMillis(millis)
            assertTrue(f.bridge.offer(f.frame(pts)))
        }
        assertEquals(1, f.sentRequests) // The real Hub suppressed every recovery request within 500 ms.
        assertEquals(1L, f.counter("releasedUnencodedFrames"))
        assertEquals(3L, f.counter("awaitingKeyFrames"))
        assertTrue(f.output.isEmpty())
        assertEquals("waiting", f.bridge.diagnostics()["selection"])

        f.atMillis(1_000) // Static screen: there are no new source frames to trigger a request.
        assertNull(f.bridge.pollFailure())
        assertEquals(2, f.sentRequests)
        val selected = requireNotNull(f.selector.onAvailableBitrate(16_000))
        assertEquals(f.high.parameters, selected.params)
        f.initialize(selected)
        f.dropInput = false
        f.atMillis(1_050)
        val recovery = f.frame(1_000_000, true)
        assertTrue(f.bridge.offer(recovery))
        assertArrayEquals(recovery.prefix!! + recovery.payload, f.output.single())
        assertEquals("ready", f.bridge.diagnostics()["selection"])
        assertEquals(false, f.bridge.flowDiagnostics()["waitingForKey"])
        assertEquals(1L, f.counter("outputFrames"))
        assertEquals(0L, f.counter("encoderInputsInFlight"))
        f.atMillis(20_000)
        assertNull(f.bridge.pollFailure())
        assertEquals(2, f.sentRequests) // Recovery stops idle key-frame requests.
    }

    @Test fun idleRetriesDoNotExtendTheExistingSelectionDeadlineOrRunAfterFailure() = Fixture().use { f ->
        f.hub.requestKeyFrame(force = true)
        f.atMillis(89)
        assertTrue(f.bridge.offer(f.frame(0, true)))
        f.atMillis(1_000)
        assertNull(f.bridge.pollFailure())
        assertEquals(2, f.sentRequests)
        f.atMillis(6_000)
        assertEquals("video-encoder-selection-timeout", f.bridge.pollFailure())
        assertEquals(2, f.sentRequests)
        f.atMillis(20_000)
        assertEquals("video-encoder-selection-timeout", f.bridge.pollFailure())
        assertEquals(2, f.sentRequests)
    }

    @Test fun pollingAfterCloseOrDisableCannotRequestAnotherKeyFrame() {
        for (close in listOf(false, true)) Fixture().use { f ->
            f.hub.requestKeyFrame(force = true)
            f.atMillis(89)
            assertTrue(f.bridge.offer(f.frame(0, true)))
            if (close) f.bridge.close() else f.bridge.disable("source-retired")
            f.atMillis(1_000)
            f.bridge.pollFailure()
            assertEquals(1, f.sentRequests)
        }
    }

    @Test fun aMatchingEncoderWithNoOutputStillExpiresAtItsOriginalStartDeadline() = Fixture().use { f ->
        f.initialize(VideoCodecInfo(f.high.name, f.high.parameters, emptyList()))
        f.hub.requestKeyFrame(force = true)
        f.atMillis(89)
        assertTrue(f.bridge.offer(f.frame(0, true)))
        f.atMillis(1_000)
        assertNull(f.bridge.pollFailure())
        val requestsBeforeDeadline = f.sentRequests
        f.atMillis(6_089) // Six seconds from the first submitted frame, not from the retry.
        assertEquals("video-encoder-start-timeout", f.bridge.pollFailure())
        assertEquals(requestsBeforeDeadline, f.sentRequests)
    }

    private class Fixture : AutoCloseable {
        private val origin = 1_000_000_000L
        private var now = origin
        var sentRequests = 0
            private set
        val hub = WebVideoHub(Executor { it.run() }, { now })
        val high = BrowserRtcVideoPolicy.Codec("H264", mapOf("profile-level-id" to "64002a", "packetization-mode" to "1"))
        private val baseline = BrowserRtcVideoPolicy.Codec("H264", mapOf("profile-level-id" to "42002a", "packetization-mode" to "1"))
        var dropInput = true
        val output = mutableListOf<ByteArray>()
        private lateinit var encoder: VideoEncoder
        val bridge = BrowserRtcVideoTrack(listOf(baseline, high), { hub.requestKeyFrame() },
            captureFrame = { frame: VideoFrame ->
                if (!dropInput) encoder.encode(frame, VideoEncoder.EncodeInfo(emptyArray()))
            }, nowNanos = { now })
        val selector = bridge.getEncoderSelector()
        init {
            hub.beginStream(Any(), 1568, 1080, 60, { sentRequests++ }, {})
            bridge.negotiated("v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\na=rtpmap:96 H264/90000\r\n" +
                "a=fmtp:96 profile-level-id=64002a;packetization-mode=1\r\n")
            initialize(VideoCodecInfo(baseline.name, baseline.parameters, emptyList()))
            assertTrue(bridge.configure(WebVideoRecord(WebVideoRecords.KIND_CONFIG, 0, WebVideoRecords.CODEC_H264, 0, 1, 0,
                WebJson.write(mapOf("codec" to "avc1.64002a", "width" to 1568, "height" to 1080, "fps" to 60)).toByteArray())))
        }
        fun initialize(info: VideoCodecInfo) {
            encoder = requireNotNull(bridge.createEncoder(info))
            assertEquals(VideoCodecStatus.OK, encoder.initEncode(VideoEncoder.Settings(1, 1568, 1080, 16_000, 60, 1, false),
                VideoEncoder.Callback { image, _ -> output.add(ByteArray(image.buffer.remaining()).also { image.buffer.duplicate().get(it) }) }))
            selector.onCurrentEncoder(info)
        }
        fun frame(timeUs: Long, key: Boolean = false) = WebVideoRecord(WebVideoRecords.KIND_FRAME,
            if (key) WebVideoRecords.FLAG_KEY_FRAME else 0, WebVideoRecords.CODEC_H264, 0, 1, timeUs,
            byteArrayOf(0, 0, 0, 1, if (key) 0x65 else 0x41, 0xe0.toByte()),
            prefix = if (key) byteArrayOf(0, 0, 0, 1, 0x67, 0x64, 0, 0x2a) else null)
        fun atMillis(millis: Long) { now = origin + millis * 1_000_000L }
        fun counter(name: String) = (bridge.flowDiagnostics().getValue(name) as Number).toLong()
        override fun close() { bridge.close() }
    }
}
