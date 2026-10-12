package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.BplistCodec

/** A scoped audio stop must not close a still-running mirror on the same RTSP connection. */
internal fun receiverTeardownTypes(body: ByteArray): Set<Int>? {
    if (body.isEmpty()) return null
    val dict = BplistCodec.decode(body) as? Map<*, *> ?: error("teardown must be a dictionary")
    val streams = dict["streams"] ?: return null
    require(streams is List<*> && streams.size <= 16)
    if (streams.isEmpty()) return null
    return streams.map { entry ->
        val type = ((entry as? Map<*, *>)?.get("type") as? Number)?.toInt()
        require(type == 96 || type == 110) { "unsupported teardown stream" }
        type
    }.toSet()
}
