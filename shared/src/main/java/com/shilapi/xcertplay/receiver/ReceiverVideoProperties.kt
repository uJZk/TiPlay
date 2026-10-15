package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage

/** Optional media properties acknowledge mutations only when the playback engine implements them. */
internal object ReceiverVideoProperties {
    fun handles(request: RtspMessage.Request): Boolean {
        if (request.protocol != "HTTP/1.1") return false
        return when (receiverRequestPath(request.path)) {
            "/getProperty", "/fp-setup2" -> request.method == "POST"
            "/setProperty" -> request.method == "PUT"
            else -> false
        }
    }

    fun response(request: RtspMessage.Request, playback: () -> ReceiverPlayback = { ReceiverPlayback() },
                 apply: (String, Any?) -> Boolean = { _, _ -> false }): RtspMessage.Response {
        check(handles(request))
        val property = request.path.substringAfter('?', "").substringBefore('&')
        return when (receiverRequestPath(request.path)) {
            "/fp-setup2" -> RtspMessage.Response(status = 421, statusText = "Misdirected Request",
                headers = mapOf("Content-Type" to "application/x-apple-binary-plist"))
            "/setProperty" -> {
                if (property in MUTATIONS) {
                    val body = BplistCodec.decode(request.body) as? Map<*, *> ?: error("property dictionary required")
                    require(body.containsKey("value"))
                    propertyReply(mapOf("errorCode" to if (apply(property, body["value"])) 0 else -1))
                } else if (property in OPTIONAL_HINTS) propertyReply(mapOf("errorCode" to 0))
                else RtspMessage.Response()
            }
            else -> {
                val state = playback()
                val value = when (property) {
                    "duration" -> state.duration
                    "currentTime", "position" -> state.position
                    "rate" -> state.rate
                    "readyToPlay" -> state.ready
                    else -> return RtspMessage.Response()
                }
                propertyReply(mapOf("errorCode" to 0, "value" to value))
            }
        }
    }

    private fun propertyReply(value: Map<String, Any?>) = RtspMessage.Response(
        headers = mapOf("Content-Type" to "text/x-apple-plist+xml"), body = receiverXml(value))

    private val MUTATIONS = setOf("selectedMediaArray", "textMarkupArray")
    // No changed player state is implied by these advisory compatibility properties.
    private val OPTIONAL_HINTS = setOf("actionAtItemEnd", "reverseEndTime", "forwardEndTime",
        "interstitialEvents", "isInterestedInDateRange")
}
