package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import java.io.ByteArrayOutputStream

/** Bonjour, BLE-style TXT queries and legacy RTSP /info use the same profile. */
internal object ReceiverInfoProtocol {
    /** Full /info and combined control SETUP always describe the same current receiver profile. */
    fun fullInfo(config: ReceiverConfig): Map<String, Any?> = config.info()

    fun queryTxtKeys(request: RtspMessage.Request): Set<String> = request.path
        .substringAfter('?', "").split('&').map { it.substringBefore('=') }
        .filterTo(linkedSetOf()) { it == "txtAirPlay" || it == "txtRAOP" }

    fun info(config: ReceiverConfig, request: RtspMessage.Request): Map<String, Any?> {
        val queryKeys = if (request.headers.containsKey("cseq")) emptySet() else queryTxtKeys(request)
        val qualifier = if (request.body.isEmpty()) emptyList<Any?>() else {
            val dict = BplistCodec.decode(request.body) as? Map<*, *> ?: error("Invalid info request")
            dict["qualifier"] as? List<*> ?: emptyList<Any?>()
        }
        val txtOnly = request.body.isNotEmpty() && request.headers["content-type"]
            ?.substringBefore(';')?.trim()?.equals("application/x-apple-binary-plist", true) == true
        val info: MutableMap<String, Any?> = if (txtOnly) mutableMapOf() else fullInfo(config).toMutableMap()
        for ((key, txt) in mapOf("txtAirPlay" to config.txt, "txtRAOP" to config.raopTxt)) {
            if (key in qualifier || key in queryKeys) info[key] = encodeTxt(txt)
        }
        return info
    }

    private fun encodeTxt(txt: Map<String, String>): ByteArray {
        val bytes = ByteArrayOutputStream()
        for ((key, value) in txt) {
            val entry = "$key=$value".toByteArray(Charsets.UTF_8)
            require(entry.size in 1..255)
            bytes.write(entry.size)
            bytes.write(entry)
        }
        return bytes.toByteArray()
    }

    fun response(config: ReceiverConfig, request: RtspMessage.Request) = RtspMessage.Response(
        headers = mapOf("Content-Type" to "application/x-apple-binary-plist", "Server" to "AirTunes/220.68"),
        body = BplistCodec.encode(info(config, request)),
    )
}
