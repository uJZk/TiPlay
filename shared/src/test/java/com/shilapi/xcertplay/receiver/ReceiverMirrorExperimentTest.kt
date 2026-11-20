package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import org.junit.Assert.*
import org.junit.Test

class ReceiverMirrorExperimentTest {
    @Test fun storedIdsAreStableAndUnknownValuesUseTheBaseline() {
        assertEquals(listOf("baseline", "h264_only", "no_ble", "legacy_pairing"),
            ReceiverMirrorExperiment.entries.map { it.id })
        for (mode in ReceiverMirrorExperiment.entries) assertEquals(mode, ReceiverMirrorExperiment.fromId(mode.id))
        for (id in listOf(null, "", "unknown", "H264_ONLY", "h264_only "))
            assertEquals(ReceiverMirrorExperiment.BASELINE, ReceiverMirrorExperiment.fromId(id))
        assertTrue(ReceiverMirrorExperiment.H264_ONLY.h264Only)
        assertFalse(ReceiverMirrorExperiment.NO_BLE.bluetoothDiscoveryEnabled)
        assertTrue(ReceiverMirrorExperiment.LEGACY_PAIRING.legacyPairingAdvertised)
    }

    @Test fun baselineRetainsThePublishedWireFlags() {
        val config = config()
        assertEquals(ReceiverMirrorExperiment.BASELINE, config.mirrorExperiment)
        assertEquals(0x400407fe293L, config.features)
        assertEquals("0x407fe293,0x400", config.txt["features"])
        assertEquals(0x407fe293L, config.copy(hevcEnabled = false).features)
        assertEquals(0x40040016093L, config.copy(audioOutputFormats = 0L).features)
        assertEquals(0x40016093L, config.copy(hevcEnabled = false, audioOutputFormats = 0L).features)
    }

    @Test fun comparisonProfilesChangeOnlyTheirOwnCapabilityAndKeepAudioOnlyOffers() {
        for (hevc in listOf(false, true)) for (formats in listOf(0L, 1L shl 22, 0x3fffffcL)) {
            val baseline = config().copy(hevcEnabled = hevc, audioOutputFormats = formats)
            for (mode in ReceiverMirrorExperiment.entries) {
                val compared = baseline.copy(mirrorExperiment = mode)
                val expectedDifference = when (mode) {
                    ReceiverMirrorExperiment.H264_ONLY -> if (hevc) 1L shl 42 else 0L
                    ReceiverMirrorExperiment.LEGACY_PAIRING -> 1L shl 27
                    else -> 0L
                }
                assertEquals(mode.id, expectedDifference, baseline.features xor compared.features)
                assertEquals(hevc, compared.hevcEnabled)
                assertEquals(hevc && mode != ReceiverMirrorExperiment.H264_ONLY, compared.effectiveMirrorHevcEnabled)
                for (bit in listOf(38, 48)) assertEquals(0L, compared.features and (1L shl bit))
                assertEquals(baseline.copy(mirrorEnabled = false).features,
                    compared.copy(mirrorEnabled = false).features)
            }
        }
    }

    @Test fun everyWireProfileUsesTheSameExperimentWithoutChangingIdentityAudioOrGeometry() {
        val baseline = config()
        val query = RtspMessage.Request("GET", "/info?txtAirPlay&txtRAOP", "RTSP/1.0", emptyMap(), ByteArray(0))
        for (mode in ReceiverMirrorExperiment.entries) {
            val config = baseline.copy(mirrorExperiment = mode)
            val info = BplistCodec.decode(ReceiverInfoProtocol.response(config, query).body) as Map<*, *>
            assertEquals(config.features, info["features"])
            assertEquals(config.features, config.serverInfo()["features"])
            assertEquals(config.txt, decodeTxt(info["txtAirPlay"] as ByteArray))
            assertEquals(config.raopTxt, decodeTxt(info["txtRAOP"] as ByteArray))
            assertEquals(config.txt["features"], config.raopTxt["ft"])
            assertArrayEquals(baseline.identity.publicKey, info["pk"] as ByteArray)
            assertEquals(baseline.identity.pairingId, info["pi"])
            assertEquals(baseline.txt - "features", config.txt - "features")
            assertEquals(baseline.raopTxt - "ft", config.raopTxt - "ft")
            assertEquals(baseline.info() - "features", config.info() - "features")
            assertEquals(baseline.serverInfo() - "features", config.serverInfo() - "features")
        }
    }

    private fun config() = ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(),
        width = 1184, height = 880, hevcEnabled = true, audioOutputFormats = 0x3fffffcL)

    private fun decodeTxt(bytes: ByteArray): Map<String, String> {
        val result = linkedMapOf<String, String>()
        var position = 0
        while (position < bytes.size) {
            val length = bytes[position++].toInt() and 255
            assertTrue(length > 0 && position + length <= bytes.size)
            val entry = bytes.copyOfRange(position, position + length).toString(Charsets.UTF_8)
            result[entry.substringBefore('=')] = entry.substringAfter('=')
            position += length
        }
        assertEquals(bytes.size, position)
        return result
    }
}
