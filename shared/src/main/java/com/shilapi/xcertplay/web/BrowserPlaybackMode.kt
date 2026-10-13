package com.shilapi.xcertplay.web

/** Both independently transported tracks identify the same browser buffering policy. */
enum class BrowserPlaybackMode(val wireName: String, val audioFlags: Int) {
    CARPLAY("carplay", 0),
    AIRPLAY_MIRROR("airplay-mirror", 4),
}
