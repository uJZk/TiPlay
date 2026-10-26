package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import org.webrtc.EncodedImage
import org.webrtc.VideoCodecInfo
import org.webrtc.VideoCodecStatus
import org.webrtc.VideoEncoder
import org.webrtc.VideoFrame

class BrowserRtcVideoTrackTest {
    private val codec = BrowserRtcVideoPolicy.Codec("H264", mapOf(
        "packetization-mode" to "1", "profile-level-id" to "42e02a", "level-asymmetry-allowed" to "1"))
    private fun config(epoch: Int = 1, codecString: String = "avc1.42e028") = WebVideoRecord(
        WebVideoRecords.KIND_CONFIG, 0, WebVideoRecords.CODEC_H264, 0, epoch, 0,
        WebJson.write(mapOf("codec" to codecString, "width" to 640, "height" to 360, "fps" to 60, "mode" to "carplay")).toByteArray())
    private fun frame(timeUs: Long, key: Boolean = false, bytes: ByteArray? = null) = WebVideoRecord(
        WebVideoRecords.KIND_FRAME, if (key) WebVideoRecords.FLAG_KEY_FRAME else 0,
        WebVideoRecords.CODEC_H264, 0, 1, timeUs,
        bytes ?: byteArrayOf(0, 0, 0, 1, if (key) 0x65 else 0x41, 0xe0.toByte()),
        prefix = if (key) byteArrayOf(0, 0, 0, 1, 0x67, 1, 2) else null)

    @Test fun burstCadenceUsesSourcePtsInsteadOfPacketArrival() {
        val clock = BrowserRtcVideoPolicy.SourceClock()
        assertEquals(1_000_000_000L, clock.map(900_000, 1_000_000_000L))
        assertEquals(1_016_667_000L, clock.map(916_667, 1_000_001_000L))
        assertEquals(1_033_333_000L, clock.map(933_333, 1_000_002_000L))
        assertNull(BrowserRtcVideoPolicy.SourceClock().map(0, -1))
        assertNull(clock.map(Long.MAX_VALUE, 0))
    }

    @Test fun passthroughPreservesOriginalBytesAndEchoesTheActualEncoderInputTimestamp() {
        lateinit var encoder: VideoEncoder
        val captured = mutableListOf<Long>()
        val encoded = mutableListOf<ByteArray>()
        val timestamps = mutableListOf<Long>()
        val bridge = BrowserRtcVideoTrack(listOf(codec), {}, captureFrame = { frame ->
            captured.add(frame.timestampNs)
            assertEquals(VideoCodecStatus.OK, encoder.encode(frame, VideoEncoder.EncodeInfo(emptyArray())))
        })
        encoder = requireNotNull(bridge.createEncoder(VideoCodecInfo(codec.name, codec.parameters, emptyList())))
        assertEquals(VideoCodecStatus.OK, encoder.initEncode(VideoEncoder.Settings(2, 640, 360, 4_000, 60, 1, false),
            VideoEncoder.Callback { image, _ ->
                encoded.add(ByteArray(image.buffer.remaining()).also { image.buffer.duplicate().get(it) })
                timestamps.add(image.captureTimeNs)
            }))
        assertTrue(bridge.configure(config()))
        val first = frame(0, true)
        val next = frame(16_667)
        assertTrue(bridge.offer(first)); assertTrue(bridge.offer(next))
        assertArrayEquals(first.prefix!! + first.payload, encoded[0])
        assertArrayEquals(next.payload, encoded[1])
        assertEquals(captured, timestamps)
        assertEquals(16_667_000L, timestamps[1] - timestamps[0])
        assertFalse(encoder.scalingSettings.on)
        assertFalse(encoder.isHardwareEncoder)
        bridge.close()
    }

    @Test fun inputDroppedBeforeEncodeRequestsIdrAndDoesNotForwardTheDependentChain() {
        var requests = 0
        var discard = true
        lateinit var encoder: VideoEncoder
        val output = mutableListOf<EncodedImage.FrameType>()
        val bridge = BrowserRtcVideoTrack(listOf(codec), { requests++ }, captureFrame = { frame ->
            if (!discard) encoder.encode(frame, VideoEncoder.EncodeInfo(emptyArray()))
        })
        encoder = requireNotNull(bridge.createEncoder(VideoCodecInfo(codec.name, codec.parameters, emptyList())))
        encoder.initEncode(VideoEncoder.Settings(1, 640, 360, 4_000, 60, 1, false), VideoEncoder.Callback { image, _ -> output.add(image.frameType) })
        assertTrue(bridge.configure(config()))
        assertTrue(bridge.offer(frame(0, true))) // Native source/encoder never consumed this reference.
        assertTrue(requests > 0)
        discard = false
        assertTrue(bridge.offer(frame(16_667)))
        assertTrue(output.isEmpty())
        assertTrue(bridge.offer(frame(33_333, true)))
        assertEquals(listOf(EncodedImage.FrameType.VideoFrameKey), output)
        bridge.close()
    }

