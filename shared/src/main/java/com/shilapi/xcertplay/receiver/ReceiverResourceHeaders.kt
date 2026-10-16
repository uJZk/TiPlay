package com.shilapi.xcertplay.receiver

import java.net.URI

/** Some CDN URLs require request context as well as their unchanged signed query. */
internal object ReceiverResourceHeaders {
    fun forUrl(url: String): Map<String, String> {
        val uri = URI(url)
        val host = uri.host?.lowercase() ?: return emptyMap()
        if (uri.scheme?.lowercase() !in listOf("http", "https") ||
            host != "bilivideo.com" && !host.endsWith(".bilivideo.com")) return emptyMap()
        // This CDN requires both headers; neither the legacy AirPlay UA nor Referer alone suffices.
        return mapOf("Referer" to "https://www.bilibili.com/", "User-Agent" to
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0")
    }
}
