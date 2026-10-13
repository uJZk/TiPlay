package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.RtspMessage

/** Legacy HTTP video compatibility replies follow UxPlay's optional property handling. */
internal object ReceiverVideoProperties {
    fun handles(request: RtspMessage.Request): Boolean {
        if (request.protocol != "HTTP/1.1") return false
        return when (receiverRequestPath(request.path)) {
            "/getProperty", "/fp-setup2" -> request.method == "POST"
            "/setProperty" -> request.method == "PUT"
            else -> false
        }
    }

    fun response(request: RtspMessage.Request): RtspMessage.Response {
        check(handles(request))
        return when (receiverRequestPath(request.path)) {
            "/fp-setup2" -> RtspMessage.Response(status = 421, statusText = "Misdirected Request",
                headers = mapOf("Content-Type" to "application/x-apple-binary-plist"))
            "/setProperty" -> {
                val property = request.path.substringAfter('?', "")
                if (property in OPTIONAL_HINTS) RtspMessage.Response(
                    headers = mapOf("Content-Type" to "text/x-apple-plist+xml"),
                    body = receiverXml(mapOf("errorCode" to 0)),
                ) else RtspMessage.Response()
            }
            // UxPlay does not implement property reads or return values for them.
            else -> RtspMessage.Response()
        }
    }

    // These are accepted as optional hints, as in UxPlay, without changing player state.
    // In particular, acknowledging forwardEndTime does not implement an additional seek API.
    // Unknown properties receive no errorCode or value, so they acquire no success claim.
    private val OPTIONAL_HINTS = setOf("actionAtItemEnd", "selectedMediaArray", "reverseEndTime",
        "forwardEndTime", "interstitialEvents", "textMarkupArray", "isInterestedInDateRange")
}
