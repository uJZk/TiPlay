package com.shilapi.xcertplay

import com.shilapi.xcertplay.airplay.AirPlayDisplayConfig
import com.shilapi.xcertplay.airplay.AirPlaySession
import com.shilapi.xcertplay.orchestration.CarPlayController

/** Main-thread bridge for retaining wireless transport while a replacement display connects. */
internal class BrowserDisplayReconnectHost(
    private val accepted: (AirPlayDisplayConfig) -> Unit,
) {
    private var owner: CarPlayController? = null
    private var retiring: AirPlaySession? = null
    private var replacement: AirPlaySession? = null
    private var retryAfterFrame = false
    val pending: Boolean get() = owner != null

    fun adopt(controller: CarPlayController) {
        clear()
        owner = controller
        // The previous host may have queued a viewport after the replacement accepted /info.
        retryAfterFrame = true
    }

    fun sessionActive(controller: CarPlayController?, session: AirPlaySession) {
        if (owner === controller && owner != null && session !== retiring) replacement = session
    }

    fun request(controller: CarPlayController, source: AirPlaySession?, display: AirPlayDisplayConfig): Boolean {
        if (owner != null && owner !== controller) cancel()
        if (owner === controller) {
            // Once the new session accepts /info it cannot change its negotiated canvas. Keep the latest
            // viewport in TeslaBrowserLink and apply it after that session's first frame instead.
            if (controller.reconnectBrowserDisplay(display)) accepted(display) else retryAfterFrame = true
            return true
        }
        if (!controller.reconnectBrowserDisplay(display)) return false
        owner = controller
        retiring = source
        replacement = null
        retryAfterFrame = false
        accepted(display)
        return true
    }

    /** No resize or new timeout: recover only the returned session's absent primary stream. */
    fun recoverAfterScreenLoan(controller: CarPlayController, source: AirPlaySession?): Boolean {
        if (source == null) return false
        if (owner != null) return owner === controller && retiring === source
        if (!controller.recoverBrowserDisplayAfterScreenLoan(source)) return false
        owner = controller
        retiring = source
        replacement = null
        // A viewport change during casting still needs the normal fit pass once
        // the replacement, rather than a late old-session frame, is usable.
        retryAfterFrame = true
        return true
    }

    fun expectedEnd(controller: CarPlayController?, session: AirPlaySession): Boolean =
        owner === controller && owner != null &&
            (retiring === session || (retiring == null && replacement !== session))

    /** True asks the host to recheck the newest viewport after this frame; old-session frames prove nothing. */
    fun firstFrame(controller: CarPlayController?, session: AirPlaySession): Boolean {
        if (owner == null || owner !== controller || retiring === session || replacement !== session ||
            controller?.isBrowserDisplayReconnectPending() == true) return false
        val retry = retryAfterFrame
        clear()
        return retry
    }

    fun cancel() {
        owner?.cancelBrowserDisplayReconnect()
        clear()
    }

    /** A successor host checks the controller's pending state before adopting this engine. */
    fun detach() = clear()

    private fun clear() {
        owner = null
        retiring = null
        replacement = null
        retryAfterFrame = false
    }
}
