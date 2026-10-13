package com.shilapi.xcertplay.web

/** Ordinary AirPlay keeps the canvas until it ends, even when a CarPlay session starts or restarts. */
enum class BrowserDisplaySource { CARPLAY, AIRPLAY }

/** Called only under the video hub lock; a stale producer cannot release a replacement's priority. */
internal class BrowserDisplayOwner {
    private var owner: Any? = null
    var source: BrowserDisplaySource? = null
        private set

    fun acquire(owner: Any, source: BrowserDisplaySource): Boolean {
        if (this.owner !== owner && this.source == BrowserDisplaySource.AIRPLAY && source == BrowserDisplaySource.CARPLAY) return false
        this.owner = owner
        this.source = source
        return true
    }

    fun release(owner: Any) {
        if (this.owner !== owner) return
        this.owner = null
        source = null
    }
}