    @Test fun pendingOriginalFramesAreBoundedAndRetiredEpochCannotBeRevived() {
        val held = mutableListOf<VideoFrame>()
        val bridge = BrowserRtcVideoTrack(listOf(codec), {}, captureFrame = { it.retain(); held.add(it) })
        bridge.createEncoder(VideoCodecInfo(codec.name, codec.parameters, emptyList()))
        assertTrue(bridge.configure(config()))
        repeat(30) { assertTrue(bridge.offer(frame(it * 16_667L, true))) }
        assertEquals(16, held.size)
        assertFalse(bridge.configure(config(2)))
        assertEquals("source-changed", bridge.failure)
        held.forEach(VideoFrame::release)
        assertFalse(bridge.configure(config()))
        bridge.close()
    }

    @Test fun profilesReorderingAndDecodeOnlyFramesCannotSilentlyEnterTrack() {
        assertFalse(BrowserRtcVideoPolicy.matches("avc1.640028", codec))
        assertFalse(BrowserRtcVideoPolicy.matches("avc1.42e033", codec))
        assertTrue(BrowserRtcVideoPolicy.hasH264BSlice(byteArrayOf(0, 0, 1, 0x41, 0xa0.toByte())))
        assertFalse(BrowserRtcVideoPolicy.hasH264BSlice(byteArrayOf(0, 0, 1, 0x41, 0xe0.toByte())))
        val bridge = BrowserRtcVideoTrack(listOf(codec), {}, captureFrame = {})
        bridge.createEncoder(VideoCodecInfo(codec.name, codec.parameters, emptyList()))
        assertTrue(bridge.configure(config()))
        assertFalse(bridge.offer(frame(0, true).withFlags(WebVideoRecords.FLAG_DECODE_ONLY)))
        assertEquals("decode-only-video", bridge.failure)
        bridge.close()
    }

    @Test fun hevcSupportComesFromRtpProfileTierAndLevelRatherThanWebCodecsSupport() {
        val main = BrowserRtcVideoPolicy.Codec("H265", mapOf("profile-id" to "1", "tier-flag" to "0", "level-id" to "120"))
        assertTrue(BrowserRtcVideoPolicy.matches("hvc1.1.6.L120.B0", main))
        assertFalse(BrowserRtcVideoPolicy.matches("hvc1.2.4.L120.B0", main))
        assertFalse(BrowserRtcVideoPolicy.matches("hvc1.1.6.H120.B0", main))
        assertFalse(BrowserRtcVideoPolicy.matches("hvc1.1.6.L153.B0", main))
        assertFalse(BrowserRtcVideoPolicy.matches("hvc1.1.6.L120.B0", codec))
    }

    @Test fun pixelConversionRequestsFailExplicitlyAndNeverInvokeAnEncoder() {
        val bridge = BrowserRtcVideoTrack(listOf(codec), {}, captureFrame = { assertNull(it.buffer.toI420()) })
        bridge.createEncoder(VideoCodecInfo(codec.name, codec.parameters, emptyList()))
        assertTrue(bridge.configure(config()))
        assertFalse(bridge.offer(frame(0, true)))
        assertEquals("pixel-conversion-requested", bridge.failure)
        bridge.close()
    }

    @Test fun missingEncoderCallbackEndsVideoInsteadOfWaitingForever() {
        var now = 1_000_000_000L
        val bridge = BrowserRtcVideoTrack(listOf(codec), {}, captureFrame = {}, nowNanos = { now })
        bridge.createEncoder(VideoCodecInfo(codec.name, codec.parameters, emptyList()))
        assertTrue(bridge.configure(config()))
        assertTrue(bridge.offer(frame(0, true)))
        now += 5_999_999_999L
        assertNull(bridge.pollFailure())
        now++
        assertEquals("video-encoder-start-timeout", bridge.pollFailure())
        assertFalse(bridge.offer(frame(16_667, true)))
        bridge.close()
    }

