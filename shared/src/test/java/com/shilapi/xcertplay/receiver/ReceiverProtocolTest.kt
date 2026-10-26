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
    @Test fun classicDiscoveryOffersOnlyItsActual44100StereoBrowserFormats() {
        val identity = AirPlayIdentity.generate()
        val full = ReceiverConfig("TiPlay", "02:11:22:33:44:55", identity,
            audioOutputFormats = ReceiverAudioCapabilities.OUTPUT_FORMATS)
        assertEquals("021122334455@TiPlay", full.raopName)
        assertEquals("0,1", full.raopTxt["cn"])
        assertEquals("0,3", full.raopTxt["et"])
        assertEquals("UDP", full.raopTxt["tp"])
        // A browser offering only 8 kHz mono cannot accept the advertised CD profile.
        assertEquals("", full.copy(audioOutputFormats = 1L shl 2).raopTxt["cn"])
        assertEquals("1", full.copy(audioOutputFormats = 1L shl 18).raopTxt["cn"])
    }

    @Test fun playbackBufferFullDescribesReadyPlaybackWithoutClaimingTheWholeVideoIsLoaded() {
        val state = ReceiverPlayback(duration = 100.0, position = 50.0, rate = 1.0,
            ready = true, buffering = false, bufferedPosition = 60.0)
        assertEquals(1L, state.info()["playbackBufferFull"])
        assertEquals(listOf(mapOf("start" to 50.0, "duration" to 10.0)), state.info()["loadedTimeRanges"])
        assertEquals(0L, state.copy(buffering = true).info()["playbackBufferFull"])
        assertEquals(0L, state.copy(ready = false).info()["playbackBufferFull"])
        assertEquals(0L, state.copy(bufferedPosition = 50.0).info()["playbackBufferFull"])
    }

    @Test fun legacyPlaybackInfoEncodesFlagsAsIntegersAndKeepsRealPlaybackValues() {
        val ready = ReceiverPlayback(duration = 100.0, position = 50.0, rate = 1.0,
            ready = true, buffering = false, bufferedPosition = 60.0)
        val readyXml = receiverXml(ready.info()).toString(Charsets.UTF_8)
        for ((key, value) in mapOf("readyToPlay" to 1, "playbackBufferEmpty" to 0,
            "playbackBufferFull" to 1, "playbackLikelyToKeepUp" to 1)) {
            assertTrue(readyXml.contains("<key>$key</key><integer>$value</integer>"))
        }
        val loadingXml = receiverXml(ReceiverPlayback(buffering = true).info()).toString(Charsets.UTF_8)
        for ((key, value) in mapOf("readyToPlay" to 0, "playbackBufferEmpty" to 1,
            "playbackBufferFull" to 0, "playbackLikelyToKeepUp" to 0)) {
            assertTrue(loadingXml.contains("<key>$key</key><integer>$value</integer>"))
        }
        assertTrue(readyXml.contains("<key>position</key><real>50.0</real>"))
        assertEquals(listOf(mapOf("start" to 50.0, "duration" to 10.0)), ready.info()["loadedTimeRanges"])
    }

    @Test fun discoveryAndInfoAgreeWithoutClaimingCarPlayRemoteVolumeOrDrm() {
        val config = ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(), audioOutputFormats = 0x3fffffcL)
        assertEquals(config.features, config.info()["features"])
        assertEquals(config.deviceId, config.serverInfo()["deviceid"])
        assertEquals("1.0", config.serverInfo()["protovers"])
        assertEquals(config.features, config.serverInfo()["features"])
        assertEquals(ReceiverCapabilities.txtFeatures(config.features), config.txt["features"])
        for (bit in listOf(0, 1, 4, 7, 9, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 38, 48)) assertTrue(config.features and (1L shl bit) != 0L)
        for (bit in listOf(2, 3, 5, 6, 8, 10, 11, 12, 23, 26, 32, 33, 34, 40, 41, 42, 61)) {
            assertEquals("Unexpected advertised feature $bit", 0L, config.features and (1L shl bit))
        }
        assertFalse(config.info().containsKey("modes"))
        assertFalse(config.info().containsKey("hidDevices"))
    }

    @Test fun browsersWithoutVideoDecodersDoNotAdvertiseMirrorButKeepPhotosVideoAndAudio() {
        val config = ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(),
            hevcEnabled = true, mirrorEnabled = false, audioOutputFormats = 0x3fffffcL)
        for (bit in listOf(7, 42)) assertEquals(0L, config.features and (1L shl bit))
        for (bit in listOf(0, 1, 9)) assertTrue(config.features and (1L shl bit) != 0L)
        assertEquals(config.features, config.info()["features"])
        assertTrue(config.copy(mirrorEnabled = true).features and (1L shl 42) != 0L)
    }

    @Test fun audioCapabilitiesOfferMirrorOutputWithoutMicrophoneAndDoNotMuteTheSender() {
        val info = ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(), audioOutputFormats = 0x3fffffcL).info()
        assertEquals(0.0, info["initialVolume"])
        val formats = info["audioFormats"] as List<*>
        assertEquals(listOf(100L, 101L), formats.map { (it as Map<*, *>)["type"] })
        for (entry in formats) {
            val format = entry as Map<*, *>
            assertEquals(0L, format["audioInputFormats"])
            assertEquals(0x3fffffcL, format["audioOutputFormats"])
        }
        val latencies = info["audioLatencies"] as List<*>
        assertEquals(listOf(100L, 101L), latencies.map { (it as Map<*, *>)["type"] })
        for (entry in latencies) {
            val latency = entry as Map<*, *>
            assertEquals("default", latency["audioType"])
            assertEquals(0L, latency["inputLatencyMicros"])
            assertEquals(0L, latency["outputLatencyMicros"])
        }
    }

    @Test fun audioDrainAcceptsEveryAdvertisedSelectedFormatAndSupportedCodecs() {
        for (codec in listOf(1, 2, 4, 8)) ReceiverAudioCapabilities.validateStream(mapOf("type" to 96, "ct" to codec))
        ReceiverAudioCapabilities.validateStream(mapOf("type" to 96, "audioFormat" to (1L shl 22),
            "ct" to 4, "spf" to 1024, "controlPort" to 65535))
        for (bit in 2..25) ReceiverAudioCapabilities.validateStream(mapOf("type" to 96, "audioFormat" to (1L shl bit)))
    }

    @Test fun mirrorAudioExcludesUnsupportedAacEldIncludingCodecOnlySetupButAllowsPositiveBrowserProbes() {
        val supported = 0xfffffcL
        val config = ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(), audioOutputFormats = supported)
        val info = config.info()
        for (entry in info["audioFormats"] as List<*>) {
            val mask = ((entry as Map<*, *>)["audioOutputFormats"] as Number).toLong()
            assertEquals(0L, mask and ((1L shl 24) or (1L shl 25)))
        }
        for (stream in listOf(
            mapOf("type" to 96, "ct" to 8),
            mapOf("type" to 96, "ct" to 8, "audioFormat" to 0L),
            mapOf("type" to 96, "audioFormat" to (1L shl 24)),
            mapOf("type" to 96, "audioFormat" to (1L shl 25)),
            mapOf("type" to 96, "ct" to 8, "audioFormat" to (1L shl 24), "spf" to 480),
        )) assertThrows(IllegalArgumentException::class.java) {
            ReceiverAudioCapabilities.validateStream(stream, supported)
        }
        val capable = config.copy(audioOutputFormats = supported or (1L shl 24))
        ReceiverAudioCapabilities.validateStream(mapOf("type" to 96, "ct" to 8), capable.audioOutputFormats)
        assertTrue(capable.features and (1L shl 21) != 0L)
        assertEquals(0L, config.features and (1L shl 21))
    }

    @Test fun audioOffersGateAlacRateAndBitDepthAndKeepDiscoveryAndInfoConsistent() {
        val supported = (1L shl 11) or (1L shl 18) or (1L shl 22)
        val config = ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(), audioOutputFormats = supported)
        for (entry in config.info()["audioFormats"] as List<*>) assertEquals(supported, (entry as Map<*, *>)["audioOutputFormats"])
        assertEquals(config.features, config.info()["features"])
        assertEquals(config.features, config.serverInfo()["features"])
        assertEquals(ReceiverCapabilities.txtFeatures(config.features), config.txt["features"])
        for (codec in listOf(1, 2, 4)) ReceiverAudioCapabilities.validateStream(mapOf("type" to 96, "ct" to codec), supported)
        for (stream in listOf(
            mapOf("type" to 96, "ct" to 2, "ss" to 24),
            mapOf("type" to 96, "ct" to 2, "sr" to 48000),
            mapOf("type" to 96, "audioFormat" to (1L shl 19)),
        )) assertThrows(IllegalArgumentException::class.java) { ReceiverAudioCapabilities.validateStream(stream, supported) }
        val noAlac = config.copy(audioOutputFormats = supported and (1L shl 18).inv())
        assertEquals(0L, noAlac.features and (1L shl 19))
        assertThrows(IllegalArgumentException::class.java) {
            ReceiverAudioCapabilities.validateStream(mapOf("type" to 96, "ct" to 2), noAlac.audioOutputFormats)
        }
        val pending = ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate())
        assertEquals(0L, pending.audioOutputFormats)
        for (bit in listOf(9, 18, 19, 20, 21, 22)) assertEquals(0L, pending.features and (1L shl bit))
        assertThrows(IllegalArgumentException::class.java) {
            ReceiverAudioCapabilities.validateStream(mapOf("type" to 96, "ct" to 1), pending.audioOutputFormats)
        }
        assertThrows(IllegalArgumentException::class.java) { config.copy(audioOutputFormats = -1L) }
        assertThrows(IllegalArgumentException::class.java) { config.copy(audioOutputFormats = 1L shl 26) }
    }

    @Test fun audioDrainRejectsUnknownFormatsAndInvalidNegotiationFields() {
        val invalid = listOf(
            mapOf("type" to 103), mapOf("type" to 96, "audioFormat" to 1L),
            mapOf("type" to 96, "audioFormat" to (1L shl 26)),
            mapOf("type" to 96, "audioFormat" to -1L),
            mapOf("type" to 96), mapOf("type" to 96, "ct" to 0),
            mapOf("type" to 96, "audioFormat" to 0x3fffffcL), mapOf("type" to 96, "ct" to 256),
            mapOf("type" to 96, "spf" to -1), mapOf("type" to 96, "spf" to 65536),
            mapOf("type" to 96, "controlPort" to -1), mapOf("type" to 96, "controlPort" to 65536),
            mapOf("type" to 96, "audioFormat" to "4"), mapOf("type" to 96, "spf" to 1.5),
        )
        for (stream in invalid) assertThrows(IllegalArgumentException::class.java) {
            ReceiverAudioCapabilities.validateStream(stream)
        }
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
