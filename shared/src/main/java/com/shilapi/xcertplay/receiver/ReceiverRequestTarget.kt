package com.shilapi.xcertplay.receiver

import java.net.URI

/** HTTP and RTSP can carry an absolute request URI; dispatch still uses only its route. */
internal fun receiverRequestPath(target: String): String {
    if (target.startsWith('/')) return target.substringBefore('?')
    val uri = runCatching { URI(target) }.getOrNull() ?: return target.substringBefore('?')
    if (uri.scheme?.lowercase() !in listOf("http", "https", "rtsp")) return target.substringBefore('?')
    return uri.rawPath?.takeIf { it.isNotEmpty() } ?: "/"
}
