package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.airplay.VideoCodec
import com.shilapi.xcertplay.web.WebVideoCodecs
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream

class ReceiverProtocolTest {
    @Test fun discoveryAndInfoAgreeWithoutClaimingCarPlayDrmOrAudio() {
        val config = ReceiverConfig("TiPlay AirPlay", "02:11:22:33:44:55", AirPlayIdentity.generate())
        assertEquals(config.features, config.info()["features"])
        assertEquals(config.deviceId, config.serverInfo()["deviceid"])
        assertEquals("1.0", config.serverInfo()["protovers"])
        assertEquals(config.features, config.serverInfo()["features"])
        assertEquals("0x${config.features.toString(16)},0x0", config.txt["features"])
        for (bit in listOf(0, 4, 7, 27)) assertTrue(config.features and (1L shl bit) != 0L)
        for (bit in listOf(1, 2, 5, 9, 32, 42)) assertEquals(0L, config.features and (1L shl bit))
        assertFalse(config.info().containsKey("modes"))
        assertFalse(config.info().containsKey("hidDevices"))
    }

    private fun play(body: ByteArray) = RtspMessage.Request("POST", "/play", "HTTP/1.1", emptyMap(), body)

    @Test fun playAcceptsTextFractionAndBinarySeconds() {
        val text = ReceiverPlay.parse(play("Content-Location: https://example.org/movie.mp4\r\nStart-Position: 0.25\r\n".toByteArray()))
        assertEquals(0.25, text.start, 0.0); assertTrue(text.fraction)
        val binary = ReceiverPlay.parse(play(BplistCodec.encode(mapOf("Content-Location" to "http://192.168.1.2/movie.m3u8", "Start-Position-Seconds" to 12.0))))
        assertEquals(12.0, binary.start, 0.0); assertFalse(binary.fraction)
    }

    @Test fun malformedOrProtectedResourceSchemesAreRejected() {
        for (url in listOf("skd://content", "file:///sdcard/movie.mp4", "https://user:password@example.org/", "https:///movie.mp4")) {
            assertThrows(IllegalArgumentException::class.java) { ReceiverPlay.parse(play("Content-Location: $url\r\n".toByteArray())) }
        }
        assertThrows(IllegalArgumentException::class.java) { ReceiverPlay.parse(play("Content-Location: https://example.org/a\r\nStart-Position: NaN".toByteArray())) }
    }

    @Test fun framingBoundsBodiesAndKeepsPipelinedRequestsSeparate() {
        val input = ByteArrayInputStream("POST /play HTTP/1.1\r\nContent-Length: 3\r\n\r\nabcGET /info RTSP/1.0\r\n\r\n".toByteArray())
        assertArrayEquals("abc".toByteArray(), readReceiverRequest(input)!!.body)
        assertEquals("/info", readReceiverRequest(input)!!.path)
        assertNull(readReceiverRequest(input))
        for (length in listOf("-1", "2147483647", "bad")) {
            assertThrows(RuntimeException::class.java) { readReceiverRequest(ByteArrayInputStream("POST /play HTTP/1.1\r\nContent-Length: $length\r\n\r\n".toByteArray())) }
        }
        assertThrows(RuntimeException::class.java) { readReceiverRequest(ByteArrayInputStream("POST /play HTTP/1.1\r\nContent-Length: 0\r\nContent-Length: 1\r\n\r\n".toByteArray())) }
    }

    @Test fun encoderParameterSetsBecomeBrowserConfiguration() {
        val record = ReceiverAvc.record(byteArrayOf(0, 0, 0, 1, 0x67, 0x42, 0, 0x1f), byteArrayOf(0, 0, 1, 0x68, 1))
        assertEquals("avc1.42001f", WebVideoCodecs.codecString(VideoCodec.H264, record))
        assertEquals(14, WebVideoCodecs.parameterSets(VideoCodec.H264, record).size)
    }
}
