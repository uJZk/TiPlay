package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.RtspMessage

/** Legacy mirror clients query this control value even when no audio stream is offered. */
internal object ReceiverMirrorParameters {
    fun reply(request: RtspMessage.Request): RtspMessage.Response {
        if (request.body.isEmpty()) return RtspMessage.Response()
        val contentType = request.headers["content-type"]?.substringBefore(';')?.trim()
        if (contentType != null && !contentType.equals("text/parameters", ignoreCase = true)) return unsupported()
        val parameters = request.body.toString(Charsets.US_ASCII).lineSequence().map(String::trim).filter(String::isNotEmpty).toList()
        if (parameters.isEmpty() || parameters.any { it != "volume" }) return unsupported()
        // Legacy muted value: this receiver offers no audio output or audio codec.
        return RtspMessage.Response(headers = mapOf("Content-Type" to "text/parameters"),
            body = "volume: -144.0\r\n".toByteArray(Charsets.US_ASCII))
    }

    private fun unsupported() = RtspMessage.Response(status = 451, statusText = "Parameter Not Understood")
}
