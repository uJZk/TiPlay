package com.shilapi.xcertplay

import com.shilapi.xcertplay.web.BrowserViewport

/** Only a live authenticated page can supply the canvas and decoder for a new connection. */
internal class BrowserCarPlayReadiness(private val now: () -> Long) {
    private var session: String? = null
    private var lastSeen = 0L
    private var viewport: BrowserViewport? = null

    @Synchronized fun seen(session: String) {
        if (this.session != session) viewport = null
        this.session = session
        lastSeen = now()
    }

    @Synchronized fun report(viewport: BrowserViewport) { this.viewport = viewport }

    @Synchronized fun gone(session: String) {
        if (this.session == session) clear()
    }

    @Synchronized fun clear() { session = null; viewport = null }

    /** Audio can be supported even when this page has no video decoder. */
    @Synchronized fun liveViewport(): BrowserViewport? {
        if (session == null || now() - lastSeen >= TIMEOUT_MILLIS) return null
        return viewport
    }

    @Synchronized fun readyViewport(): BrowserViewport? {
        return liveViewport()?.takeIf {
            val caps = it.videoCapabilities
            caps != null && (caps.h264 || caps.hevc) && caps.maxWidth > 0 && caps.maxHeight > 0
        }
    }

    companion object { const val TIMEOUT_MILLIS = 5_000L }
}
