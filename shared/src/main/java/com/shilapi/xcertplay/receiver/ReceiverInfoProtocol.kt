package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import java.io.ByteArrayOutputStream

/** Bonjour, BLE-style TXT queries and legacy RTSP /info use the same profile. */
internal object ReceiverInfoProtocol {
    fun info(config: ReceiverConfig, request: RtspMessage.Request, features: Long = config.features,
             deviceId: String = config.deviceId): Map<String, Any?> {
        val queryKeys = request.path.substringAfter('?', "").split('&').map { it.substringBefore('=') }
        val qualifier = if (request.body.isEmpty()) emptyList<Any?>() else {
            val dict = BplistCodec.decode(request.body) as? Map<*, *> ?: error("Invalid info request")
            dict["qualifier"] as? List<*> ?: emptyList<Any?>()
        }
        val requestedTxt = "txtAirPlay" in qualifier ||
            (!request.headers.containsKey("cseq") && "txtAirPlay" in queryKeys)
        val txtOnly = request.body.isNotEmpty() && request.headers["content-type"]
            ?.substringBefore(';')?.trim()?.equals("application/x-apple-binary-plist", true) == true
        val info: MutableMap<String, Any?> = if (txtOnly) mutableMapOf() else config.info().toMutableMap().apply {
            this["features"] = features
            this["deviceID"] = deviceId
            this["macAddress"] = deviceId
        }
        if (requestedTxt) {
            val txt = config.txt + mapOf("deviceid" to deviceId, "features" to ReceiverCapabilities.txtFeatures(features))
            val bytes = ByteArrayOutputStream()
            for ((key, value) in txt) {
                val entry = "$key=$value".toByteArray(Charsets.UTF_8)
                require(entry.size in 1..255)
                bytes.write(entry.size)
                bytes.write(entry)
            }
            info["txtAirPlay"] = bytes.toByteArray()
        }
        return info
    }

    fun response(config: ReceiverConfig, request: RtspMessage.Request, features: Long = config.features,
                 deviceId: String = config.deviceId) = RtspMessage.Response(
        headers = mapOf("Content-Type" to "application/x-apple-binary-plist", "Server" to "AirTunes/220.68"),
        body = BplistCodec.encode(info(config, request, features, deviceId)),
    )
}
