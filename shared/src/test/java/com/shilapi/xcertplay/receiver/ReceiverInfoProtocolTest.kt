package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import org.junit.Assert.*
import org.junit.Test

class ReceiverInfoProtocolTest {
    @Test fun bleAndPlistQueriesUseTheReceiverIdentityAndBothFeatureWords() {
        val config = ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(), hevcEnabled = true)
        val query = RtspMessage.Request("GET", "/info?txtAirPlay", "RTSP/1.0", emptyMap(), byteArrayOf())
        val ble = ReceiverInfoProtocol.info(config, query)
        val bytes = ble["txtAirPlay"] as ByteArray
        assertTrue(bytes.toString(Charsets.UTF_8).contains("deviceid=${config.deviceId}"))
        assertTrue(bytes.toString(Charsets.UTF_8).contains("features=${config.txt["features"]}"))
        assertTrue(config.features and (1L shl 42) != 0L)
        val plist = query.copy(path = "/info", headers = mapOf("content-type" to "application/x-apple-binary-plist"),
            body = BplistCodec.encode(mapOf("qualifier" to listOf("txtAirPlay"))))
        assertEquals(setOf("txtAirPlay"), ReceiverInfoProtocol.info(config, plist).keys)
    }

    @Test fun combinedBleQueryReturnsBothExactBonjourTxtRecords() {
        val config = ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(), hevcEnabled = true)
        val query = RtspMessage.Request("GET", "/info?txtAirPlay&txtRAOP", "RTSP/1.0", emptyMap(), byteArrayOf())
        val info = ReceiverInfoProtocol.info(config, query)
        assertEquals(config.txt, decodeTxt(info["txtAirPlay"] as ByteArray))
        assertEquals(config.raopTxt, decodeTxt(info["txtRAOP"] as ByteArray))
        assertEquals(config.deviceId, info["deviceID"])
        assertFalse(info.containsKey("port"))
    }

    @Test fun raopOnlyQueryAndPlistQualifierDoNotAddUnrequestedAirPlayTxt() {
        val config = ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate())
        val query = RtspMessage.Request("GET", "/info?txtRAOP", "RTSP/1.0", emptyMap(), byteArrayOf())
        val info = ReceiverInfoProtocol.info(config, query)
        assertEquals(config.raopTxt, decodeTxt(info["txtRAOP"] as ByteArray))
        assertFalse(info.containsKey("txtAirPlay"))
        val plist = query.copy(path = "/info", headers = mapOf("content-type" to "application/x-apple-binary-plist"),
            body = BplistCodec.encode(mapOf("qualifier" to listOf("txtAirPlay", "txtRAOP"))))
        val qualified = ReceiverInfoProtocol.info(config, plist)
        assertEquals(setOf("txtAirPlay", "txtRAOP"), qualified.keys)
        assertEquals(config.raopTxt, decodeTxt(qualified["txtRAOP"] as ByteArray))
    }

    @Test fun cseqAndUnrelatedQueryValuesDoNotBecomeTxtSelectors() {
        val config = ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate())
        val query = RtspMessage.Request("GET", "/info?txtAirPlay&txtRAOP", "RTSP/1.0", mapOf("cseq" to "1"), byteArrayOf())
        assertEquals(config.info().keys, ReceiverInfoProtocol.info(config, query).keys)
        assertEquals(config.info().keys, ReceiverInfoProtocol.info(config,
            query.copy(path = "/info?other=txtAirPlay", headers = emptyMap())).keys)
    }

    private fun decodeTxt(bytes: ByteArray): Map<String, String> {
        val result = linkedMapOf<String, String>()
        var position = 0
        while (position < bytes.size) {
            val length = bytes[position++].toInt() and 0xff
            assertTrue(length > 0 && position + length <= bytes.size)
            val entry = bytes.copyOfRange(position, position + length).toString(Charsets.UTF_8)
            result[entry.substringBefore('=')] = entry.substringAfter('=')
            position += length
        }
        assertEquals(bytes.size, position)
        return result
    }
}