    @Test fun offerOnlyAcceptsTheRemoteReceiveOnlyTrackAndH264PacketizationOne() {
        val offer = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96 97\r\na=recvonly\r\na=rtpmap:96 H264/90000\r\na=fmtp:96 profile-level-id=42e02a;packetization-mode=1\r\na=rtpmap:97 VP8/90000\r\n"
        assertTrue(BrowserRtcVideoPolicy.receiveOnlyOffer(offer))
        assertEquals(listOf("H264"), BrowserRtcVideoPolicy.codecs(offer).map { it.name })
        assertFalse(BrowserRtcVideoPolicy.receiveOnlyOffer(offer.replace("recvonly", "sendrecv")))
        assertTrue(BrowserRtcVideoPolicy.codecs(offer.replace("packetization-mode=1", "packetization-mode=0")).isEmpty())
        assertThrows(IllegalArgumentException::class.java) { BrowserRtcVideoPolicy.codecs(offer + "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\n") }
        val metadata = WebJson.parse(String(BrowserRtcVideoPolicy.metadata(config(), BrowserRtcVideoPolicy.TRACK).payload)) as Map<*, *>
        assertEquals(BrowserRtcVideoPolicy.TRACK, metadata["videoTransport"])
        assertEquals("carplay", metadata["mode"])
    }

    @Test fun videoReplacementKeepsAuthenticatedTransportAndRejectsAudioChanges() {
        val session = "v=0\r\na=group:BUNDLE video0 data\r\na=fingerprint:sha-256 AB:CD\r\n"
        val credentials = "a=ice-ufrag:shared\r\na=ice-pwd:password\r\na=setup:actpass\r\n"
        val video = "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:video0\r\na=recvonly\r\n" + credentials +
            "a=rtpmap:96 H264/90000\r\na=fmtp:96 profile-level-id=42e02a;packetization-mode=1\r\n"
        val data = "m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=mid:data\r\na=sctp-port:5000\r\na=max-message-size:65536\r\n" + credentials
        val original = session + video + data
        val replacement = session.replace("video0 data", "data video1") +
            video.replace("m=video 9", "m=video 0").replace("a=recvonly", "a=inactive") + data + video.replace("video0", "video1")
        BrowserRtcVideoPolicy.validateReplacement(original, replacement)
        assertTrue(BrowserRtcVideoPolicy.receiveOnlyOffer(replacement))
        assertEquals(1, BrowserRtcVideoPolicy.codecs(replacement).size)
        assertThrows(IllegalArgumentException::class.java) { BrowserRtcVideoPolicy.validateReplacement(original, replacement.replace("AB:CD", "AA:BB")) }
        assertThrows(IllegalArgumentException::class.java) { BrowserRtcVideoPolicy.validateReplacement(original, replacement.replace("ice-pwd:password", "ice-pwd:restart")) }
        assertThrows(IllegalArgumentException::class.java) { BrowserRtcVideoPolicy.validateReplacement(original, replacement.replace("sctp-port:5000", "sctp-port:5001")) }
        assertThrows(IllegalArgumentException::class.java) { BrowserRtcVideoPolicy.validateReplacement(original, replacement + "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:audio\r\n") }
        assertThrows(IllegalArgumentException::class.java) { BrowserRtcVideoPolicy.validateReplacement(original, replacement.replace("BUNDLE data video1", "BUNDLE data")) }
    }

    @Test fun replacementGenerationRequiresInstalledReceiverAndCannotAcceptStaleReady() {
        var now = 0L
        val lease = BrowserRtcVideoLease { now }
        assertTrue(lease.ready)
        assertThrows(IllegalStateException::class.java) { lease.offer(2) }
        lease.pause()
        assertFalse(lease.ready)
        assertTrue(lease.awaitingOffer)
        lease.offer(2)
        assertFalse(lease.awaitingOffer)
        assertFalse(lease.ready(1))
        lease.pause() // New source config while its fresh receiver is being installed.
        assertFalse(lease.awaitingOffer)
        assertFalse(lease.ready(2)) // Receiver cannot acknowledge a not-yet-created answer.
        lease.answered()
        assertTrue(lease.ready(2))
        assertTrue(lease.ready)
        assertFalse(lease.ready(2))
        lease.pause(); lease.offer(3); lease.answered()
        now = 5_999_999_999L
        assertFalse(lease.readyTimedOut())
        now++
        assertTrue(lease.readyTimedOut())
        assertFalse(lease.ready(2))
    }
}
