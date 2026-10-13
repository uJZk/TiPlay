package com.shilapi.xcertplay.receiver

/** Known control names and bounded numeric positions only; unknown routes and selectors stay hidden. */
internal object ReceiverVideoControlDiagnostics {
    val paths = setOf("/play", "/scrub", "/rate", "/stop", "/getProperty", "/setProperty", "/fp-setup2",
        "/auth-setup", "/audioMode", "/command", "/event", "/volume")
    private val selectors = setOf("position", "value", "volume", "playbackAccessLog", "playbackErrorLog",
        "forwardEndTime", "reverseEndTime", "actionAtItemEnd", "loadedTimeRanges", "seekableTimeRanges",
        "clientInfo", "captionDisplayMode", "audioTrack", "subtitleTrack", "muted", "duration",
        "selectedMediaArray", "interstitialEvents", "textMarkupArray", "isInterestedInDateRange")

    fun describe(target: String): String {
        val route = receiverRequestPath(target)
        val known = paths.firstOrNull { it.equals(route, ignoreCase = true) } ?: "OTHER"
        val shape = when {
            target.startsWith('/') -> "PATH"
            target.startsWith("http://", true) || target.startsWith("https://", true) ||
                target.startsWith("rtsp://", true) -> "ABSOLUTE"
            else -> "OTHER"
        }
        val names = target.substringAfter('?', "").split('&').filter(String::isNotEmpty).take(12)
            .map { field -> field.substringBefore('=').takeIf { it in selectors } ?: "OTHER" }
        val numeric = if (known in setOf("/scrub", "/rate")) {
            val query = runCatching { receiverQuery(target) }.getOrDefault(emptyMap())
            val key = if (known == "/scrub") "position" else "value"
            val value = query[key]?.toDoubleOrNull()?.takeIf { it.isFinite() && it in 0.0..1_000_000_000.0 }
            " $key=${value ?: "ABSENT_OR_INVALID"}"
        } else ""
        return "target=$shape route=$known selectors=[${names.joinToString(",")}]$numeric"
    }
}
