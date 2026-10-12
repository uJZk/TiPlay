package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import org.junit.Assert.*
import org.junit.Test

class ReceiverInfoProtocolTest {
    @Test fun bleAndPlistQueriesUseTheAdvertisedAliasAndBothFeatureWords() {
        val config = ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(), hevcEnabled = true)
        val query = RtspMessage.Request("GET", "/info?txtAirPlay", "RTSP/1.0", emptyMap(), byteArrayOf())
        val ble = ReceiverInfoProtocol.info(config, query, deviceId = "02:AA:BB:CC:DD:EE")
        val bytes = ble["txtAirPlay"] as ByteArray
        assertTrue(bytes.toString(Charsets.UTF_8).contains("deviceid=02:AA:BB:CC:DD:EE"))
        assertTrue(bytes.toString(Charsets.UTF_8).contains("features=${config.txt["features"]}"))
        assertTrue(config.features and (1L shl 42) != 0L)
        val plist = query.copy(path = "/info", headers = mapOf("content-type" to "application/x-apple-binary-plist"),
            body = BplistCodec.encode(mapOf("qualifier" to listOf("txtAirPlay"))))
        assertEquals(setOf("txtAirPlay"), ReceiverInfoProtocol.info(config, plist).keys)
    }
}
