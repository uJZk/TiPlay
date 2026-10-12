package com.shilapi.xcertplay.airplay

/** A browser handoff keeps only a bounded relay window on Android; the browser buffers playback. */
interface BrowserBufferedAudioPolicy {
    val bufferedRelayMillis: Long get() = 2_500L
    val bufferedRelayBytes: Int get() = 256 * 1024
}
