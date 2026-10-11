package com.shilapi.xcertplay.media

import com.shilapi.xcertplay.airplay.MediaSink
import com.shilapi.xcertplay.airplay.AudioCodecKind
import com.shilapi.xcertplay.airplay.AudioFormat
import com.shilapi.xcertplay.airplay.AudioStreamId
import com.shilapi.xcertplay.airplay.MicrophoneConfig
import com.shilapi.xcertplay.airplay.VideoCodec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test
import java.net.InetAddress

class BrowserOnlyMediaSinkTest {
    @Test fun compressedVideoBypassesAndroidWithoutCopyingOrLosingTimestamps() {
        val calls = mutableListOf<String>()
        val android = object : MediaSink {
            override fun onVideoCodec(type: Int, codec: VideoCodec) = error("Local codec selected")
            override fun onVideoConfig(type: Int, codecData: ByteArray) = error("Local decoder configured")
            override fun onVideoFrame(type: Int, naluBytes: ByteArray) = error("Local decoder fed")
            override fun setVideoRecoveryHandler(type: Int, handler: () -> Unit) = error("Local recovery registered")
            override fun setVideoDiagnosticHandler(type: Int, handler: (String) -> Unit) = error("Local diagnostics registered")
            override fun onScreenStreamActive(type: Int, active: Boolean) { calls += "android:$active" }
            override fun onIapMessage(bytes: ByteArray) { calls += "iap" }
        }
        val frame = byteArrayOf(1, 2, 3)
        val browser = object : MediaSink {
            override fun onVideoCodec(type: Int, codec: VideoCodec) { calls += "codec:$codec" }
            override fun onVideoConfig(type: Int, codecData: ByteArray) { assertSame(frame, codecData); calls += "config" }
            override fun onVideoFrame(type: Int, naluBytes: ByteArray) { assertSame(frame, naluBytes); calls += "frame" }
            override fun onVideoFrame(type: Int, naluBytes: ByteArray, senderNanos: Long, arrivalNanos: Long) {
                assertSame(frame, naluBytes)
                calls += "frame:$senderNanos:$arrivalNanos"
            }
            override fun setVideoRecoveryHandler(type: Int, handler: () -> Unit) { handler() }
            override fun setVideoDiagnosticHandler(type: Int, handler: (String) -> Unit) { handler("browser") }
            override fun onScreenStreamActive(type: Int, active: Boolean) { calls += "browser:$active" }
            override fun onIapMessage(bytes: ByteArray) = error("Browser received iAP")
        }
        val sink = BrowserOnlyMediaSink(android, browser)
        sink.setVideoRecoveryHandler(110) { calls += "recovery" }
        sink.setVideoDiagnosticHandler(110) { calls += it }
        sink.onScreenStreamActive(110, true)
        sink.onVideoCodec(110, VideoCodec.H265)
        sink.onVideoConfig(110, frame)
        sink.onVideoFrame(110, frame)
        sink.onVideoFrame(110, frame, 7, 9)
        sink.onIapMessage(frame)
        sink.onScreenStreamActive(110, false)
        assertEquals(listOf("recovery", "browser", "android:true", "browser:true", "codec:H265",
            "config", "frame", "frame:7:9", "iap", "android:false", "browser:false"), calls)
    }

    @Test fun audioAndMicrophoneNeverReachAndroidOrBrowser() {
        val calls = mutableListOf<String>()
        val android = object : MediaSink {
            override fun onAudioStarted(id: AudioStreamId, format: AudioFormat, firstSample: Int) { calls += "start" }
            override fun onAudioRtp(id: AudioStreamId, format: AudioFormat, rtp: ByteArray, sample: Int) { calls += "rtp" }
            override fun onAudioStopped(id: AudioStreamId) { calls += "stop" }
            override fun onMicrophoneStarted(id: AudioStreamId, config: MicrophoneConfig) { calls += "mic-start" }
            override fun onMicrophoneStopped(id: AudioStreamId) { calls += "mic-stop" }
        }
        val browser = object : MediaSink {
            override fun onAudioStarted(id: AudioStreamId, format: AudioFormat, firstSample: Int) = error("Browser audio")
            override fun onAudioRtp(id: AudioStreamId, format: AudioFormat, rtp: ByteArray, sample: Int) = error("Browser audio")
            override fun onAudioStopped(id: AudioStreamId) = error("Browser audio")
            override fun onMicrophoneStarted(id: AudioStreamId, config: MicrophoneConfig) = error("Browser microphone")
            override fun onMicrophoneStopped(id: AudioStreamId) = error("Browser microphone")
        }
        val sink = BrowserOnlyMediaSink(android, browser)
        val id = AudioStreamId(100, "media")
        val format = AudioFormat(AudioCodecKind.AAC_LC, 48_000, 2, 96)
        val microphone = MicrophoneConfig("telephony", 16_000, 1, 97, 20, InetAddress.getLoopbackAddress(), 1, ByteArray(32))
        sink.onAudioStarted(id, format, 0)
        sink.onAudioRtp(id, format, ByteArray(4), 0)
        sink.onAudioStopped(id)
        sink.onMicrophoneStarted(id, microphone)
        sink.onMicrophoneStopped(id)
        assertEquals(emptyList<String>(), calls)
    }
}
